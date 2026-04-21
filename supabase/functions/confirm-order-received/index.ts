import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createRemoteJWKSet, jwtVerify } from 'npm:jose@5';
import { corsHeaders } from '../_shared/cors.ts';
import { getSupabaseAdminClient } from '../_shared/supabase.ts';

type OrderRow = {
  id: string;
  user_id: string | null;
  status: string;
  delivered_at: string | null;
  complaint_window_expires_at: string | null;
  customer_completed_at: string | null;
};

type OrderActivitiesInsert = {
  order_id: string;
  action: string;
  old_status: string | null;
  new_status: string | null;
  actor_id: string | null;
  actor_type: string;
  metadata: Record<string, unknown>;
};

type OrdersTableQuery = {
  select: (columns: string) => {
    eq: (column: string, value: string) => {
      maybeSingle: () => Promise<{ data: OrderRow | null; error: { message: string } | null }>;
    };
  };
  update: (values: Record<string, unknown>) => {
    eq: (column: string, value: string) => {
      is: (column: string, value: null) => {
        select: (columns: string) => {
          maybeSingle: () => Promise<{ data: OrderRow | null; error: { message: string } | null }>;
        };
      };
    };
  };
};

type OrderActivitiesTableQuery = {
  insert: (values: OrderActivitiesInsert) => Promise<{ error: { message: string } | null }>;
};

type ConfirmOrderReceivedAdminClient = {
  from(table: 'orders'): OrdersTableQuery;
  from(table: 'order_activities'): OrderActivitiesTableQuery;
};

declare const Deno: {
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
  env: {
    get: (key: string) => string | undefined;
  };
};

const JSON_HEADERS = { ...corsHeaders, 'Content-Type': 'application/json' };
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const JWKS = createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`));
const JWT_ISSUER = `${supabaseUrl}/auth/v1`;

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

async function getAuthenticatedUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return null;
  }

  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: JWT_ISSUER,
      audience: 'authenticated',
    });

    return payload.sub ?? null;
  } catch {
    return null;
  }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method Not Allowed' }, 405);
  }

  const userId = await getAuthenticatedUserId(req);
  if (!userId) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const orderId = typeof body?.order_id === 'string' ? body.order_id.trim() : '';

    if (!orderId) {
      return jsonResponse({ error: 'order_id is required' }, 400);
    }

    const adminClient = getSupabaseAdminClient() as ConfirmOrderReceivedAdminClient;
    const { data: order, error: orderError } = await adminClient
      .from('orders')
      .select(
        'id, user_id, status, delivered_at, complaint_window_expires_at, customer_completed_at',
      )
      .eq('id', orderId)
      .maybeSingle();

    if (orderError) {
      throw new Error(`Failed to fetch order: ${orderError.message}`);
    }

    if (!order) {
      return jsonResponse({ error: 'Order not found' }, 404);
    }

    if (order.user_id !== userId) {
      return jsonResponse({ error: 'Order not found' }, 404);
    }

    if (order.status !== 'delivered') {
      return jsonResponse({ error: 'Only delivered orders can be confirmed' }, 409);
    }

    if (order.customer_completed_at) {
      return jsonResponse({
        success: true,
        data: {
          order_id: order.id,
          status: order.status,
          customer_completion_stage: 'completed',
          customer_completed_at: order.customer_completed_at,
        },
      });
    }

    const completedAt = new Date().toISOString();
    const { data: updatedOrder, error: updateError } = await adminClient
      .from('orders')
      .update({
        customer_completed_at: completedAt,
        customer_completed_by: userId,
        customer_completion_source: 'customer',
        updated_at: completedAt,
      })
      .eq('id', orderId)
      .is('customer_completed_at', null)
      .select('id, status, customer_completed_at')
      .maybeSingle();

    if (updateError) {
      throw new Error(`Failed to update order: ${updateError.message}`);
    }

    if (!updatedOrder) {
      const { data: existingOrder, error: existingOrderError } = await adminClient
        .from('orders')
        .select('id, status, customer_completed_at')
        .eq('id', orderId)
        .maybeSingle();

      if (existingOrderError) {
        throw new Error(`Failed to re-read order: ${existingOrderError.message}`);
      }

      return jsonResponse({
        success: true,
        data: {
          order_id: orderId,
          status: existingOrder?.status ?? order.status,
          customer_completion_stage: 'completed',
          customer_completed_at: existingOrder?.customer_completed_at ?? completedAt,
        },
      });
    }

    const effectiveCompletedAt = updatedOrder.customer_completed_at ?? completedAt;

    const { error: activityError } = await adminClient.from('order_activities').insert({
      order_id: orderId,
      action: 'customer_completed',
      old_status: order.status,
      new_status: order.status,
      actor_id: userId,
      actor_type: 'customer',
      metadata: {
        delivered_at: order.delivered_at ?? null,
        complaint_window_expires_at: order.complaint_window_expires_at ?? null,
        customer_completed_at: effectiveCompletedAt,
      },
    });

    if (activityError) {
      console.error('[confirm-order-received] Failed to log activity:', activityError);
    }

    return jsonResponse({
      success: true,
      data: {
        order_id: orderId,
        status: order.status,
        customer_completion_stage: 'completed',
        customer_completed_at: effectiveCompletedAt,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[confirm-order-received] Internal error:', message);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
});
