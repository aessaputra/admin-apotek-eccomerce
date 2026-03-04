import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { getSupabaseAdminClient } from '../_shared/supabase.ts'

interface BiteshipProxyRequest {
  action: 'rates' | 'orders' | 'track' | 'maps'
  payload?: Record<string, unknown>
}

const BITESHIP_API_KEY = Deno.env.get('BITESHIP_API_KEY')
if (!BITESHIP_API_KEY) throw new Error('Missing BITESHIP_API_KEY environment variable')
const BITESHIP_BASE_URL = 'https://api.biteship.com/v1'

// Validate tracking_id to prevent URL manipulation
function isValidTrackingId(id: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(id)
}

Deno.serve(async (req: Request) => {
  // 1. Handle CORS Preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 2. Validate JWT - Fixed: Actually verify the token
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const token = authHeader.replace('Bearer ', '')
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')
    
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY')
    }

    // Create a client to verify JWT
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.39.3')
    const supabaseMem = createClient(supabaseUrl, supabaseAnonKey)
    const { data: { user }, error: authError } = await supabaseMem.auth.getUser(token)

    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Invalid JWT' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 3. Get user_id for ownership verification
    const userId = user.id

    // 4. Parse request
    const { action, payload }: BiteshipProxyRequest = await req.json()

    if (!action) {
      return new Response(
        JSON.stringify({ error: 'Action is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 5. Validate payload for actions that require order_id
    if (action === 'orders' && payload?.order_id) {
      // Verify order ownership
      const adminClient = getSupabaseAdminClient()
      const { data: order, error: orderError } = await adminClient
        .from('orders')
        .select('user_id')
        .eq('id', payload.order_id)
        .single()

      if (orderError || !order) {
        return new Response(JSON.stringify({ error: 'Order not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      // Only allow users to access their own orders
      if (order.user_id !== userId) {
        return new Response(JSON.stringify({ error: 'Forbidden: You can only access your own orders' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    // 6. Validate tracking_id format to prevent URL manipulation
    if (action === 'track' && payload?.tracking_id) {
      const trackingId = String(payload.tracking_id)
      if (!isValidTrackingId(trackingId)) {
        return new Response(JSON.stringify({ error: 'Invalid tracking_id format' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    // 7. Build Biteship request
    let endpoint = ''
    let method = 'POST'

    switch (action) {
      case 'rates':
        endpoint = '/rates/couriers'
        break
      case 'orders':
        endpoint = '/orders'
        break
      case 'track':
        endpoint = `/trackings/${payload?.tracking_id}`
        method = 'GET'
        break
      case 'maps':
        endpoint = `/maps/areas?input=${encodeURIComponent(String(payload?.input || ''))}`
        method = 'GET'
        break
      default:
        return new Response(
          JSON.stringify({ error: 'Invalid action specified' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }

    const biteshipUrl = `${BITESHIP_BASE_URL}${endpoint}`

    const fetchOptions: RequestInit = {
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BITESHIP_API_KEY}`
      }
    }

    if (method !== 'GET' && payload) {
      fetchOptions.body = JSON.stringify(payload)
    }

    console.log(`[biteship] Calling: ${method} ${biteshipUrl}`)

    // 8. Add timeout to prevent hanging
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    fetchOptions.signal = controller.signal

    const biteshipResponse = await fetch(biteshipUrl, fetchOptions)
    clearTimeout(timeout)
    
    const data: Record<string, unknown> = await biteshipResponse.json()

    if (!biteshipResponse.ok) {
      console.error(`[biteship] Error from Biteship:`, data)
      return new Response(JSON.stringify({ error: data }), {
        status: biteshipResponse.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Success response
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('[biteship] Internal Error:', message)
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
