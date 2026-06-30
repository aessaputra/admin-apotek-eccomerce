import { corsHeaders } from "../_shared/cors.ts";
import type { BiteshipWebhookPayload, OrderRow, ShipmentRow, SupabaseAdminClient } from "./types.ts";
import { jsonResponse, errorResponse } from "./utils/responses.ts";
import { parseBiteshipPayload, validateWebhookSecret } from "./utils/validation.ts";
import { handleOrderStatus } from "./events/order-status.ts";
import { handleWaybillUpdate } from "./events/waybill-update.ts";

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
      const payloadOrResponse = await parseBiteshipPayload(req);
      if (payloadOrResponse instanceof Response) {
        return payloadOrResponse;
      }
      const payload = payloadOrResponse as BiteshipWebhookPayload;

      if (!payload.event || !payload.order_id) {
        console.error("[biteship-webhook] Missing required fields", {
          event: payload.event,
          order_id: payload.order_id,
          rawPayload: payload,
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

      // --- Route to specific event handlers ---
      if (payload.event === "order.waybill_id") {
        return handleWaybillUpdate(adminClient, payload, shipmentRow, orderRow);
      }

      if (payload.event === "order.status") {
        return handleOrderStatus(adminClient, payload, shipmentRow, orderRow);
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
