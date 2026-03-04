import type { Order, BiteshipOrderPayload, BiteshipOrderResponse, BiteshipOrderItem } from './types.ts'

/**
 * Biteship API Utilities for Edge Functions
 */

export const createBiteshipOrder = async (order: Order, apiKey: string): Promise<BiteshipOrderResponse> => {
    const BITESHIP_BASE_URL = 'https://api.biteship.com/v1'

    // Validate required order fields
    if (!order.origin_area_id) throw new Error('Missing origin_area_id on order')
    if (!order.destination_area_id) throw new Error('Missing destination_area_id on order')
    if (!order.courier_code) throw new Error('Missing courier_code on order')
    if (!order.courier_service) throw new Error('Missing courier_service on order')

    // Shipper info from env vars (configurable per deployment)
    const shipperName = Deno.env.get('SHOP_SHIPPER_NAME') || 'Apotek Sehat'
    const shipperPhone = Deno.env.get('SHOP_SHIPPER_PHONE') || '08123456789'
    const shopAddress = Deno.env.get('SHOP_ADDRESS') || 'Alamat Toko Apotek'

    // Construct items with proper types
    const items: BiteshipOrderItem[] = (order.order_items || []).map((item) => ({
        name: item.products?.name || 'Product',
        description: item.products?.description || '',
        value: Math.round(Number(item.price_at_purchase)),
        quantity: Number(item.quantity),
        weight: Number(item.products?.weight || 200),
    }))

    // Construct payload
    // Reference: https://biteship.com/en/docs/api/orders/create
    const payload: BiteshipOrderPayload = {
        shipper_contact_name: shipperName,
        shipper_contact_phone: shipperPhone,
        origin_contact_name: shipperName,
        origin_contact_phone: shipperPhone,
        origin_address: shopAddress,
        origin_area_id: order.origin_area_id,

        destination_contact_name: order.profiles?.full_name || 'Customer',
        destination_contact_phone: order.addresses?.phone_number || shipperPhone,
        destination_address: order.addresses?.street_address || 'Alamat Tujuan',
        destination_area_id: order.destination_area_id,

        courier_company: order.courier_code,
        courier_type: order.courier_service,

        items: items
    }

    console.log(`[biteship] Creating order for ${order.id}...`)

    const response = await fetch(`${BITESHIP_BASE_URL}/orders`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload)
    })

    const result = await response.json()

    if (!response.ok) {
        console.error(`[biteship] API Error:`, JSON.stringify(result))
        throw new Error(result.message || 'Failed to create Biteship order')
    }

    return result as BiteshipOrderResponse
}
