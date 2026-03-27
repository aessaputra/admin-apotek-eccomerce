import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { getSupabaseAdminClient } from '../_shared/supabase.ts';

type TransitionPayload = {
  to: string;
  waybill_number?: string;
  waybill_source?: 'system' | 'manual';
  waybill_override_reason?: string;
  notes?: string;
};

type OrderManagerRequest = {
  action: 'transition_status' | 'sync_tracking';
  orderId: string;
  payload?: TransitionPayload;
};

const BITESHIP_BASE_URL = 'https://api.biteship.com/v1';

const TRANSITION_RULES: Record<string, string[]> = {
  pending: ['processing', 'cancelled'],
  paid: ['awaiting_shipment', 'processing', 'cancelled'],
  awaiting_shipment: ['processing', 'shipped', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered'],
};

function canTransition(from: string, to: string): boolean {
  return (TRANSITION_RULES[from] || []).includes(to);
}

function mapBiteshipStatus(status: string, fallback: string): string {
  const statusMap: Record<string, string> = {
    allocated: 'processing',
    picked_up: 'shipped',
    in_transit: 'shipped',
    delivered: 'delivered',
  };
  return statusMap[status] || fallback;
}

async function requireAdmin(req: Request): Promise<{ userId: string }> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    throw new Error('Missing Authorization header');
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

  // Use global.headers pattern for auth - pass Authorization header to client
  const verifier = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: { Authorization: authHeader },
    },
  });

  // getUser() without token arg uses the Authorization header from global config
  const {
    data: { user },
    error: authError,
  } = await verifier.auth.getUser();

  if (authError || !user) {
    throw new Error('Unauthorized: Invalid JWT');
  }

  const adminClient = getSupabaseAdminClient();
  const { data: profile, error: profileError } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profileError || !profile || profile.role !== 'admin') {
    throw new Error('Forbidden: Admin role required');
  }

  return { userId: user.id };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const { userId } = await requireAdmin(req);
    const body: OrderManagerRequest = await req.json();

    if (!body.action || !body.orderId) {
      return new Response(JSON.stringify({ error: 'action and orderId are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const adminClient = getSupabaseAdminClient();
    const { data: order, error: orderError } = await adminClient
      .from('orders')
      .select('id, status, waybill_number, biteship_order_id')
      .eq('id', body.orderId)
      .single();

    if (orderError || !order) {
      return new Response(JSON.stringify({ error: 'Order not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (body.action === 'transition_status') {
      const to = body.payload?.to;
      if (!to) {
        return new Response(JSON.stringify({ error: 'payload.to is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (!canTransition(order.status, to)) {
        return new Response(
          JSON.stringify({
            error: 'INVALID_TRANSITION',
            message: `Cannot transition order from '${order.status}' to '${to}'`,
          }),
          {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        );
      }

      const nextWaybill = body.payload?.waybill_number?.trim() || order.waybill_number || null;
      if (to === 'shipped' && !nextWaybill) {
        return new Response(
          JSON.stringify({ error: 'waybill_number is required for shipped status' }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        );
      }

      // Build update payload with optional waybill override metadata
      const updatePayload: Record<string, unknown> = {
        status: to,
        waybill_number: nextWaybill,
        updated_at: new Date().toISOString(),
      };

      // If admin is providing a manual waybill (override), record audit metadata
      if (body.payload?.waybill_source === 'manual' && body.payload?.waybill_number?.trim()) {
        updatePayload.waybill_source = 'manual';
        updatePayload.waybill_overridden_by = userId;
        updatePayload.waybill_override_reason = body.payload.waybill_override_reason || null;
        updatePayload.waybill_overridden_at = new Date().toISOString();
      } else if (body.payload?.waybill_number?.trim() && !order.biteship_order_id) {
        // No Biteship — still manual but not an override
        updatePayload.waybill_source = 'manual';
      }

      const { data: updated, error: updateError } = await adminClient
        .from('orders')
        .update(updatePayload)
        .eq('id', body.orderId)
        .select('id, status, waybill_number, waybill_source, updated_at')
        .single();

      if (updateError) {
        throw updateError;
      }

      await adminClient.from('order_activities').insert({
        order_id: body.orderId,
        action: 'status_update',
        old_status: order.status,
        new_status: to,
        actor_id: userId,
        actor_type: 'admin',
        metadata: {
          notes: body.payload?.notes ?? null,
          waybill: nextWaybill,
          waybill_source: body.payload?.waybill_source ?? null,
          override_reason: body.payload?.waybill_override_reason ?? null,
        },
      });

      return new Response(JSON.stringify({ success: true, data: updated }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (body.action === 'sync_tracking') {
      if (!order.biteship_order_id) {
        return new Response(JSON.stringify({ error: 'Order has no biteship_order_id' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const biteshipKey = Deno.env.get('BITESHIP_API_KEY');
      if (!biteshipKey) {
        throw new Error('Missing BITESHIP_API_KEY');
      }

      const trackingResp = await fetch(
        `${BITESHIP_BASE_URL}/trackings/${order.biteship_order_id}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${biteshipKey}`,
          },
        },
      );

      if (!trackingResp.ok) {
        const errorBody = await trackingResp.text();
        return new Response(
          JSON.stringify({ error: 'Biteship tracking failed', details: errorBody }),
          {
            status: trackingResp.status,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        );
      }

      const trackingData = (await trackingResp.json()) as Record<string, unknown>;
      const trackingStatus = String(trackingData.status || '');
      const waybill = String(trackingData.waybill || trackingData.waybill_id || '') || null;
      const nextStatus = mapBiteshipStatus(trackingStatus, order.status);

      const { data: updated, error: updateError } = await adminClient
        .from('orders')
        .update({
          status: nextStatus,
          waybill_number: waybill || order.waybill_number || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', body.orderId)
        .select('id, status, waybill_number, updated_at')
        .single();

      if (updateError) {
        throw updateError;
      }

      await adminClient.from('order_activities').insert({
        order_id: body.orderId,
        action: 'sync_tracking',
        old_status: order.status,
        new_status: nextStatus,
        actor_id: userId,
        actor_type: 'admin',
        metadata: {
          biteship_order_id: order.biteship_order_id,
          biteship_status: trackingStatus,
          waybill,
        },
      });

      return new Response(JSON.stringify({ success: true, data: updated }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    // Determine status and client-facing error message
    // Log full error internally but only return generic message for 500s
    const isForbidden = message.startsWith('Forbidden');
    const isUnauthorized = message.startsWith('Unauthorized');
    const status = isForbidden ? 403 : isUnauthorized ? 401 : 500;

    // Log full error for debugging (includes stack trace details)
    console.error('[order-manager] Internal error:', { message, error: String(error) });

    // Return safe error message to client - don't leak internal details for 500 errors
    const clientError = isForbidden
      ? 'Forbidden: Admin role required'
      : isUnauthorized
        ? 'Unauthorized: Invalid authentication'
        : 'Internal server error';

    return new Response(JSON.stringify({ error: clientError }), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
