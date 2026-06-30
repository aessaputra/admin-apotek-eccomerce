export type SupabaseAdminClient = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (tableName: string) => any;
};

/**
 * Biteship webhook event types.
 * See: https://biteship.com/id/docs/api/webhook/overview
 */
export type BiteshipWebhookEvent = "order.status" | "order.waybill_id" | "order.price";

/** Payload sent by Biteship for `order.status` and `order.waybill_id` events. */
export interface BiteshipWebhookPayload {
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

export interface ShipmentRow {
  order_id: string;
  biteship_order_id: string | null;
  biteship_tracking_id: string | null;
  waybill_number: string | null;
  waybill_source: string | null;
  status: string | null;
  latest_biteship_status: string | null;
}

export interface OrderRow {
  id: string;
  user_id: string | null;
  status: string;
  payment_status: string;
}
