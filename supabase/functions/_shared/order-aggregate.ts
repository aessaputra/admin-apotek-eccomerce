import { getSupabaseAdminClient } from "./supabase.ts";
import type { Order } from "./types.ts";

type AdminClient = ReturnType<typeof getSupabaseAdminClient>;

type OrderBaseRow = {
  id: string;
  user_id?: string | null;
  total_amount: number | string;
  status: string;
  shipping_cost?: number | string | null;
  shipping_address_id?: string | null;
  created_at: string;
  updated_at?: string | null;
  order_items?: Order["order_items"];
  profiles?: Order["profiles"];
  addresses?: Order["addresses"];
};

type PaymentSnapshotRow = {
  order_id?: string | null;
  checkout_idempotency_key?: string | null;
  midtrans_order_id?: string | null;
  midtrans_transaction_id?: string | null;
  status?: Order["payment_status"] | null;
  currency?: string | null;
  payment_type?: string | null;
  gross_amount?: number | string | null;
  paid_at?: string | null;
  expiry_time?: string | null;
  snap_token?: string | null;
  redirect_url?: string | null;
  snap_token_created_at?: string | null;
};

type ShipmentSnapshotRow = {
  order_id?: string | null;
  courier_code?: string | null;
  courier_service?: string | null;
  shipping_etd?: string | null;
  origin_area_id?: string | null;
  destination_area_id?: string | null;
  destination_postal_code?: number | null;
  biteship_order_id?: string | null;
  biteship_tracking_id?: string | null;
  waybill_number?: string | null;
  waybill_source?: "system" | "manual" | null;
};

const ORDER_BASE_SELECT = `
  id,
  user_id,
  total_amount,
  status,
  shipping_cost,
  shipping_address_id,
  created_at,
  updated_at,
  profiles (id, full_name, phone_number),
  order_items (
    *,
    products (name, description, weight, categories(name))
  ),
  addresses (
    id,
    receiver_name,
    phone_number,
    street_address,
    address_note,
    city,
    province,
    postal_code,
    country_code,
    area_id,
    latitude,
    longitude
  )
`;

function mergeOrderAggregate(
  order: OrderBaseRow,
  payment: PaymentSnapshotRow | null,
  shipment: ShipmentSnapshotRow | null,
): Order {
  return {
    ...order,
    payment_status: payment?.status ?? "pending",
    currency: payment?.currency ?? null,
    payment_type: payment?.payment_type ?? null,
    gross_amount: payment?.gross_amount ?? null,
    expired_at: payment?.expiry_time ?? null,
    checkout_idempotency_key: payment?.checkout_idempotency_key ?? null,
    midtrans_order_id: payment?.midtrans_order_id ?? null,
    midtrans_transaction_id: payment?.midtrans_transaction_id ?? null,
    snap_token: payment?.snap_token ?? null,
    snap_redirect_url: payment?.redirect_url ?? null,
    snap_token_created_at: payment?.snap_token_created_at ?? null,
    paid_at: payment?.paid_at ?? null,
    biteship_order_id: shipment?.biteship_order_id ?? null,
    biteship_tracking_id: shipment?.biteship_tracking_id ?? null,
    waybill_number: shipment?.waybill_number ?? null,
    waybill_source: shipment?.waybill_source ?? null,
    destination_area_id: shipment?.destination_area_id ?? null,
    destination_postal_code: shipment?.destination_postal_code ?? null,
    origin_area_id: shipment?.origin_area_id ?? null,
    courier_code: shipment?.courier_code ?? null,
    courier_service: shipment?.courier_service ?? null,
    shipping_etd: shipment?.shipping_etd ?? null,
  };
}

async function getLatestPaymentForOrder(
  adminClient: AdminClient,
  orderId: string,
): Promise<PaymentSnapshotRow | null> {
  const { data, error } = await adminClient
    .from("payments")
    .select(
      "order_id, checkout_idempotency_key, midtrans_order_id, midtrans_transaction_id, status, currency, payment_type, gross_amount, paid_at, expiry_time, snap_token, redirect_url, snap_token_created_at",
    )
    .eq("order_id", orderId)
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch payment snapshot: ${error.message}`);
  }

  return (data as PaymentSnapshotRow | null) ?? null;
}

async function getLatestShipmentForOrder(
  adminClient: AdminClient,
  orderId: string,
): Promise<ShipmentSnapshotRow | null> {
  const { data, error } = await adminClient
    .from("shipments")
    .select(
      "order_id, courier_code, courier_service, shipping_etd, origin_area_id, destination_area_id, destination_postal_code, biteship_order_id, biteship_tracking_id, waybill_number, waybill_source",
    )
    .eq("order_id", orderId)
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch shipment snapshot: ${error.message}`);
  }

  return (data as ShipmentSnapshotRow | null) ?? null;
}

export async function getOrderAggregateById(
  adminClient: AdminClient,
  orderId: string,
): Promise<Order | null> {
  const { data, error } = await adminClient
    .from("orders")
    .select(ORDER_BASE_SELECT)
    .eq("id", orderId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch order ${orderId}: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  const baseOrder = data as OrderBaseRow;
  const [payment, shipment] = await Promise.all([
    getLatestPaymentForOrder(adminClient, orderId),
    getLatestShipmentForOrder(adminClient, orderId),
  ]);

  return mergeOrderAggregate(baseOrder, payment, shipment);
}

export async function getOrderAggregateByMidtransOrderId(
  adminClient: AdminClient,
  midtransOrderId: string,
): Promise<Order | null> {
  const { data, error } = await adminClient
    .from("payments")
    .select("order_id")
    .eq("midtrans_order_id", midtransOrderId)
    .not("order_id", "is", null)
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to resolve order by Midtrans order ID ${midtransOrderId}: ${error.message}`,
    );
  }

  const orderId = data?.order_id;
  if (!orderId || typeof orderId !== "string") {
    return null;
  }

  return getOrderAggregateById(adminClient, orderId);
}
