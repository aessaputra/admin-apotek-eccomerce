import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createRemoteJWKSet, jwtVerify } from 'npm:jose@5';
import { corsHeaders } from '../_shared/cors.ts';
import { buildSnapPayload } from '../_shared/midtrans.ts';
import { getSupabaseAdminClient } from '../_shared/supabase.ts';
import type { AuthUser, Order, SnapResponse } from '../_shared/types.ts';

const JSON_HEADERS = { ...corsHeaders, 'Content-Type': 'application/json' };

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;

const JWKS = createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`));
const JWT_ISSUER = `${supabaseUrl}/auth/v1`;

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

function ensureMidtransOrderId(order: Order): string {
  if (order.midtrans_order_id) {
    return order.midtrans_order_id;
  }

  const shortId = order.id.replace(/-/g, '').slice(0, 8).toUpperCase();
  const timestamp = Date.now();
  return `APT-${shortId}-${timestamp}`;
}

type MidtransSnapError = {
  error_messages?: string[];
  status_message?: string;
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method Not Allowed' }, 405);
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Missing or invalid Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      return new Response(JSON.stringify({ error: 'Missing or invalid Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let userId: string;
    let userEmail: string;
    try {
      const { payload } = await jwtVerify(token, JWKS, {
        issuer: JWT_ISSUER,
        audience: 'authenticated',
      });
      userId = payload.sub ?? '';
      userEmail = ((payload as Record<string, unknown>).email as string) ?? '';
      if (!userId) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    } catch {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = (await req.json()) as { order_id?: string };
    const orderId = body.order_id?.trim();
    if (!orderId) {
      throw new HttpError(400, 'order_id is required');
    }

    const adminClient = getSupabaseAdminClient();
    const { data: rawOrder, error: orderError } = await adminClient
      .from('orders')
      .select(
        '*, order_items(*, products(name, categories(name))), profiles(id, full_name, phone_number)',
      )
      .eq('id', orderId)
      .single();

    if (orderError || !rawOrder) {
      throw new HttpError(404, 'Order not found');
    }

    const order = rawOrder as unknown as Order;
    if (order.user_id !== userId) {
      throw new HttpError(403, 'Forbidden');
    }

    if (order.status !== 'pending' || order.payment_status !== 'pending') {
      throw new HttpError(400, 'Order state invalid for payment');
    }

    const SNAP_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

    const isTokenExpired = (createdAt: string | null | undefined): boolean => {
      if (!createdAt) return true;
      return Date.now() - new Date(createdAt).getTime() > SNAP_TOKEN_TTL_MS;
    };

    if (
      order.snap_token &&
      order.snap_redirect_url &&
      !isTokenExpired(order.snap_token_created_at)
    ) {
      return jsonResponse({
        snap_token: order.snap_token,
        redirect_url: order.snap_redirect_url,
      });
    }

    if (order.checkout_idempotency_key) {
      const { data: idempotentOrder } = await adminClient
        .from('orders')
        .select('id, user_id, snap_token, snap_redirect_url, snap_token_created_at')
        .eq('checkout_idempotency_key', order.checkout_idempotency_key)
        .eq('user_id', userId)
        .not('snap_token', 'is', null)
        .not('snap_redirect_url', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (
        idempotentOrder?.snap_token &&
        idempotentOrder?.snap_redirect_url &&
        !isTokenExpired(idempotentOrder.snap_token_created_at)
      ) {
        if (idempotentOrder.id !== order.id) {
          await adminClient
            .from('orders')
            .update({
              snap_token: idempotentOrder.snap_token,
              snap_redirect_url: idempotentOrder.snap_redirect_url,
              snap_token_created_at: idempotentOrder.snap_token_created_at,
            })
            .eq('id', order.id);
        }

        return jsonResponse({
          snap_token: idempotentOrder.snap_token,
          redirect_url: idempotentOrder.snap_redirect_url,
        });
      }
    }

    const midtransOrderId = ensureMidtransOrderId(order);
    if (!order.midtrans_order_id) {
      const { error: updateOrderIdError } = await adminClient
        .from('orders')
        .update({ midtrans_order_id: midtransOrderId })
        .eq('id', order.id);

      if (updateOrderIdError) {
        throw new HttpError(500, 'Failed to persist midtrans_order_id');
      }
    }

    const payload = buildSnapPayload(
      {
        ...order,
        midtrans_order_id: midtransOrderId,
      },
      {
        id: userId,
        email: userEmail,
      } as AuthUser,
    );

    const serverKey = Deno.env.get('MIDTRANS_SERVER_KEY');
    if (!serverKey) {
      throw new HttpError(500, 'Midtrans server key not configured');
    }

    const isProduction = Deno.env.get('MIDTRANS_IS_PRODUCTION') === 'true';
    const midtransApiUrl = isProduction
      ? 'https://app.midtrans.com/snap/v1/transactions'
      : 'https://app.sandbox.midtrans.com/snap/v1/transactions';

    const midtransResponse = await fetch(midtransApiUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Basic ${btoa(`${serverKey}:`)}`,
      },
      body: JSON.stringify(payload),
    });

    const midtransData = (await midtransResponse.json()) as Partial<SnapResponse> &
      MidtransSnapError;
    if (!midtransResponse.ok || !midtransData.token || !midtransData.redirect_url) {
      throw new HttpError(
        502,
        midtransData.error_messages?.[0] ||
          midtransData.status_message ||
          'Midtrans token creation failed',
      );
    }

    const nowIso = new Date().toISOString();
    const { error: persistSnapError } = await adminClient
      .from('orders')
      .update({
        midtrans_order_id: midtransOrderId,
        snap_token: midtransData.token,
        snap_redirect_url: midtransData.redirect_url,
        snap_token_created_at: nowIso,
        gross_amount: payload.transaction_details.gross_amount,
      })
      .eq('id', order.id);

    if (persistSnapError) {
      throw new HttpError(500, 'Failed to store snap token in order');
    }

    return jsonResponse({
      snap_token: midtransData.token,
      redirect_url: midtransData.redirect_url,
    });
  } catch (error: unknown) {
    if (error instanceof HttpError) {
      return jsonResponse({ error: error.message }, error.status);
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[create-snap-token] Internal error:', message);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
});
