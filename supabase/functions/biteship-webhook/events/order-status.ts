import { resolveBiteshipStatus } from "../../_shared/order-status.ts";
import {
  type NotificationInsertPayload,
  ORDER_DETAIL_NOTIFICATION_ROUTE,
  TRACK_SHIPMENT_NOTIFICATION_ROUTE,
  insertNotificationOrThrow,
} from "../../_shared/notification-helpers.ts";
import type { BiteshipWebhookPayload, OrderRow, ShipmentRow, SupabaseAdminClient } from "../types.ts";
import { jsonResponse, errorResponse } from "../utils/responses.ts";
import { normalizeWaybillNumber } from "../utils/waybill-helpers.ts";

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
      sourceEventKey: `order_shipped_delivery:${orderId}`,
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
      sourceEventKey: `order_shipped_delivery:${orderId}`,
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

export async function handleOrderStatus(
  adminClient: SupabaseAdminClient,
  payload: BiteshipWebhookPayload,
  shipmentRow: ShipmentRow,
  orderRow: OrderRow
): Promise<Response> {
  const biteshipStatus = payload.status?.trim();
  const orderId = orderRow.id;

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
