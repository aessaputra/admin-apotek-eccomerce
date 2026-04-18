import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5";
import { corsHeaders } from "../_shared/cors.ts";
import {
  buildShipmentRestorePayload,
  runMutationWithRollback,
  type ShipmentSnapshot,
  toShipmentSnapshot,
} from "../_shared/order-manager-mutation.ts";
import { requiresBiteshipSyncForProviderStatusTransition } from "../_shared/order-flow-rules.ts";
import { resolveBiteshipStatus } from "../_shared/order-status.ts";
import { getSupabaseAdminClient } from "../_shared/supabase.ts";
import {
  getSideEffectTask,
  saveSideEffectTask,
  triggerWebhookSideEffectProcessor,
} from "../_shared/webhook-side-effects.ts";

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

async function upsertShipmentPatch(
  adminClient: ReturnType<typeof getSupabaseAdminClient>,
  orderId: string,
  values: Record<string, unknown>,
): Promise<void> {
  const { error } = await adminClient
    .from("shipments")
    .upsert(
      {
        order_id: orderId,
        ...values,
      },
      { onConflict: "order_id" },
    );

  if (error) {
    throw error;
  }
}

async function readShipmentSnapshot(
  adminClient: ReturnType<typeof getSupabaseAdminClient>,
  orderId: string,
): Promise<ShipmentSnapshot> {
  const { data, error } = await adminClient
    .from("shipments")
    .select(
      "provider, status, biteship_order_id, biteship_tracking_id, waybill_number, waybill_source, waybill_overridden_by, waybill_override_reason, waybill_overridden_at, latest_biteship_status",
    )
    .eq("order_id", orderId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return toShipmentSnapshot(data);
}

async function restoreMutationState(
  adminClient: ReturnType<typeof getSupabaseAdminClient>,
  params: {
    orderId: string;
    rollbackTimestamp: string;
    originalOrderStatus: string;
    originalPaymentStatus: string | null;
    originalShipment: ShipmentSnapshot;
    operationTimestamp: string;
    revertPayment: boolean;
    revertShipment: boolean;
  },
): Promise<void> {
  const {
    orderId,
    rollbackTimestamp,
    originalOrderStatus,
    originalPaymentStatus,
    originalShipment,
    operationTimestamp,
    revertPayment,
    revertShipment,
  } = params;

  const { error: orderRollbackError } = await adminClient
    .from("orders")
    .update({
      status: originalOrderStatus,
      updated_at: rollbackTimestamp,
    })
    .eq("id", orderId);

  if (orderRollbackError) {
    throw orderRollbackError;
  }

  if (revertPayment && originalPaymentStatus) {
    const { error: paymentRollbackError } = await adminClient
      .from("payments")
      .update({
        status: originalPaymentStatus,
        updated_at: rollbackTimestamp,
      })
      .eq("order_id", orderId);

    if (paymentRollbackError) {
      throw paymentRollbackError;
    }
  }

  if (!revertShipment) {
    return;
  }

  const shipmentRestorePayload = buildShipmentRestorePayload(
    originalShipment,
    rollbackTimestamp,
  );

  if (shipmentRestorePayload) {
    await upsertShipmentPatch(adminClient, orderId, shipmentRestorePayload);
    return;
  }

  const { error: shipmentDeleteError } = await adminClient
    .from("shipments")
    .delete()
    .eq("order_id", orderId)
    .eq("updated_at", operationTimestamp);

  if (shipmentDeleteError) {
    throw shipmentDeleteError;
  }
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
      .from("order_read_model")
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

      const operationTimestamp = new Date().toISOString();
      const originalShipment = await readShipmentSnapshot(adminClient, body.orderId);
      const nextWaybill =
        body.payload?.waybill_number?.trim() || order.waybill_number || null;
      const effectiveWaybillSource =
        body.payload?.waybill_source ?? order.waybill_source ?? null;

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

      if (
        requiresBiteshipSyncForProviderStatusTransition({
          targetStatus: to,
          biteshipOrderId: order.biteship_order_id,
          waybillSource: effectiveWaybillSource,
        })
      ) {
        const targetLabel =
          to === "shipped"
            ? "enter shipped status unless you are applying a manual waybill override"
            : `set ${to} manually`;
        return new Response(
          JSON.stringify({
            error: `Biteship-managed shipments must use sync_tracking to ${targetLabel}`,
          }),
          {
            status: 409,
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
        updated_at: operationTimestamp,
      };

      const paymentUpdatePayload: Record<string, unknown> = {};
      const shipmentUpdatePayload: Record<string, unknown> = {
        status:
          to === "awaiting_shipment" ||
          to === "shipped" ||
          to === "in_transit" ||
          to === "delivered" ||
          to === "cancelled"
            ? to
            : undefined,
        waybill_number: nextWaybill,
        updated_at: operationTimestamp,
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
          paymentUpdatePayload.status = "refund";
        } else if (currentPaymentStatus === "pending") {
          // Payment still pending - mark as cancelled (void operation)
          paymentUpdatePayload.status = "cancel";
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
        shipmentUpdatePayload.waybill_source = "manual";
        shipmentUpdatePayload.waybill_overridden_by = userId;
        shipmentUpdatePayload.waybill_override_reason =
          body.payload.waybill_override_reason || null;
        shipmentUpdatePayload.waybill_overridden_at = new Date().toISOString();
      } else if (
        body.payload?.waybill_number?.trim() &&
        !order.biteship_order_id
      ) {
        // No Biteship — still manual but not an override
        shipmentUpdatePayload.waybill_source = "manual";
      }

      let paymentUpdated = false;
      let shipmentUpdated = false;

      const updated = await runMutationWithRollback({
        apply: async () => {
          const { data: updatedOrder, error: updateError } = await adminClient
            .from("orders")
            .update(updatePayload)
            .eq("id", body.orderId)
            .eq("status", order.status)
            .select("id, status, updated_at")
            .single();

          if (updateError) {
            throw updateError;
          }

          if (Object.keys(paymentUpdatePayload).length > 0) {
            const { error: paymentUpdateError } = await adminClient
              .from("payments")
              .update({
                ...paymentUpdatePayload,
                updated_at: operationTimestamp,
              })
              .eq("order_id", body.orderId);

            if (paymentUpdateError) {
              throw paymentUpdateError;
            }

            paymentUpdated = true;
          }

          if (
            nextWaybill ||
            shipmentUpdatePayload.status ||
            shipmentUpdatePayload.waybill_source
          ) {
            await upsertShipmentPatch(adminClient, body.orderId, shipmentUpdatePayload);
            shipmentUpdated = true;
          }

          return updatedOrder;
        },
        shouldRollback: (updatedOrder) => Boolean(updatedOrder),
        rollback: () => restoreMutationState(adminClient, {
          orderId: body.orderId,
          rollbackTimestamp: new Date().toISOString(),
          originalOrderStatus: order.status,
          originalPaymentStatus: order.payment_status ?? null,
          originalShipment,
          operationTimestamp,
          revertPayment: paymentUpdated,
          revertShipment: shipmentUpdated,
        }),
        onRollbackError: (rollbackError, mutationError) => {
          console.error("[order-manager] Failed to rollback transition mutation:", {
            mutationError: String(mutationError),
            rollbackError: String(rollbackError),
            orderId: body.orderId,
          });
        },
      });

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
              shipmentUpdatePayload.waybill_source ?? order.waybill_source ?? null,
            override_reason: body.payload?.waybill_override_reason ?? null,
          },
        });

      if (activityError) {
        console.error("[order-manager] Failed to log activity:", activityError);
        // Don't throw - order already updated, just log the error
      }

      // Enqueue courier fulfillment if moving to awaiting_shipment
      if (to === "awaiting_shipment" && !order.biteship_order_id) {
        try {
          const existingTask = await getSideEffectTask(adminClient, body.orderId);
          await saveSideEffectTask(
            adminClient,
            body.orderId,
            existingTask?.needs_cart_cleanup ?? false, // Preserve existing flag
            existingTask?.needs_stock ?? false, // Preserve existing flag
            true, // Enable courier creation
            existingTask?.last_error ?? null,
            existingTask?.pending_biteship_order_id ?? null,
            existingTask?.pending_tracking_id ?? null,
            existingTask?.pending_waybill_number ?? null,
            null, // leaseOwner
            existingTask?.last_error_code ?? null,
            existingTask?.failed_permanently_at ? true : false,
          );
          triggerWebhookSideEffectProcessor(body.orderId);
        } catch (queueError) {
          console.error("[order-manager] Failed to enqueue biteship side effect:", queueError);
          // Non-blocking: we continue since DB status already changed
        }
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

        await upsertShipmentPatch(adminClient, body.orderId, {
          provider: "biteship",
          biteship_order_id: order.biteship_order_id,
          biteship_tracking_id: trackingId,
          waybill_number: recoveredWaybill || order.waybill_number || null,
          waybill_source: recoveredWaybill ? "system" : order.waybill_source,
          updated_at: new Date().toISOString(),
        });
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
      const statusResolution = resolveBiteshipStatus(trackingStatus, order.status);
      const nextStatus = statusResolution.nextStatus;

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

      const operationTimestamp = new Date().toISOString();
      const originalShipment = await readShipmentSnapshot(adminClient, body.orderId);
      let shipmentUpdated = false;

      const updated = await runMutationWithRollback({
        apply: async () => {
          const { data: updatedOrder, error: updateError } = await adminClient
            .from("orders")
            .update({
              status: nextStatus,
              updated_at: operationTimestamp,
            })
            .eq("id", body.orderId)
            .eq("status", order.status)
            .select(
              "id, status, updated_at",
            )
            .single();

          if (updateError) {
            throw updateError;
          }

          await upsertShipmentPatch(adminClient, body.orderId, {
            provider: "biteship",
            status: nextStatus,
            biteship_order_id: order.biteship_order_id,
            biteship_tracking_id: trackingId,
            waybill_number: syncWaybill,
            waybill_source: syncWaybillSource,
            latest_biteship_status: trackingStatus,
            updated_at: operationTimestamp,
          });
          shipmentUpdated = true;

          return updatedOrder;
        },
        shouldRollback: (updatedOrder) => Boolean(updatedOrder),
        rollback: () => restoreMutationState(adminClient, {
          orderId: body.orderId,
          rollbackTimestamp: new Date().toISOString(),
          originalOrderStatus: order.status,
          originalPaymentStatus: order.payment_status ?? null,
          originalShipment,
          operationTimestamp,
          revertPayment: false,
          revertShipment: shipmentUpdated,
        }),
        onRollbackError: (rollbackError, mutationError) => {
          console.error("[order-manager] Failed to rollback sync mutation:", {
            mutationError: String(mutationError),
            rollbackError: String(rollbackError),
            orderId: body.orderId,
          });
        },
      });

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
            biteship_status_mapped: statusResolution.mapped,
            biteship_exception_status: statusResolution.exception?.status ?? null,
            biteship_exception_alert_type: statusResolution.exception?.alertType ?? null,
            biteship_exception_message_key: statusResolution.exception?.messageKey ?? null,
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
