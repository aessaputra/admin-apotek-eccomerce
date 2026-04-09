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
  processing: ["awaiting_shipment", "cancelled"],
  awaiting_shipment: ["shipped", "cancelled"],
  shipped: ["in_transit", "delivered"],
  in_transit: ["delivered"],
};

const TERMINAL_STATUSES = new Set(["delivered", "cancelled"]);
const STATUS_PROGRESS_ORDER: Record<string, number> = {
  pending: 0,
  processing: 1,
  awaiting_shipment: 2,
  shipped: 3,
  in_transit: 4,
  delivered: 5,
  cancelled: 5,
};

const MANUAL_WAYBILL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{4,63}$/;

function canTransition(from: string, to: string): boolean {
  return (TRANSITION_RULES[from] || []).includes(to);
}

function mapBiteshipStatus(status: string, fallback: string): string {
  const statusMap: Record<string, string> = {
    allocated: "awaiting_shipment",
    picked_up: "shipped",
    in_transit: "in_transit",
    delivered: "delivered",
  };
  return statusMap[status] || fallback;
}

function canApplySyncedStatus(currentStatus: string, nextStatus: string): boolean {
  if (TERMINAL_STATUSES.has(currentStatus)) {
    return false;
  }

  if (currentStatus === nextStatus) {
    return true;
  }

  const currentRank = STATUS_PROGRESS_ORDER[currentStatus];
  const nextRank = STATUS_PROGRESS_ORDER[nextStatus];

  if (currentRank === undefined || nextRank === undefined) {
    return false;
  }

  return nextRank >= currentRank;
}

function getBiteshipAuthorizationHeader(apiKey: string): string {
  return apiKey.startsWith("biteship_live.") || apiKey.startsWith("biteship_test.")
    ? apiKey
    : `biteship_test.${apiKey}`;
}

function normalizeWaybillNumber(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim();
  if (!normalizedValue) {
    return null;
  }

  return MANUAL_WAYBILL_PATTERN.test(normalizedValue)
    ? normalizedValue
    : null;
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
        "id, status, payment_status, waybill_number, waybill_source, biteship_order_id, biteship_tracking_id",
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

      if (
        body.payload?.waybill_source === "manual" &&
        body.payload?.waybill_number?.trim() &&
        !normalizeWaybillNumber(body.payload.waybill_number)
      ) {
        return new Response(
          JSON.stringify({
            error:
              "Manual waybill_number must contain 5-64 characters using only letters, numbers, or hyphens",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

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
        if (!body.payload?.waybill_override_reason?.trim() && order.biteship_order_id) {
          return new Response(
            JSON.stringify({
              error:
                "waybill_override_reason is required when overriding a Biteship-generated shipment",
            }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }
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

      const authHeader = getBiteshipAuthorizationHeader(biteshipKey);
      let trackingId = order.biteship_tracking_id ?? null;

      if (!trackingId) {
        const orderResp = await fetch(
          `${BITESHIP_BASE_URL}/orders/${order.biteship_order_id}`,
          {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
              Authorization: authHeader,
            },
          },
        );

        if (!orderResp.ok) {
          const errorBody = await orderResp.text();
          return new Response(
            JSON.stringify({
              error: "Failed to recover Biteship tracking identifier",
              details: errorBody,
            }),
            {
              status: orderResp.status,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }

        const biteshipOrderData = (await orderResp.json()) as Record<
          string,
          unknown
        >;
        const recoveredTrackingId = String(
          ((biteshipOrderData.courier as Record<string, unknown> | undefined)
            ?.tracking_id as string | undefined) || "",
        ).trim();

        if (!recoveredTrackingId) {
          return new Response(
            JSON.stringify({
              error: "Biteship order does not expose a tracking_id yet",
            }),
            {
              status: 409,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }

        trackingId = recoveredTrackingId;

        const recoveredWaybill = normalizeWaybillNumber(
          ((biteshipOrderData.courier as Record<string, unknown> | undefined)
            ?.waybill_id as string | undefined) || "",
        );

        const { error: recoverUpdateError } = await adminClient
          .from("orders")
          .update({
            biteship_tracking_id: trackingId,
            waybill_number: recoveredWaybill || order.waybill_number || null,
            waybill_source: recoveredWaybill ? "system" : order.waybill_source,
            updated_at: new Date().toISOString(),
          })
          .eq("id", body.orderId);

        if (recoverUpdateError) {
          throw recoverUpdateError;
        }
      }

      const trackingResp = await fetch(
        `${BITESHIP_BASE_URL}/trackings/${trackingId}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: authHeader,
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

      if (TERMINAL_STATUSES.has(order.status)) {
        return new Response(
          JSON.stringify({
            error: "INVALID_SYNC_STATE",
            message:
              "Tracking sync is not allowed for delivered or cancelled orders",
          }),
          {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      if (!canApplySyncedStatus(order.status, nextStatus)) {
        return new Response(
          JSON.stringify({
            error: "INVALID_SYNC_TRANSITION",
            message: `Ignoring Biteship status ${trackingStatus} because it would move the order backward from ${order.status} to ${nextStatus}`,
          }),
          {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

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
          biteship_tracking_id: trackingId,
          waybill_number: syncWaybill,
          waybill_source: syncWaybillSource,
          updated_at: new Date().toISOString(),
        })
        .eq("id", body.orderId)
        .eq("status", order.status)
        .select(
          "id, status, biteship_tracking_id, waybill_number, waybill_source, updated_at",
        )
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
            tracking_id: trackingId,
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
