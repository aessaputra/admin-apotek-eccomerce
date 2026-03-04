import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'
import { corsHeaders } from '../_shared/cors.ts'
import { getSupabaseAdminClient } from '../_shared/supabase.ts'
import { buildSnapPayload } from '../_shared/midtrans.ts'
import type { Order, AuthUser } from '../_shared/types.ts'

Deno.serve(async (req) => {
    // 1. Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    // Reject non-POST methods
    if (req.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
            status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
    }

    try {
        // 2. Validate JWT
        const authHeader = req.headers.get('Authorization')
        if (!authHeader) throw new Error('Missing Authorization header')

        const token = authHeader.replace('Bearer ', '')
        const supabaseUrl = Deno.env.get('SUPABASE_URL')
        const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')
        if (!supabaseUrl || !supabaseAnonKey) throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY')

        const supabaseMem = createClient(supabaseUrl, supabaseAnonKey)
        const { data: { user }, error: authError } = await supabaseMem.auth.getUser(token)

        if (authError || !user) {
            return new Response(JSON.stringify({ error: 'Unauthorized: Invalid JWT' }), {
                status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            })
        }

        const typedUser: AuthUser = { id: user.id, email: user.email }

        // 3. Parse Request
        const { order_id } = await req.json()
        if (!order_id) throw new Error('order_id is required')

        // 4. Fetch Order & Validate
        const adminClient = getSupabaseAdminClient()
        const { data: order, error: orderError } = await adminClient
            .from('orders')
            .select('*, order_items(*, products(name, categories(name))), profiles(full_name, phone_number, id)')
            .eq('id', order_id)
            .single()

        if (orderError || !order) return new Response(JSON.stringify({ error: 'Order not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        if (order.user_id !== user.id) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        if (order.status !== 'pending' || order.payment_status !== 'unpaid') {
            return new Response(JSON.stringify({ error: 'Order state invalid for payment' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }

        const typedOrder = order as unknown as Order

        // 5. Prepare Order ID
        if (!typedOrder.midtrans_order_id) {
            const shortId = typedOrder.id.split('-')[0]
            const ts = new Date().getTime().toString().slice(-6)
            typedOrder.midtrans_order_id = `APT-${shortId}-${ts}`

            await adminClient.from('orders').update({ midtrans_order_id: typedOrder.midtrans_order_id }).eq('id', order_id)
        }

        // 6. Build Payload (Extracted)
        const payload = buildSnapPayload(typedOrder, typedUser)

        // 7. Request Snap Token
        const isProduction = Deno.env.get('MIDTRANS_IS_PRODUCTION') === 'true'
        const serverKey = Deno.env.get('MIDTRANS_SERVER_KEY')
        if (!serverKey) throw new Error('Midtrans server key not configured')

        const midtransApiUrl = isProduction
            ? 'https://app.midtrans.com/snap/v1/transactions'
            : 'https://app.sandbox.midtrans.com/snap/v1/transactions'

        console.log('Sending to Midtrans:', JSON.stringify(payload, null, 2))

        const midtransResponse = await fetch(midtransApiUrl, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Authorization': `Basic ${btoa(`${serverKey}:`)}`
            },
            body: JSON.stringify(payload)
        })

        const midtransData = await midtransResponse.json()
        if (!midtransResponse.ok) {
            console.error('Midtrans Error:', midtransData)
            throw new Error(midtransData.error_messages?.[0] || 'Midtrans error')
        }

        return new Response(JSON.stringify({
            snap_token: midtransData.token,
            redirect_url: midtransData.redirect_url
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        console.error('Error:', message)
        return new Response(JSON.stringify({ error: message }), {
            status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
    }
})
