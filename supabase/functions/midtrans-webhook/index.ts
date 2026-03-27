import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createBiteshipOrder } from '../_shared/biteship.ts';
import {
  mapMidtransStatus,
  verifyMidtransSignature,
  verifyMidtransTransaction,
} from '../_shared/midtrans.ts';
import { getSupabaseAdminClient } from '../_shared/supabase.ts';
import type {
  BiteshipOrderResponse,
  MidtransStatusResponse,
  MidtransWebhookPayload,
  Order,
  PaymentStatus,
} from '../_shared/types.ts';

declare const Deno: {
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
  env: {
    get: (key: string) => string | undefined;
  };
};

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const SIDE_EFFECT_LEASE_MS = 10 * 60 * 1000;
const BITESHIP_CALL_TIMEOUT_MS = 45_000;

const PAYMENT_TYPE_ALLOWLIST = new Set([
  'credit_card',
  'bank_transfer',
  'echannel',
  'gopay',
  'shopeepay',
  'qris',
  'akulaku',
  'kredivo',
  'indomaret',
  'alfamart',
  'bca_klikbca',
  'bca_klikpay',
  'bri_epay',
  'cimb_clicks',
  'danamon_online',
  'uob_ezpay',
  'other',
]);

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

function toNumericAmount(value: string | number | null | undefined): number {
  if (value == null) return 0;
  return Number.parseFloat(String(value));
}

function normalizePaymentType(value: string | null | undefined): string | null {
  if (!value) return null;
  return PAYMENT_TYPE_ALLOWLIST.has(value) ? value : 'other';
}

function buildWebhookEventKey(payload: MidtransWebhookPayload): string {
  // Include fraud_status to differentiate capture+challenge from capture+accept
  const fraudStatus = payload.fraud_status || '';
  return [
    payload.transaction_id || payload.order_id,
    payload.transaction_status,
    payload.status_code,
    payload.gross_amount,
    fraudStatus,
  ].join(':');
}

function getPaidAt(nextPaymentStatus: PaymentStatus): string | null {
  return nextPaymentStatus === 'settlement' ? new Date().toISOString() : null;
}

function pickNotificationDate(value?: string): string | null {
  if (!value) return null;
  return value;
}

async function persistRawNotificationEarly(
  adminClient: ReturnType<typeof getSupabaseAdminClient>,
  payload: MidtransWebhookPayload,
): Promise<void> {
  const rawRecord = {
    midtrans_order_id: payload.order_id,
    midtrans_transaction_id: payload.transaction_id || null,
    transaction_status: payload.transaction_status || null,
    fraud_status: payload.fraud_status || null,
    status_code: payload.status_code || null,
    gross_amount: toNumericAmount(payload.gross_amount),
    currency: payload.currency || 'IDR',
    raw_notification: payload,
  };

  const { error } = await adminClient
    .from('payments')
    .upsert(rawRecord, { onConflict: 'midtrans_order_id' });

  if (error) {
    console.error('[midtrans-webhook] Failed to persist raw notification:', error.message);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error(timeoutMessage));
      }, timeoutMs);
    });

    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
  }
}

async function verifyMidtransTransactionWithRetry(
  orderId: string,
  serverKey: string,
  attempts = 3,
): Promise<MidtransStatusResponse> {
  let lastError: unknown;

  for (let index = 0; index < attempts; index += 1) {
    try {
      return await verifyMidtransTransaction(orderId, serverKey);
    } catch (error) {
      lastError = error;
      if (index < attempts - 1) {
        await sleep(300 * (index + 1));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Midtrans verification failed');
}

async function getOrderWithRetry(
  adminClient: ReturnType<typeof getSupabaseAdminClient>,
  midtransOrderId: string,
  attempts = 3,
): Promise<{ data: unknown; error: unknown }> {
  let latestResult: { data: unknown; error: unknown } = { data: null, error: null };

  for (let index = 0; index < attempts; index += 1) {
    const { data, error } = await adminClient
      .from('orders')
      .select(
        `
        *,
        profiles (full_name, phone_number),
        addresses (*),
        order_items (
          *,
          products (*)
        )
      `,
      )
      .eq('midtrans_order_id', midtransOrderId)
      .single();

    latestResult = { data, error };
    if (data && !error) {
      return latestResult;
    }

    if (index < attempts - 1) {
      await sleep(300 * (index + 1));
    }
  }

  return latestResult;
}

async function upsertPaymentRecord(
  order: Order,
  payload: MidtransWebhookPayload,
  verifiedStatus: MidtransStatusResponse,
  status: PaymentStatus,
): Promise<void> {
  const adminClient = getSupabaseAdminClient();

  const effectivePaymentType = normalizePaymentType(
    verifiedStatus.payment_type || payload.payment_type || order.payment_type,
  );

  const { data: existingPayment } = await adminClient
    .from('payments')
    .select('paid_at')
    .eq('midtrans_order_id', payload.order_id)
    .maybeSingle();

  const paymentPayload = {
    order_id: order.id,
    user_id: order.user_id ?? null,
    checkout_idempotency_key: order.checkout_idempotency_key ?? null,
    midtrans_order_id: payload.order_id,
    midtrans_transaction_id: verifiedStatus.transaction_id || payload.transaction_id || null,
    status,
    payment_type: effectivePaymentType,
    transaction_status: verifiedStatus.transaction_status || payload.transaction_status || null,
    fraud_status: verifiedStatus.fraud_status || payload.fraud_status || null,
    status_code: verifiedStatus.status_code || payload.status_code || null,
    status_message: verifiedStatus.status_message || payload.status_message || null,
    currency: verifiedStatus.currency || payload.currency || 'IDR',
    gross_amount: toNumericAmount(verifiedStatus.gross_amount || payload.gross_amount),
    signature_key: payload.signature_key,
    merchant_id: verifiedStatus.merchant_id || payload.merchant_id || null,
    transaction_time: pickNotificationDate(
      verifiedStatus.transaction_time || payload.transaction_time,
    ),
    settlement_time: pickNotificationDate(
      verifiedStatus.settlement_time || payload.settlement_time,
    ),
    expiry_time: pickNotificationDate(verifiedStatus.expiry_time || payload.expiry_time),
    paid_at: existingPayment?.paid_at || getPaidAt(status),
    payment_code: verifiedStatus.payment_code || payload.payment_code || null,
    store: verifiedStatus.store || payload.store || null,
    va_numbers: verifiedStatus.va_numbers || payload.va_numbers || [],
    biller_code: verifiedStatus.biller_code || payload.biller_code || null,
    bill_key: verifiedStatus.bill_key || payload.bill_key || null,
    bank: verifiedStatus.bank || payload.bank || null,
    acquirer: verifiedStatus.acquirer || payload.acquirer || null,
    issuer: verifiedStatus.issuer || payload.issuer || null,
    card_type: verifiedStatus.card_type || payload.card_type || null,
    masked_card: verifiedStatus.masked_card || payload.masked_card || null,
    approval_code: verifiedStatus.approval_code || payload.approval_code || null,
    eci: verifiedStatus.eci || payload.eci || null,
    channel_response_code:
      verifiedStatus.channel_response_code || payload.channel_response_code || null,
    channel_response_message:
      verifiedStatus.channel_response_message || payload.channel_response_message || null,
    redirect_url: verifiedStatus.redirect_url || payload.redirect_url || null,
    raw_notification: payload,
  };

  const { error } = await adminClient
    .from('payments')
    .upsert(paymentPayload, { onConflict: 'midtrans_order_id' });

  if (error) {
    throw new Error(`Failed to upsert payment record: ${error.message}`);
  }
}

interface SideEffectTask {
  needs_stock: boolean;
  needs_biteship: boolean;
  retry_count: number;
  updated_at: string;
  lease_until: string | null;
  pending_biteship_order_id: string | null;
  pending_waybill_number: string | null;
}

async function getSideEffectTask(
  adminClient: ReturnType<typeof getSupabaseAdminClient>,
  orderId: string,
): Promise<SideEffectTask | null> {
  const { data, error } = await adminClient
    .from('webhook_side_effect_tasks')
    .select(
      'needs_stock, needs_biteship, retry_count, updated_at, lease_until, pending_biteship_order_id, pending_waybill_number',
    )
    .eq('order_id', orderId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data as SideEffectTask;
}

async function saveSideEffectTask(
  adminClient: ReturnType<typeof getSupabaseAdminClient>,
  orderId: string,
  needsStock: boolean,
  needsBiteship: boolean,
  lastError: string | null,
  pendingBiteshipOrderId: string | null = null,
  pendingWaybillNumber: string | null = null,
): Promise<void> {
  if (!needsStock && !needsBiteship) {
    const { error } = await adminClient
      .from('webhook_side_effect_tasks')
      .delete()
      .eq('order_id', orderId);
    if (error) {
      throw new Error(`Failed to delete side effect task: ${error.message}`);
    }
    return;
  }

  const existingTask = await getSideEffectTask(adminClient, orderId);
  const nextRetryCount = existingTask?.retry_count ?? 0;

  const { error } = await adminClient.from('webhook_side_effect_tasks').upsert(
    {
      order_id: orderId,
      needs_stock: needsStock,
      needs_biteship: needsBiteship,
      last_error: lastError,
      updated_at: new Date().toISOString(),
      retry_count: nextRetryCount,
      claimed_at: null,
      lease_until: null,
      pending_biteship_order_id: pendingBiteshipOrderId,
      pending_waybill_number: pendingWaybillNumber,
    },
    { onConflict: 'order_id' },
  );

  if (error) {
    throw new Error(`Failed to upsert side effect task: ${error.message}`);
  }
}

async function claimSideEffectTask(
  adminClient: ReturnType<typeof getSupabaseAdminClient>,
  orderId: string,
  currentTask: SideEffectTask,
): Promise<boolean> {
  if (currentTask.lease_until && Date.parse(currentTask.lease_until) > Date.now()) {
    return false;
  }

  const nowIso = new Date().toISOString();
  const leaseUntilIso = new Date(Date.now() + SIDE_EFFECT_LEASE_MS).toISOString();

  const { data, error } = await adminClient
    .from('webhook_side_effect_tasks')
    .update({
      retry_count: currentTask.retry_count + 1,
      updated_at: nowIso,
      claimed_at: nowIso,
      lease_until: leaseUntilIso,
    })
    .eq('order_id', orderId)
    .eq('updated_at', currentTask.updated_at)
    .select('order_id')
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to claim side effect task: ${error.message}`);
  }

  return !!data;
}

async function renewSideEffectTaskLease(
  adminClient: ReturnType<typeof getSupabaseAdminClient>,
  orderId: string,
): Promise<void> {
  const nowIso = new Date().toISOString();
  const leaseUntilIso = new Date(Date.now() + SIDE_EFFECT_LEASE_MS).toISOString();

  const { error } = await adminClient
    .from('webhook_side_effect_tasks')
    .update({
      claimed_at: nowIso,
      lease_until: leaseUntilIso,
      updated_at: nowIso,
    })
    .eq('order_id', orderId);

  if (error) {
    throw new Error(`Failed to renew side effect lease: ${error.message}`);
  }
}

async function persistPendingBiteshipResult(
  adminClient: ReturnType<typeof getSupabaseAdminClient>,
  orderId: string,
  biteshipOrderId: string,
  waybillNumber: string | null,
): Promise<void> {
  const nowIso = new Date().toISOString();
  const leaseUntilIso = new Date(Date.now() + SIDE_EFFECT_LEASE_MS).toISOString();

  const { error } = await adminClient
    .from('webhook_side_effect_tasks')
    .update({
      pending_biteship_order_id: biteshipOrderId,
      pending_waybill_number: waybillNumber,
      updated_at: nowIso,
      lease_until: leaseUntilIso,
    })
    .eq('order_id', orderId);

  if (error) {
    throw new Error(`Failed to persist pending Biteship result: ${error.message}`);
  }
}

Deno.serve(async req => {
  if (req.method !== 'POST') {
    // Return 200 even for method mismatch - Midtrans expects 200 always
    console.error('[midtrans-webhook] Invalid method:', req.method);
    return jsonResponse({ status: 'ok', message: 'Invalid method' }, 200);
  }

  let payload: MidtransWebhookPayload | null = null;
  let adminClient: ReturnType<typeof getSupabaseAdminClient> | null = null;

  try {
    const bodyText = await req.text();

    try {
      payload = JSON.parse(bodyText) as MidtransWebhookPayload;
    } catch (parseError) {
      // Return 200 even for invalid JSON - Midtrans expects 200 always
      console.error('[midtrans-webhook] Invalid JSON:', parseError);
      return jsonResponse({ status: 'ok', message: 'Invalid JSON payload' }, 200);
    }

    if (
      !payload.order_id ||
      !payload.status_code ||
      !payload.gross_amount ||
      !payload.signature_key
    ) {
      // Return 200 even for invalid payload - Midtrans expects 200 always
      console.error('[midtrans-webhook] Invalid payload: missing required fields');
      return jsonResponse({ status: 'ok', message: 'Invalid payload' }, 200);
    }

    const serverKey = Deno.env.get('MIDTRANS_SERVER_KEY');
    if (!serverKey) {
      // Return 200 even for config error - Midtrans expects 200 always
      console.error('[midtrans-webhook] Missing MIDTRANS_SERVER_KEY');
      return jsonResponse({ status: 'ok', message: 'Server key not configured' }, 200);
    }

    const isValidSignature = await verifyMidtransSignature(
      payload.order_id,
      payload.status_code,
      payload.gross_amount,
      serverKey,
      payload.signature_key,
    );

    if (!isValidSignature) {
      // Return 200 even for invalid signature - Midtrans expects 200 always
      // Log internally for security review but don't reveal to caller
      console.error('[midtrans-webhook] Invalid signature for order:', payload.order_id);
      return jsonResponse({ status: 'ok', message: 'Invalid signature' }, 200);
    }

    adminClient = getSupabaseAdminClient();

    const { error: reconcileError } = await adminClient.rpc(
      'reconcile_midtrans_orphan_notifications',
      { p_limit: 5 },
    );
    if (reconcileError) {
      console.error('[midtrans-webhook] Orphan reconciliation RPC error:', reconcileError.message);
    }

    // Persist raw notification immediately after signature validation for audit trail
    // This ensures we have the payload even if order not found or amount mismatch
    await persistRawNotificationEarly(adminClient, payload);

    const webhookEventKey = buildWebhookEventKey(payload);

    // Verify transaction status with Midtrans API for accurate state.
    let verifiedStatus: MidtransStatusResponse;
    try {
      verifiedStatus = await verifyMidtransTransactionWithRetry(payload.order_id, serverKey);
    } catch (verificationError) {
      const message =
        verificationError instanceof Error
          ? verificationError.message
          : 'Unknown verification error';
      console.error('[midtrans-webhook] Status verification failed:', message);
      return jsonResponse(
        { status: 'ok', message: 'Status verification failed, will reconcile later' },
        200,
      );
    }

    const { data: rawOrder, error: orderError } = await getOrderWithRetry(
      adminClient,
      payload.order_id,
    );

    if (orderError || !rawOrder) {
      console.warn('[midtrans-webhook] Order not found for:', payload.order_id);
      return jsonResponse({ status: 'ok', message: 'Order not found, notification stored' }, 200);
    }

    const order = rawOrder as unknown as Order;

    const expectedAmount = Math.round(
      Number(order.gross_amount ?? order.total_amount + Number(order.shipping_cost ?? 0)),
    );
    const webhookAmount = Math.round(
      toNumericAmount(verifiedStatus.gross_amount || payload.gross_amount),
    );

    if (webhookAmount !== expectedAmount) {
      // Return 200 for amount mismatch - log internally for fraud review
      console.error(
        '[midtrans-webhook] Amount mismatch for order:',
        payload.order_id,
        'expected:',
        expectedAmount,
        'got:',
        webhookAmount,
      );
      return jsonResponse({ status: 'ok', message: 'Amount mismatch recorded' }, 200);
    }

    const { newPaymentStatus, newOrderStatus, shouldReduceStock } = mapMidtransStatus(
      verifiedStatus.transaction_status,
      verifiedStatus.fraud_status || payload.fraud_status || '',
      order.payment_status,
      order.status,
    );

    const paymentType = normalizePaymentType(
      verifiedStatus.payment_type || payload.payment_type || order.payment_type,
    );

    const { data: transitionResult, error: transitionError } = await adminClient.rpc(
      'apply_midtrans_webhook_transition',
      {
        p_provider: 'midtrans',
        p_event_key: webhookEventKey,
        p_order_id: order.id,
        p_next_payment_status: newPaymentStatus,
        p_next_order_status: newOrderStatus,
        p_midtrans_transaction_id: verifiedStatus.transaction_id || payload.transaction_id || null,
        p_payment_type: paymentType,
      },
    );

    if (transitionError) {
      console.error('[midtrans-webhook] Transition error:', transitionError.message);
      return jsonResponse({ status: 'ok', message: 'Transition error logged' }, 200);
    }

    const transition = Array.isArray(transitionResult) ? transitionResult[0] : transitionResult;
    const applied = transition?.applied ?? false;

    // Always persist raw_notification for audit trail, regardless of transition result
    await upsertPaymentRecord(order, payload, verifiedStatus, newPaymentStatus);

    if (applied) {
      await adminClient.from('order_activities').insert({
        order_id: order.id,
        action: shouldReduceStock ? 'payment_success' : 'payment_updated',
        old_status: order.status,
        new_status: newOrderStatus,
        actor_type: 'system',
        metadata: {
          payment_status: newPaymentStatus,
          payment_type: paymentType,
          transaction_id: verifiedStatus.transaction_id || payload.transaction_id || null,
        },
      });
    }

    // Clear cart on settlement regardless of 'applied' to ensure retry on failure
    // This prevents cart items persisting if first webhook succeeds but cart deletion fails
    if (newPaymentStatus === 'settlement' && order.user_id) {
      const { data: userCart } = await adminClient
        .from('carts')
        .select('id')
        .eq('user_id', order.user_id)
        .maybeSingle();

      if (userCart?.id) {
        const { error: cartClearError } = await adminClient
          .from('cart_items')
          .delete()
          .eq('cart_id', userCart.id);

        if (cartClearError) {
          console.error('[midtrans-webhook] Failed to clear cart:', cartClearError.message);
        }
      }
    }

    let existingSideEffectTask = await getSideEffectTask(adminClient, order.id);

    if (applied && shouldReduceStock && !existingSideEffectTask) {
      await saveSideEffectTask(
        adminClient,
        order.id,
        true,
        !order.biteship_order_id,
        'Created side effect task from settlement transition',
      );
      existingSideEffectTask = await getSideEffectTask(adminClient, order.id);
    }

    const shouldRunFulfillment = applied || !!existingSideEffectTask;

    if (!shouldRunFulfillment) {
      if (!applied) {
        return jsonResponse(
          { status: 'ok', message: 'Transition already applied or invalid' },
          200,
        );
      }

      return jsonResponse({ status: 'ok' }, 200);
    }

    let needsStock = existingSideEffectTask?.needs_stock ?? (applied && shouldReduceStock);
    let needsBiteship =
      existingSideEffectTask?.needs_biteship ??
      (applied && shouldReduceStock && !order.biteship_order_id);
    needsBiteship = needsBiteship && !order.biteship_order_id;
    let lastError: string | null = null;
    let pendingBiteshipOrderId = existingSideEffectTask?.pending_biteship_order_id ?? null;
    let pendingWaybillNumber = existingSideEffectTask?.pending_waybill_number ?? null;

    if (existingSideEffectTask) {
      const claimed = await claimSideEffectTask(adminClient, order.id, existingSideEffectTask);
      if (!claimed) {
        return jsonResponse({ status: 'ok', message: 'Side effect task already claimed' }, 200);
      }
    }

    if (needsStock && order.order_items && order.order_items.length > 0) {
      let stockFailed = false;

      for (const item of order.order_items) {
        if (!item.product_id) continue;
        await renewSideEffectTaskLease(adminClient, order.id);

        let stockReduced = false;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const { error: rpcError } = await adminClient.rpc('apply_order_item_stock_deduction', {
            p_order_id: order.id,
            p_product_id: item.product_id,
            p_quantity: item.quantity || 0,
          });

          if (!rpcError) {
            stockReduced = true;
            break;
          }

          if (attempt === 2) {
            console.error(
              '[midtrans-webhook] Stock reduction failed for',
              item.product_id,
              ':',
              rpcError.message,
            );
          } else {
            await sleep(250 * (attempt + 1));
          }
        }

        if (!stockReduced) {
          stockFailed = true;
          lastError = 'Failed to reduce stock after retries';
        }
      }

      needsStock = stockFailed;
    }

    const biteshipKey = Deno.env.get('BITESHIP_API_KEY');

    if (needsBiteship && pendingBiteshipOrderId) {
      const { error: persistPendingError } = await adminClient
        .from('orders')
        .update({
          biteship_order_id: pendingBiteshipOrderId,
          waybill_number: pendingWaybillNumber,
        })
        .eq('id', order.id);

      if (persistPendingError) {
        lastError = `Failed to persist pending Biteship result: ${persistPendingError.message}`;
      } else {
        needsBiteship = false;
        pendingBiteshipOrderId = null;
        pendingWaybillNumber = null;
      }
    }

    if (needsBiteship && biteshipKey) {
      await renewSideEffectTaskLease(adminClient, order.id);
      let biteshipResponse: BiteshipOrderResponse | null = null;

      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await renewSideEffectTaskLease(adminClient, order.id);
          type BiteshipOrderInput = Parameters<typeof createBiteshipOrder>[0];
          biteshipResponse = (await withTimeout(
            createBiteshipOrder(order as unknown as BiteshipOrderInput, biteshipKey),
            BITESHIP_CALL_TIMEOUT_MS,
            'Biteship request timeout',
          )) as BiteshipOrderResponse;
          break;
        } catch (biteshipError: unknown) {
          const message =
            biteshipError instanceof Error ? biteshipError.message : 'Unknown Biteship error';
          if (attempt === 2) {
            console.error('[midtrans-webhook] Biteship automation failed:', message);
          } else {
            await sleep(350 * (attempt + 1));
          }
        }
      }

      if (biteshipResponse) {
        await persistPendingBiteshipResult(
          adminClient,
          order.id,
          biteshipResponse.id,
          biteshipResponse.courier?.waybill_id || null,
        );

        const { error: updateOrderError } = await adminClient
          .from('orders')
          .update({
            biteship_order_id: biteshipResponse.id,
            waybill_number: biteshipResponse.courier?.waybill_id || null,
          })
          .eq('id', order.id);

        if (updateOrderError) {
          needsBiteship = true;
          lastError = `Failed to persist Biteship result: ${updateOrderError.message}`;
          pendingBiteshipOrderId = biteshipResponse.id;
          pendingWaybillNumber = biteshipResponse.courier?.waybill_id || null;
        } else {
          needsBiteship = false;
          pendingBiteshipOrderId = null;
          pendingWaybillNumber = null;
        }
      } else {
        needsBiteship = true;
        if (!lastError) {
          lastError = 'Failed to create biteship order after retries';
        }
      }
    } else if (needsBiteship && !biteshipKey && !lastError) {
      lastError = 'BITESHIP_API_KEY is not configured';
    }

    await saveSideEffectTask(
      adminClient,
      order.id,
      needsStock,
      needsBiteship,
      lastError,
      pendingBiteshipOrderId,
      pendingWaybillNumber,
    );

    return jsonResponse({ status: 'ok' }, 200);
  } catch (error: unknown) {
    // Return 200 for all errors - Midtrans expects 200 always
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[midtrans-webhook] Internal error:', message);
    return jsonResponse({ status: 'ok', message: 'Error logged' }, 200);
  }
});
