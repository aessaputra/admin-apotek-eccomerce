import type { MidtransStatusMapping, MidtransStatusResponse, Order, AuthUser, SnapPayload, SnapItemDetail } from './types.ts'

/**
 * Validates Midtrans webhook signature using SHA512.
 */
export const verifyMidtransSignature = async (
    orderId: string,
    statusCode: string,
    grossAmount: string,
    serverKey: string,
    providedSignature: string
): Promise<boolean> => {
    const rawString = `${orderId}${statusCode}${grossAmount}${serverKey}`
    const encoder = new TextEncoder()
    const data = encoder.encode(rawString)
    const hashBuffer = await crypto.subtle.digest('SHA-512', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const generatedSignature = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')

    return generatedSignature === providedSignature
}

/**
 * Double-verify payment status by calling Midtrans GET Status API.
 * Prevents spoofed webhook payloads — even if signature matches,
 * we confirm the real transaction status directly from Midtrans servers.
 *
 * Docs: https://docs.midtrans.com/reference/get-transaction-status
 */
export const verifyMidtransTransaction = async (
    orderId: string,
    serverKey: string
): Promise<MidtransStatusResponse> => {
    const isProduction = Deno.env.get('MIDTRANS_IS_PRODUCTION') === 'true'
    const baseUrl = isProduction
        ? 'https://api.midtrans.com/v2'
        : 'https://api.sandbox.midtrans.com/v2'

    const response = await fetch(`${baseUrl}/${orderId}/status`, {
        method: 'GET',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': `Basic ${btoa(`${serverKey}:`)}`
        }
    })

    const data = await response.json()

    if (!response.ok) {
        throw new Error(`Midtrans status check failed: ${data.status_message || response.statusText}`)
    }

    return data as MidtransStatusResponse
}

/**
 * Maps Midtrans transaction_status and fraud_status to local unified statuses.
 */
export const mapMidtransStatus = (
    transactionStatus: string,
    fraudStatus: string,
    currentPaymentStatus: string,
    currentOrderStatus: string
): MidtransStatusMapping => {
    let newPaymentStatus = currentPaymentStatus
    let newOrderStatus = currentOrderStatus
    let shouldReduceStock = false

    // Payment accepted: move to awaiting_shipment first.
    // Shipping automation (Biteship) will advance status to processing.
    if (transactionStatus === 'capture') {
        if (fraudStatus === 'challenge') {
            newPaymentStatus = 'pending'
        } else if (fraudStatus === 'accept') {
            newPaymentStatus = 'success'
            newOrderStatus = 'awaiting_shipment'
            shouldReduceStock = true
        }
    } else if (transactionStatus === 'settlement') {
        newPaymentStatus = 'success'
        newOrderStatus = 'awaiting_shipment'
        shouldReduceStock = true
    } else if (['cancel', 'deny', 'expire'].includes(transactionStatus)) {
        newPaymentStatus = 'failed'
        newOrderStatus = 'cancelled'
    } else if (transactionStatus === 'pending') {
        newPaymentStatus = 'pending'
    }

    return { newPaymentStatus, newOrderStatus, shouldReduceStock }
}

/**
 * Helper to build the Snap API payload from DB Order record.
 */
export const buildSnapPayload = (order: Order, user: AuthUser): SnapPayload => {
    let calculatedGrossAmount = 0

    const itemDetails: SnapItemDetail[] = (order.order_items || []).map((item) => {
        const price = Math.round(Number(item.price_at_purchase))
        const quantity = Number(item.quantity)
        calculatedGrossAmount += (price * quantity)

        return {
            id: item.product_id,
            price: price,
            quantity: quantity,
            name: item.products?.name?.slice(0, 50) || 'Product',
            category: item.products?.categories?.name?.slice(0, 50) || 'General'
        }
    })

    // Add shipping if any
    if (order.shipping_cost && Number(order.shipping_cost) > 0) {
        const shippingPrice = Math.round(Number(order.shipping_cost))
        calculatedGrossAmount += shippingPrice
        itemDetails.push({
            id: 'SHIPPING-FEE',
            price: shippingPrice,
            quantity: 1,
            name: 'Ongkos Kirim',
            category: 'Shipping'
        })
    }

    const customerDetails = {
        first_name: order.profiles?.full_name?.split(' ')[0] || 'Customer',
        last_name: order.profiles?.full_name?.split(' ').slice(1).join(' ') || '',
        email: user.email || '',
        phone: order.profiles?.phone_number || ''
    }

    return {
        transaction_details: {
            order_id: order.midtrans_order_id!,
            gross_amount: calculatedGrossAmount
        },
        item_details: itemDetails,
        customer_details: customerDetails
    }
}
