import type { BiteshipWebhookPayload, OrderRow, ShipmentRow, SupabaseAdminClient } from "../types.ts";
import { jsonResponse, errorResponse } from "../utils/responses.ts";
import { normalizeWaybillNumber } from "../utils/waybill-helpers.ts";

export async function handleWaybillUpdate(
  adminClient: SupabaseAdminClient,
  payload: BiteshipWebhookPayload,
  shipmentRow: ShipmentRow,
  orderRow: OrderRow
): Promise<Response> {
  const waybill = normalizeWaybillNumber(payload.courier_waybill_id);
  const trackingId = payload.courier_tracking_id?.trim() || null;
  const orderId = orderRow.id;

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
