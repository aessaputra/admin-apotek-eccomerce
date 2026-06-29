import type { ReactNode } from "react";

export interface OrderItem {
  id: string;
  product_id: string;
  quantity: number;
  price_at_purchase: string | number;
  product_sku_at_purchase?: string | null;
  products?: { name: string } | null;
}

export interface OrderRecord {
  id: string;
  user_id: string;
  shipping_address_id?: string | null;
  total_amount: string | number;
  status: string;
  customer_completion_stage?: string | null;
  delivered_at?: string | null;
  complaint_window_expires_at?: string | null;
  customer_completed_at?: string | null;
  customer_completion_source?: string | null;
  payment_status: string;
  shipping_cost?: string | number | null;
  courier_code?: string | null;
  courier_service?: string | null;
  shipping_etd?: string | null;
  waybill_number?: string | null;
  waybill_source?: string | null;
  payment_type?: string | null;
  midtrans_order_id?: string | null;
  midtrans_transaction_id?: string | null;
  biteship_order_id?: string | null;
  biteship_tracking_id?: string | null;
  created_at: string;
  updated_at?: string | null;
  customer?: {
    full_name?: string | null;
    phone_number?: string | null;
    email?: string | null;
  } | null;
  shipping_address?: {
    receiver_name?: string | null;
    phone_number?: string | null;
    street_address?: string | null;
    city?: string | null;
    province?: string | null;
    postal_code?: string | null;
    area_name?: string | null;
    address_note?: string | null;
    country_code?: string | null;
  } | null;
  order_items?: OrderItem[];
}

export interface Activity {
  id: string;
  action: string;
  old_status: string | null;
  new_status: string | null;
  actor_type: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface BiteshipExceptionInfo {
  status: string;
  alertType: "warning" | "error" | "info";
  messageKey: string;
}

export interface DetailListItem {
  label: string;
  value: ReactNode;
}
