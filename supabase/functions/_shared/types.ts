export type PaymentStatus =
  | "pending"
  | "authorize"
  | "settlement"
  | "deny"
  | "cancel"
  | "expire"
  | "refund"
  | "partial_refund"
  | "chargeback"
  | "partial_chargeback";

export interface AuthUser {
  id: string;
  email: string;
}

export interface OrderProductCategory {
  name?: string | null;
}

export interface OrderProduct {
  name?: string | null;
  categories?: OrderProductCategory | null;
  description?: string | null;
  weight?: number | null;
}

export interface OrderItem {
  product_id?: string | null;
  quantity?: number | null;
  price_at_purchase?: number | string | null;
  products?: OrderProduct | null;
}

export interface OrderProfile {
  id?: string | null;
  full_name?: string | null;
  phone_number?: string | null;
}

export interface OrderAddress {
  id?: string | null;
  receiver_name?: string | null;
  phone_number?: string | null;
  street_address?: string | null;
  address_note?: string | null;
  city?: string | null;
  province?: string | null;
  postal_code?: string | null;
  country_code?: string | null;
  area_id?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface MidtransAddress {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  postal_code?: string;
  country_code?: string;
}

export interface Order {
  id: string;
  user_id?: string | null;
  status: string;
  payment_status: PaymentStatus;
  payment_type?: string | null;
  currency?: string | null;
  total_amount: number | string;
  shipping_cost?: number | string | null;
  gross_amount?: number | string | null;
  expired_at?: string | null;
  checkout_idempotency_key?: string | null;
  midtrans_order_id?: string | null;
  midtrans_transaction_id?: string | null;
  snap_token?: string | null;
  snap_redirect_url?: string | null;
  snap_token_created_at?: string | null;
  paid_at?: string | null;
  biteship_order_id?: string | null;
  biteship_tracking_id?: string | null;
  shipping_etd?: string | null;
  waybill_number?: string | null;
  waybill_source?: "system" | "manual" | null;
  origin_area_id?: string | null;
  destination_area_id?: string | null;
  destination_postal_code?: number | null;
  shipping_address_id?: string | null;
  courier_code?: string | null;
  courier_service?: string | null;
  order_items?: OrderItem[] | null;
  profiles?: OrderProfile | null;
  addresses?: OrderAddress | null;
}

export interface SnapItemDetail {
  id: string;
  price: number;
  quantity: number;
  name: string;
  category?: string;
}

export interface SnapPayload {
  transaction_details: {
    order_id: string;
    gross_amount: number;
  };
  credit_card?: {
    secure: boolean;
  };
  item_details: SnapItemDetail[];
  customer_details: {
    first_name: string;
    last_name?: string;
    email: string;
    phone?: string;
    billing_address?: MidtransAddress;
    shipping_address?: MidtransAddress;
  };
}

export interface SnapResponse {
  token: string;
  redirect_url: string;
}

export interface MidtransStatusResponse {
  transaction_id?: string;
  order_id?: string;
  transaction_status: string;
  fraud_status?: string;
  status_code?: string;
  status_message?: string;
  gross_amount?: string;
  payment_type?: string;
  currency?: string;
  merchant_id?: string;
  transaction_time?: string;
  settlement_time?: string;
  expiry_time?: string;
  payment_code?: string;
  store?: string;
  va_numbers?: Array<Record<string, unknown>>;
  biller_code?: string;
  bill_key?: string;
  bank?: string;
  acquirer?: string;
  issuer?: string;
  card_type?: string;
  masked_card?: string;
  approval_code?: string;
  eci?: string;
  channel_response_code?: string;
  channel_response_message?: string;
  redirect_url?: string;
}

export interface MidtransStatusLike {
  transaction_status?: string;
  fraud_status?: string | null;
  status_code?: string | null;
}

export interface MidtransWebhookPayload {
  order_id: string;
  transaction_id?: string;
  transaction_status?: string;
  fraud_status?: string;
  status_code: string;
  status_message?: string;
  gross_amount: string;
  signature_key: string;
  payment_type?: string;
  currency?: string;
  merchant_id?: string;
  transaction_time?: string;
  settlement_time?: string;
  expiry_time?: string;
  payment_code?: string;
  store?: string;
  va_numbers?: Array<Record<string, unknown>>;
  biller_code?: string;
  bill_key?: string;
  bank?: string;
  acquirer?: string;
  issuer?: string;
  card_type?: string;
  masked_card?: string;
  approval_code?: string;
  eci?: string;
  channel_response_code?: string;
  channel_response_message?: string;
  redirect_url?: string;
}

export interface MidtransStatusMapping {
  newPaymentStatus: PaymentStatus;
  newOrderStatus: string;
  shouldReduceStock: boolean;
}

export interface BiteshipCourierInfo {
  tracking_id: string;
  waybill_id: string;
  company: string;
  type: string;
}

export interface BiteshipOrderResponse {
  success: boolean;
  id: string;
  status: string;
  courier: BiteshipCourierInfo;
}
