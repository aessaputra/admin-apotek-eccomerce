import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { getSupabaseAdminClient } from '../_shared/supabase.ts'
import { verifyMidtransSignature, verifyMidtransTransaction, mapMidtransStatus } from '../_shared/midtrans.ts'
import { createBiteshipOrder } from '../_shared/biteship.ts'
import type { MidtransWebhookPayload, Order, BiteshipOrderResponse } from '../_shared/types.ts'

Deno.serve(async (req) => {
    if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 })
    }

    try {
        const bodyText = await req.text()
        let payload: MidtransWebhookPayload
        try {
            payload = JSON.parse(bodyText)
        } catch {
            return new Response(JSON.stringify({ error: 'Invalid JSON payload' }), { status: 400 })
        }
        console.log('Received Midtrans webhook:', JSON.stringify(payload, null, 2))

        const serverKey = Deno.env.get('MIDTRANS_SERVER_KEY')
        const biteshipKey = Deno.env.get('BITESHIP_API_KEY')
        if (!serverKey) throw new Error('Midtrans server key not configured')

        const {
            order_id, status_code, gross_amount, signature_key,
            transaction_status, fraud_status, transaction_id, payment_type
        } = payload

        // 1. Verify Signature
        const isValidSignature = await verifyMidtransSignature(
            order_id, status_code, gross_amount, serverKey, signature_key
        )
        if (!isValidSignature) {
            console.error(`Invalid signature. Got: ${signature_key}`)
            return new Response(JSON.stringify({ error: 'Invalid signature' }), { status: 401 })
        }

        // 2. Double-verify via Midtrans GET Status API
        const verifiedStatus = await verifyMidtransTransaction(order_id, serverKey)
        const actualTransactionStatus = verifiedStatus.transaction_status
        const actualFraudStatus = verifiedStatus.fraud_status

        if (actualTransactionStatus !== transaction_status) {
            console.warn(
                `[webhook] Status mismatch! Webhook says '${transaction_status}', ` +
                `but GET Status API says '${actualTransactionStatus}'. Using API value.`
            )
        }

        // 3. Fetch the corresponding order WITH RELATIONS
        const adminClient = getSupabaseAdminClient()
        const { data: order, error: orderError } = await adminClient
            .from('orders')
            .select(`
                *,
                profiles (full_name, phone_number),
                addresses (*),
                order_items (
                    *,
                    products (*)
                )
            `)
            .eq('midtrans_order_id', order_id)
            .single()

        if (orderError || !order) {
            console.warn(`Order ${order_id} not found. Ignoring.`)
            return new Response(JSON.stringify({ status: 'ok', message: 'Order not found, ignored' }), { status: 200 })
        }

        const typedOrder = order as unknown as Order

        // 3b. Validate amount - prevent manipulation attack
        const expectedAmount = Math.round(Number(typedOrder.total_amount))
        const webhookAmount = parseInt(gross_amount)
        if (webhookAmount !== expectedAmount) {
            console.error(`Amount mismatch! Webhook says ${webhookAmount}, but order total is ${expectedAmount}`)
            return new Response(JSON.stringify({ error: 'Amount mismatch - possible fraud detected' }), { status: 400 })
        }

        // 4. Idempotency Check - use atomic WHERE clause to prevent race condition
        const { data: idempotencyResult, error: idempotencyError } = await adminClient
            .from('orders')
            .update({ updated_at: new Date().toISOString() })
            .eq('id', typedOrder.id)
            .eq('payment_status', 'unpaid')
            .eq('status', 'pending')
            .select()

        if (idempotencyError || !idempotencyResult || idempotencyResult.length === 0) {
            console.log(`Order ${typedOrder.id} already processed or in invalid state. Ignoring.`)
            return new Response(JSON.stringify({ status: 'ok', message: 'Already processed or invalid state' }), { status: 200 })
        }

        // 5. Map Status
        const { newPaymentStatus, newOrderStatus, shouldReduceStock } = mapMidtransStatus(
            actualTransactionStatus, actualFraudStatus, typedOrder.payment_status, typedOrder.status
        )
        console.log(`Mapped status -> payment_status: '${newPaymentStatus}', order_status: '${newOrderStatus}'`)

        // 6. Update Order status
        const { error: updateError } = await adminClient
            .from('orders')
            .update({
                payment_status: newPaymentStatus,
                status: newOrderStatus,
                midtrans_transaction_id: verifiedStatus.transaction_id || transaction_id,
                payment_type: verifiedStatus.payment_type || payment_type,
            })
            .eq('id', typedOrder.id)

        if (updateError) throw updateError

        // Log to audit trail
        await adminClient.from('order_activities').insert({
            order_id: typedOrder.id,
            action: shouldReduceStock ? 'payment_success' : 'payment_updated',
            old_status: typedOrder.status,
            new_status: newOrderStatus,
            actor_type: 'system',
            metadata: { payment_type: payment_type, transaction_id: transaction_id }
        })

        // 7. Action on Success
        if (shouldReduceStock) {
            // A. Reduce Stock - fail completely if ANY item fails
            if (typedOrder.order_items && typedOrder.order_items.length > 0) {
                const stockReductionErrors: string[] = []
                
                for (const item of typedOrder.order_items) {
                    if (!item.product_id) continue;

                    const { error: rpcError } = await adminClient.rpc('reduce_product_stock', {
                        p_product_id: item.product_id,
                        p_quantity: item.quantity || 0
                    });

                    if (rpcError) {
                        stockReductionErrors.push(`Product ${item.product_id}: ${rpcError.message}`)
                    }
                }

                // If ANY stock reduction failed, rollback the payment
                if (stockReductionErrors.length > 0) {
                    console.error('Stock reduction failed, rolling back payment:', stockReductionErrors)
                    
                    await adminClient
                        .from('orders')
                        .update({ 
                            payment_status: 'unpaid', 
                            status: 'pending',
                            error_message: `Stock reduction failed: ${stockReductionErrors.join('; ')}`
                        })
                        .eq('id', typedOrder.id)
                    
                    return new Response(JSON.stringify({ 
                        error: 'Payment processing failed: stock reduction error',
                        details: stockReductionErrors 
                    }), { status: 500 })
                }
            }

            // B. Create Biteship Order (Shipping)
            if (biteshipKey) {
                try {
                    const biteshipResponse: BiteshipOrderResponse = await createBiteshipOrder(typedOrder, biteshipKey)

                    await adminClient
                        .from('orders')
                        .update({
                            biteship_order_id: biteshipResponse.id,
                            waybill_number: biteshipResponse.courier?.waybill_id || null,
                            waybill_source: 'system',
                            status: 'processing',
                        })
                        .eq('id', typedOrder.id)

                    // Log shipping creation
                    await adminClient.from('order_activities').insert({
                        order_id: typedOrder.id,
                        action: 'shipping_created',
                        old_status: 'awaiting_shipment',
                        new_status: 'processing',
                        actor_type: 'system',
                        metadata: { biteship_order_id: biteshipResponse.id, waybill: biteshipResponse.courier?.waybill_id }
                    })

                    console.log('Biteship order created successfully:', biteshipResponse.id)
                } catch (bsErr: unknown) {
                    const bsMsg = bsErr instanceof Error ? bsErr.message : 'Unknown Biteship error'
                    console.error('Biteship automation failed:', bsMsg)
                }
            }
        }

        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 })

    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        console.error('Webhook error:', message)
        return new Response(JSON.stringify({ error: message }), { status: 500 })
    }
})
