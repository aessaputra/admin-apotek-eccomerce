import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5";
import { corsHeaders } from "../_shared/cors.ts";
import { getSupabaseAdminClient } from "../_shared/supabase.ts";

type TransitionPayload = {
  to: string;
  waybill_number?: string;
  waybill_source?: "system" | "manual";
  waybill_override_reason?: string;
  notes?: string;
};

type OrderManagerRequest = {
  action: "transition_status" | "sync_tracking";
  orderId: string;
  payload?: TransitionPayload;
};

const BITESHIP_BASE_URL = "https://api.biteship.com/v1";

declare const Deno: {
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
  env: {
    get: (key: string) => string | undefined;
  };
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const JWKS = createRemoteJWKSet(
  new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`),
);
const JWT_ISSUER = `${supabaseUrl}/auth/v1`;

const TRANSITION_RULES: Record<string, string[]> = {
  pending: ["processing", "cancelled"],
  paid: ["awaiting_shipment", "processing", "cancelled"],
  awaiting_shipment: ["processing", "shipped", "cancelled"],
  processing: ["shipped", "cancelled"],
  shipped: ["delivered"],
};

function canTransition(from: string, to: string): boolean {
  return (TRANSITION_RULES[from] || []).includes(to);
}

function mapBiteshipStatus(status: string, fallback: string): string {
  const statusMap: Record<string, string> = {
    allocated: "processing",
    picked_up: "shipped",
    in_transit: "shipped",
    delivered: "delivered",
  };
  return statusMap[status] || fallback;
}

async function requireAdmin(req: Request): Promise<{ userId: string }> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("Unauthorized: Missing Authorization header");
  }
  const token = authHeader.slice(7).trim();
  if (!token) {
    throw new Error("Unauthorized: Invalid JWT");
  }

  let userId = "";
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: JWT_ISSUER,
      audience: "authenticated",
    });
    userId = payload.sub ?? "";
  } catch (error: unknown) {
    console.error("[order-manager] JWT verification failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    throw new Error("Unauthorized: Invalid JWT");
  }

  if (!userId) {
    throw new Error("Unauthorized: Invalid JWT");
  }

  const adminClient = getSupabaseAdminClient();
  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();

  if (profileError || !profile || profile.role !== "admin") {
    throw new Error("Forbidden: Admin role required");
  }

  return { userId };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { userId } = await requireAdmin(req);
    const body: OrderManagerRequest = await req.json();

    if (!body.action || !body.orderId) {
      return new Response(
        JSON.stringify({ error: "action and orderId are required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const adminClient = getSupabaseAdminClient();
    const { data: order, error: orderError } = await adminClient
      .from("orders")
      .select(
        "id, status, payment_status, waybill_number, waybill_source, biteship_order_id",
      )
      .eq("id", body.orderId)
      .single();

    if (orderError || !order) {
      return new Response(JSON.stringify({ error: "Order not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (body.action === "transition_status") {
      const to = body.payload?.to;
      if (!to) {
        return new Response(
          JSON.stringify({ error: "payload.to is required" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      if (!canTransition(order.status, to)) {
        return new Response(
          JSON.stringify({
            error: "INVALID_TRANSITION",
            message: `Cannot transition order from '${order.status}' to '${to}'`,
          }),
          {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const nextWaybill =
        body.payload?.waybill_number?.trim() || order.waybill_number || null;
      if (to === "shipped" && !nextWaybill) {
        return new Response(
          JSON.stringify({
            error: "waybill_number is required for shipped status",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      // Build update payload with optional waybill override metadata
      const updatePayload: Record<string, unknown> = {
        status: to,
        waybill_number: nextWaybill,
        updated_at: new Date().toISOString(),
      };

      // When cancelling order, also update payment_status to maintain consistency
      // Following Midtrans best practices: separate order status from payment status
      if (to === "cancelled") {
        const currentPaymentStatus = order.payment_status;

        if (
          currentPaymentStatus === "settlement" ||
          currentPaymentStatus === "capture"
        ) {
          // Payment already settled - mark as refund (actual refund should be initiated separately)
          updatePayload.payment_status = "refund";
        } else if (currentPaymentStatus === "pending") {
          // Payment still pending - mark as cancelled (void operation)
          updatePayload.payment_status = "cancel";
        }
        // For other statuses (expire, deny, refund), leave as-is
      }

      // If admin is providing a manual waybill (override), record audit metadata
      if (
        body.payload?.waybill_source === "manual" &&
        body.payload?.waybill_number?.trim()
      ) {
        updatePayload.waybill_source = "manual";
        updatePayload.waybill_overridden_by = userId;
        updatePayload.waybill_override_reason =
          body.payload.waybill_override_reason || null;
        updatePayload.waybill_overridden_at = new Date().toISOString();
      } else if (
        body.payload?.waybill_number?.trim() &&
        !order.biteship_order_id
      ) {
        // No Biteship — still manual but not an override
        updatePayload.waybill_source = "manual";
      }

      const { data: updated, error: updateError } = await adminClient
        .from("orders")
        .update(updatePayload)
        .eq("id", body.orderId)
        .eq("status", order.status) // Prevent race condition: ensure status hasn't changed
        .select("id, status, waybill_number, waybill_source, updated_at")
        .single();

      if (updateError) {
        throw updateError;
      }

      const { error: activityError } = await adminClient
        .from("order_activities")
        .insert({
          order_id: body.orderId,
          action: "status_update",
          old_status: order.status,
          new_status: to,
          actor_id: userId,
          actor_type: "admin",
          metadata: {
            notes: body.payload?.notes ?? null,
            waybill: nextWaybill,
            waybill_source:
              updatePayload.waybill_source ?? order.waybill_source ?? null,
            override_reason: body.payload?.waybill_override_reason ?? null,
          },
        });

      if (activityError) {
        console.error("[order-manager] Failed to log activity:", activityError);
        // Don't throw - order already updated, just log the error
      }

      return new Response(JSON.stringify({ success: true, data: updated }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (body.action === "sync_tracking") {
      if (!order.biteship_order_id) {
        return new Response(
          JSON.stringify({ error: "Order has no biteship_order_id" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const biteshipKey = Deno.env.get("BITESHIP_API_KEY");
      if (!biteshipKey) {
        throw new Error("Missing BITESHIP_API_KEY");
      }

      const trackingResp = await fetch(
        `${BITESHIP_BASE_URL}/trackings/${order.biteship_order_id}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${biteshipKey}`,
          },
        },
      );

      if (!trackingResp.ok) {
        const errorBody = await trackingResp.text();
        return new Response(
          JSON.stringify({
            error: "Biteship tracking failed",
            details: errorBody,
          }),
          {
            status: trackingResp.status,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const trackingData = (await trackingResp.json()) as Record<
        string,
        unknown
      >;
      const trackingStatus = String(trackingData.status || "");
      const waybill =
        String(trackingData.waybill || trackingData.waybill_id || "") || null;
      const nextStatus = mapBiteshipStatus(trackingStatus, order.status);

      // Enforce waybill requirement for shipped status
      if (nextStatus === "shipped" && !waybill && !order.waybill_number) {
        return new Response(
          JSON.stringify({
            error: "Cannot set status to shipped without a waybill number",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const syncWaybill = waybill || order.waybill_number || null;
      const syncWaybillSource = waybill
        ? "system"
        : (order.waybill_source ?? null);

      const { data: updated, error: updateError } = await adminClient
        .from("orders")
        .update({
          status: nextStatus,
          waybill_number: syncWaybill,
          waybill_source: syncWaybillSource,
          updated_at: new Date().toISOString(),
        })
        .eq("id", body.orderId)
        .select("id, status, waybill_number, waybill_source, updated_at")
        .single();

      if (updateError) {
        throw updateError;
      }

      const { error: syncActivityError } = await adminClient
        .from("order_activities")
        .insert({
          order_id: body.orderId,
          action: "sync_tracking",
          old_status: order.status,
          new_status: nextStatus,
          actor_id: userId,
          actor_type: "admin",
          metadata: {
            biteship_order_id: order.biteship_order_id,
            biteship_status: trackingStatus,
            waybill: syncWaybill,
            waybill_source: syncWaybillSource,
          },
        });

      if (syncActivityError) {
        console.error(
          "[order-manager] Failed to log sync activity:",
          syncActivityError,
        );
      }

      return new Response(JSON.stringify({ success: true, data: updated }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";

    // Determine status and client-facing error message
    // Log full error internally but only return generic message for 500s
    const isForbidden = message.startsWith("Forbidden");
    const isUnauthorized = message.startsWith("Unauthorized");
    const status = isForbidden ? 403 : isUnauthorized ? 401 : 500;

    // Log full error for debugging (includes stack trace details)
    console.error("[order-manager] Internal error:", {
      message,
      error: String(error),
    });

    // Return safe error message to client - don't leak internal details for 500 errors
    const clientError = isForbidden
      ? "Forbidden: Admin role required"
      : isUnauthorized
        ? "Unauthorized: Invalid authentication"
        : "Internal server error";

    return new Response(JSON.stringify({ error: clientError }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
