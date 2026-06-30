import { corsHeaders } from "../_shared/cors.ts";
import {
  type NotificationInsertPayload,
  ORDER_DETAIL_NOTIFICATION_ROUTE,
  TRACK_SHIPMENT_NOTIFICATION_ROUTE,
  insertNotificationOrThrow,
} from "../_shared/notification-helpers.ts";
import { resolveBiteshipStatus } from "../_shared/order-status.ts";

type SupabaseAdminClient = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (tableName: string) => any;
};

/**
 * Biteship webhook event types.
 * See: https://biteship.com/id/docs/api/webhook/overview
 */
type BiteshipWebhookEvent = "order.status" | "order.waybill_id" | "order.price";

/** Payload sent by Biteship for `order.status` and `order.waybill_id` events. */
interface BiteshipWebhookPayload {
  event: BiteshipWebhookEvent;
  order_id: string;
  status?: string;
  courier_tracking_id?: string;
  courier_waybill_id?: string;
  courier_company?: string;
  courier_type?: string;
  courier_driver_name?: string;
  courier_driver_phone?: string;
  courier_driver_photo_url?: string;
  courier_driver_plate_number?: string;
  courier_link?: string;
  order_price?: number;
}

interface ShipmentRow {
  order_id: string;
  biteship_order_id: string | null;
  biteship_tracking_id: string | null;
  waybill_number: string | null;
  waybill_source: string | null;
  status: string | null;
  latest_biteship_status: string | null;
}

interface OrderRow {
  id: string;
  user_id: string | null;
  status: string;
  payment_status: string;
}

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

const JSON_HEADERS = { "Content-Type": "application/json" };

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, ...JSON_HEADERS },
  });
}

function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

/**
 * Can the synced status be applied forward-only?
 * Same logic as order-manager's canApplySyncedStatus.
 */
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

/**
 * Build a customer-facing push notification for a shipping status change.
 * Mirrors order-manager's notification builder for webhook-driven updates.
 */
function buildShipmentNotification(
  nextStatus: string,
  orderId: string,
): Pick<
  NotificationInsertPayload,
  "type" | "title" | "body" | "ctaRoute" | "data" | "priority" | "sourceEventKey"
> | null {
  if (nextStatus === "shipped") {
    return {
      type: "order_shipped",
      title: "Pesanan dikirim",
      body: "Pesananmu sudah dikirim. Kamu bisa melacak pengiriman dari aplikasi.",
      ctaRoute: TRACK_SHIPMENT_NOTIFICATION_ROUTE,
      data: { orderId, shipmentStage: "shipped" },
      priority: "high",
      sourceEventKey: `order_shipped:webhook:${orderId}`,
    };
  }

  if (nextStatus === "in_transit") {
    return {
      type: "order_shipped",
      title: "Pesanan dalam perjalanan",
      body: "Pesananmu sedang dalam perjalanan. Pantau status terbarunya di aplikasi.",
      ctaRoute: TRACK_SHIPMENT_NOTIFICATION_ROUTE,
      data: { orderId, shipmentStage: "in_transit" },
      priority: "normal",
      sourceEventKey: `order_shipped:webhook_in_transit:${orderId}`,
    };
  }

  if (nextStatus === "delivered") {
    return {
      type: "order_delivered_action_required",
      title: "Pesanan sudah tiba",
      body: "Pesananmu sudah tiba. Konfirmasi penerimaan jika pesanan sudah sesuai.",
      ctaRoute: ORDER_DETAIL_NOTIFICATION_ROUTE,
      data: { orderId },
      priority: "high",
      sourceEventKey: `order_delivered_action_required:webhook:${orderId}`,
    };
  }

  return null;
}

const WAYBILL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{4,63}$/;

function normalizeWaybillNumber(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim();
  if (!normalizedValue) {
    return null;
  }

  return WAYBILL_PATTERN.test(normalizedValue) ? normalizedValue : null;
}

/**
 * Validate the webhook secret token from query string.
 * Returns true if the token matches the configured secret.
 */
function validateWebhookSecret(req: Request, expectedSecret: string): boolean {
  const url = new URL(req.url);
  const token = url.searchParams.get("secret");
  return token === expectedSecret;
}

export function createBiteshipWebhookHandler(dependencies: {
  getAdminClient: () => SupabaseAdminClient;
  getWebhookSecret?: () => Promise<string | null> | string | null;
}): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    if (req.method !== "POST") {
      return errorResponse("Method Not Allowed", 405);
    }

    try {
      // --- Secret token validation ---
      const webhookSecret = await Promise.resolve(dependencies.getWebhookSecret?.() ?? null);
      if (webhookSecret && !validateWebhookSecret(req, webhookSecret)) {
        console.error("[biteship-webhook] Invalid webhook secret token");
        return errorResponse("Unauthorized", 401);
      }

      // --- Parse and validate payload ---
      let payload: BiteshipWebhookPayload;
      try {
        payload = (await req.json()) as BiteshipWebhookPayload;
      } catch {
        console.error("[biteship-webhook] Invalid JSON payload");
        return errorResponse("Invalid JSON payload", 400);
      }

      if (!payload.event || !payload.order_id) {
        console.error("[biteship-webhook] Missing required fields", {
          event: payload.event,
          order_id: payload.order_id,
        });
        return errorResponse("Missing required fields: event, order_id", 400);
      }

      const adminClient = dependencies.getAdminClient();

      // --- Handle order.price event (log only, no status change) ---
      if (payload.event === "order.price") {
        console.info("[biteship-webhook] Price update received", {
          order_id: payload.order_id,
          order_price: payload.order_price,
        });
        // Price updates are logged but do not affect order status.
        // Future: could update shipping cost in payments/orders table.
        return jsonResponse({ status: "ok", message: "Price update acknowledged" });
      }

      // --- Lookup shipment by Biteship order ID ---
      const { data: shipment, error: shipmentError } = await adminClient
        .from("shipments")
        .select(
          "order_id, biteship_order_id, biteship_tracking_id, waybill_number, waybill_source, status, latest_biteship_status",
        )
        .eq("biteship_order_id", payload.order_id)
        .maybeSingle();

      if (shipmentError) {
        console.error("[biteship-webhook] Shipment lookup error", {
          error: shipmentError.message,
          biteship_order_id: payload.order_id,
        });
        return errorResponse("Internal error", 500);
      }

      if (!shipment) {
        console.warn("[biteship-webhook] No shipment found for Biteship order", {
          biteship_order_id: payload.order_id,
        });
        // Return 200 to prevent Biteship from retrying for orders we don't have.
        // This can happen with stale webhooks or test orders.
        return jsonResponse({
          status: "ignored",
          message: "No matching shipment found",
        });
      }

      const shipmentRow = shipment as ShipmentRow;
      const orderId = shipmentRow.order_id;

      // --- Lookup internal order ---
      const { data: order, error: orderError } = await adminClient
        .from("order_read_model")
        .select("id, user_id, status, payment_status")
        .eq("id", orderId)
        .single();

      if (orderError || !order) {
        console.error("[biteship-webhook] Order not found", {
          order_id: orderId,
          error: orderError?.message,
        });
        return jsonResponse({
          status: "ignored",
          message: "Order not found",
        });
      }

      const orderRow = order as OrderRow;

      // --- Handle order.waybill_id event ---
      if (payload.event === "order.waybill_id") {
        const waybill = normalizeWaybillNumber(payload.courier_waybill_id);
        const trackingId = payload.courier_tracking_id?.trim() || null;

        if (!waybill && !trackingId) {
          return jsonResponse({
            status: "ignored",
            message: "No waybill or tracking data in payload",
          });
        }

        const shipmentPatch: Record<string, unknown> = {
          updated_at: new Date().toISOString(),
        };

        if (waybill && waybill !== shipmentRow.waybill_number) {
          shipmentPatch.waybill_number = waybill;
          shipmentPatch.waybill_source = "system";
        }

        if (trackingId && trackingId !== shipmentRow.biteship_tracking_id) {
          shipmentPatch.biteship_tracking_id = trackingId;
        }

        // Only update if there are actual changes
        if (Object.keys(shipmentPatch).length > 1) {
          const { error: updateError } = await adminClient
            .from("shipments")
            .update(shipmentPatch)
            .eq("order_id", orderId);

          if (updateError) {
            console.error("[biteship-webhook] Shipment waybill update failed", {
              order_id: orderId,
              error: updateError.message,
            });
            return errorResponse("Shipment update failed", 500);
          }

          await adminClient.from("order_activities").insert({
            order_id: orderId,
            action: "webhook_tracking",
            old_status: orderRow.status,
            new_status: orderRow.status,
            actor_type: "system",
            metadata: {
              event: "order.waybill_id",
              biteship_order_id: payload.order_id,
              tracking_id: trackingId,
              waybill: waybill,
              source: "biteship_webhook",
            },
          });
        }

        return jsonResponse({ status: "ok", message: "Waybill updated" });
      }

      // --- Handle order.status event ---
      if (payload.event === "order.status") {
        const biteshipStatus = payload.status?.trim();
        if (!biteshipStatus) {
          return errorResponse("Missing status in order.status event", 400);
        }

        // --- Idempotency check ---
        if (shipmentRow.latest_biteship_status === biteshipStatus) {
          return jsonResponse({
            status: "ok",
            message: "Status already up to date (idempotent)",
          });
        }

        // --- Guard: don't process if order is in terminal state ---
        if (TERMINAL_STATUSES.has(orderRow.status)) {
          console.info("[biteship-webhook] Order already terminal, skipping", {
            order_id: orderId,
            order_status: orderRow.status,
            biteship_status: biteshipStatus,
          });
          // Still update latest_biteship_status for audit trail
          await adminClient
            .from("shipments")
            .update({
              latest_biteship_status: biteshipStatus,
              updated_at: new Date().toISOString(),
            })
            .eq("order_id", orderId);

          return jsonResponse({
            status: "ok",
            message: "Order already in terminal status",
          });
        }

        // --- Guard: payment must be settled for status progression ---
        if (orderRow.payment_status !== "settlement" && orderRow.payment_status !== "capture") {
          console.info("[biteship-webhook] Payment not settled, storing status only", {
            order_id: orderId,
            payment_status: orderRow.payment_status,
            biteship_status: biteshipStatus,
          });
          // Store the biteship status but don't advance the order
          await adminClient
            .from("shipments")
            .update({
              latest_biteship_status: biteshipStatus,
              updated_at: new Date().toISOString(),
            })
            .eq("order_id", orderId);

          return jsonResponse({
            status: "ok",
            message: "Payment not settled, status stored for later sync",
          });
        }

        // --- Resolve Biteship status to internal status ---
        const statusResolution = resolveBiteshipStatus(biteshipStatus, orderRow.status);
        const nextStatus = statusResolution.nextStatus;

        if (!canApplySyncedStatus(orderRow.status, nextStatus)) {
          console.info("[biteship-webhook] Status would go backward, skipping", {
            order_id: orderId,
            current: orderRow.status,
            resolved: nextStatus,
            biteship_status: biteshipStatus,
          });
          // Store the raw biteship status anyway for audit
          await adminClient
            .from("shipments")
            .update({
              latest_biteship_status: biteshipStatus,
              updated_at: new Date().toISOString(),
            })
            .eq("order_id", orderId);

          return jsonResponse({
            status: "ok",
            message: "Status not advanced (forward-only rule)",
          });
        }

        // --- Extract waybill/tracking from payload ---
        const webhookWaybill = normalizeWaybillNumber(payload.courier_waybill_id);
        const webhookTrackingId = payload.courier_tracking_id?.trim() || null;
        const effectiveWaybill = webhookWaybill || shipmentRow.waybill_number || null;
        const effectiveTrackingId = webhookTrackingId || shipmentRow.biteship_tracking_id || null;

        // --- Guard: shipped requires waybill ---
        if (nextStatus === "shipped" && !effectiveWaybill) {
          console.warn("[biteship-webhook] Cannot set shipped without waybill", {
            order_id: orderId,
            biteship_status: biteshipStatus,
          });
          await adminClient
            .from("shipments")
            .update({
              latest_biteship_status: biteshipStatus,
              biteship_tracking_id: effectiveTrackingId,
              updated_at: new Date().toISOString(),
            })
            .eq("order_id", orderId);

          return jsonResponse({
            status: "ok",
            message: "Awaiting waybill for shipped status",
          });
        }

        const operationTimestamp = new Date().toISOString();

        // --- Update order status ---
        const statusChanged = orderRow.status !== nextStatus;
        if (statusChanged) {
          const { error: orderUpdateError } = await adminClient
            .from("orders")
            .update({
              status: nextStatus,
              updated_at: operationTimestamp,
            })
            .eq("id", orderId)
            .eq("status", orderRow.status); // Optimistic concurrency

          if (orderUpdateError) {
            console.error("[biteship-webhook] Order status update failed", {
              order_id: orderId,
              error: orderUpdateError.message,
            });
            return errorResponse("Order update failed, retry later", 503);
          }
        }

        // --- Update shipment ---
        const shipmentPatch: Record<string, unknown> = {
          provider: "biteship",
          status: nextStatus,
          biteship_order_id: payload.order_id,
          biteship_tracking_id: effectiveTrackingId,
          waybill_number: effectiveWaybill,
          waybill_source: effectiveWaybill ? "system" : shipmentRow.waybill_source,
          latest_biteship_status: biteshipStatus,
          updated_at: operationTimestamp,
        };

        const { error: shipmentUpdateError } = await adminClient
          .from("shipments")
          .update(shipmentPatch)
          .eq("order_id", orderId);

        if (shipmentUpdateError) {
          console.error("[biteship-webhook] Shipment update failed", {
            order_id: orderId,
            error: shipmentUpdateError.message,
          });
          // Order status may already be updated — log but don't fail
        }

        // --- Log activity ---
        const activityMetadata: Record<string, unknown> = {
          event: "order.status",
          biteship_order_id: payload.order_id,
          tracking_id: effectiveTrackingId,
          biteship_status: biteshipStatus,
          biteship_status_mapped: statusResolution.mapped,
          waybill: effectiveWaybill,
          waybill_source: effectiveWaybill ? "system" : shipmentRow.waybill_source,
          source: "biteship_webhook",
          courier_company: payload.courier_company || null,
          courier_type: payload.courier_type || null,
        };

        if (statusResolution.exception) {
          activityMetadata.biteship_exception_status = statusResolution.exception.status;
          activityMetadata.biteship_exception_alert_type = statusResolution.exception.alertType;
          activityMetadata.biteship_exception_message_key = statusResolution.exception.messageKey;
        }

        const activityAction = statusResolution.exception
          ? "shipment_tracking_exception"
          : "webhook_tracking";

        const { error: activityError } = await adminClient
          .from("order_activities")
          .insert({
            order_id: orderId,
            action: activityAction,
            old_status: orderRow.status,
            new_status: nextStatus,
            actor_type: "system",
            metadata: activityMetadata,
          });

        if (activityError) {
          console.error("[biteship-webhook] Activity log failed", {
            order_id: orderId,
            error: activityError.message,
          });
          // Non-blocking — order already updated
        }

        // --- Send push notification ---
        if (statusChanged) {
          const notification = buildShipmentNotification(nextStatus, orderId);
          if (notification && orderRow.user_id) {
            try {
              await insertNotificationOrThrow(
                adminClient,
                {
                  userId: orderRow.user_id,
                  type: notification.type,
                  title: notification.title,
                  body: notification.body,
                  ctaRoute: notification.ctaRoute,
                  data: notification.data,
                  priority: notification.priority,
                  sourceEventKey: notification.sourceEventKey,
                },
                "[biteship-webhook]",
              );
            } catch (notifError) {
              console.error("[biteship-webhook] Notification failed", {
                order_id: orderId,
                error: notifError instanceof Error ? notifError.message : String(notifError),
              });
              // Non-blocking — order already updated
            }
          }
        }

        return jsonResponse({
          status: "ok",
          data: {
            order_id: orderId,
            previous_status: orderRow.status,
            new_status: nextStatus,
            biteship_status: biteshipStatus,
            status_changed: statusChanged,
          },
        });
      }

      // --- Unknown event type ---
      console.warn("[biteship-webhook] Unknown event type", {
        event: payload.event,
        order_id: payload.order_id,
      });
      return jsonResponse({
        status: "ignored",
        message: `Unknown event type: ${payload.event}`,
      });
    } catch (error: unknown) {
      console.error("[biteship-webhook] Internal error:", {
        error: error instanceof Error ? error.message : String(error),
      });
      return errorResponse("Internal error", 500);
    }
  };
}
