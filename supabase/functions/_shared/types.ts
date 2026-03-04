/**
 * Shared TypeScript interfaces for Edge Functions
 */

// ─── Database / Supabase Row Types ──────────────────────────────────

export interface OrderProfile {
    full_name?: string
    phone_number?: string
    id?: string
}

export interface OrderAddress {
    street_address?: string
    phone_number?: string
    city?: string
    province?: string
    postal_code?: string
}

export interface ProductCategory {
    name?: string
}

export interface OrderProduct {
    name?: string
    description?: string
    weight?: number
    categories?: ProductCategory
}

export interface OrderItem {
    product_id: string
    price_at_purchase: number
    quantity: number
    products?: OrderProduct
}

export interface Order {
    id: string
    user_id: string
    midtrans_order_id?: string
    midtrans_transaction_id?: string
    payment_type?: string
    payment_status: string
    status: string
    total_amount: number
    shipping_cost?: number
    shipping_address_id?: string
    courier_code?: string
    courier_service?: string
    shipping_etd?: string
    origin_area_id?: string
    destination_area_id?: string
    biteship_order_id?: string
    waybill_number?: string
    order_items?: OrderItem[]
    profiles?: OrderProfile
    addresses?: OrderAddress
    created_at?: string
    updated_at?: string
}

export interface AuthUser {
    id: string
    email?: string
}

// ─── Midtrans Types ─────────────────────────────────────────────────

export interface MidtransWebhookPayload {
    order_id: string
    status_code: string
    gross_amount: string
    signature_key: string
    transaction_status: string
    fraud_status: string
    transaction_id: string
    payment_type: string
}

export interface MidtransStatusResponse {
    transaction_status: string
    fraud_status: string
    order_id: string
    status_code: string
    gross_amount: string
    transaction_id: string
    payment_type: string
    status_message?: string
}

export interface MidtransStatusMapping {
    newPaymentStatus: string
    newOrderStatus: string
    shouldReduceStock: boolean
}

export interface SnapItemDetail {
    id: string
    price: number
    quantity: number
    name: string
    category: string
}

export interface SnapPayload {
    transaction_details: {
        order_id: string
        gross_amount: number
    }
    item_details: SnapItemDetail[]
    customer_details: {
        first_name: string
        last_name: string
        email: string
        phone: string
    }
}

// ─── Biteship Types ─────────────────────────────────────────────────

export interface BiteshipOrderItem {
    name: string
    description: string
    value: number
    quantity: number
    weight: number
}

export interface BiteshipOrderPayload {
    shipper_contact_name: string
    shipper_contact_phone: string
    origin_contact_name: string
    origin_contact_phone: string
    origin_address: string
    origin_area_id: string
    destination_contact_name: string
    destination_contact_phone: string
    destination_address: string
    destination_area_id: string
    courier_company: string
    courier_type: string
    items: BiteshipOrderItem[]
}

export interface BiteshipOrderResponse {
    id: string
    courier?: {
        waybill_id?: string
    }
}
