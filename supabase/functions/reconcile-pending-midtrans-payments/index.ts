import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  calculateMidtransGrossAmount,
  isConfirmedMidtransSuccess,
  isIgnorableMidtransNoop,
  mapMidtransStatus,
  verifyMidtransTransaction,
} from "../_shared/midtrans.ts";
import { getSupabaseAdminClient } from "../_shared/supabase.ts";
import {
  getSideEffectTask,
  saveSideEffectTask,
  triggerWebhookSideEffectProcessor,
} from "../_shared/webhook-side-effects.ts";
import type {
  MidtransStatusResponse,
  Order,
  PaymentStatus,
} from "../_shared/types.ts";

declare const Deno: {
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
  env: {
    get: (key: string) => string | undefined;
  };
};

const JSON_HEADERS = { "Content-Type": "application/json" };

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

function isAuthorizedRequest(req: Request): boolean {
  const authHeader = req.headers.get("Authorization");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  return !!serviceRoleKey && authHeader === `Bearer ${serviceRoleKey}`;
}

function toNumericAmount(value: string | number | null | undefined): number {
  if (value == null) return 0;
  return Number.parseFloat(String(value));
}

function normalizePaymentType(value: string | null | undefined): string | null {
  if (!value) return null;

  const allowlist = new Set([
    "credit_card",
    "bank_transfer",
    "echannel",
    "gopay",
    "shopeepay",
    "qris",
    "akulaku",
    "kredivo",
    "indomaret",
    "alfamart",
    "bca_klikbca",
    "bca_klikpay",
    "bri_epay",
    "cimb_clicks",
    "danamon_online",
    "uob_ezpay",
    "other",
  ]);

  return allowlist.has(value) ? value : "other";
}

function getRequiredPaymentCurrency(
  primaryValue: string | null | undefined,
  secondaryValue: string | null | undefined,
  orderId: string,
): string {
  const rawCurrency = primaryValue ?? secondaryValue;
  const normalizedCurrency = rawCurrency?.trim().toUpperCase();

  if (!normalizedCurrency) {
    throw new Error(
      `Missing currency while reconciling Midtrans status for order ${orderId}.`,
    );
  }

  return normalizedCurrency;
}

function getPaidAt(nextPaymentStatus: PaymentStatus): string | null {
  return nextPaymentStatus === "settlement" ? new Date().toISOString() : null;
}

function getExpectedOrderAmount(order: Order): number {
  if (order.gross_amount != null) {
    const normalizedGrossAmount = Number(order.gross_amount);

    if (!Number.isFinite(normalizedGrossAmount)) {
      throw new Error(`Invalid gross_amount for order ${order.id}.`);
    }

    return Math.round(normalizedGrossAmount);
  }

  const calculatedGrossAmount = calculateMidtransGrossAmount(order);
  if (!Number.isFinite(calculatedGrossAmount)) {
    throw new Error(
      `Unable to calculate a valid Midtrans gross amount for order ${order.id}.`,
    );
  }

  return Math.round(calculatedGrossAmount);
}

async function upsertPaymentRecord(
  adminClient: ReturnType<typeof getSupabaseAdminClient>,
  order: Order,
  verifiedStatus: MidtransStatusResponse,
  status: PaymentStatus,
): Promise<void> {
  const effectivePaymentType = normalizePaymentType(
    verifiedStatus.payment_type || order.payment_type,
  );

  const { data: existingPayment } = await adminClient
    .from("payments")
    .select("paid_at")
    .eq("midtrans_order_id", order.midtrans_order_id)
    .maybeSingle();

  const currency = getRequiredPaymentCurrency(
    verifiedStatus.currency,
    null,
    order.midtrans_order_id || order.id,
  );

  const { error } = await adminClient.from("payments").upsert(
    {
      order_id: order.id,
      user_id: order.user_id ?? null,
      checkout_idempotency_key: order.checkout_idempotency_key ?? null,
      midtrans_order_id: order.midtrans_order_id,
      midtrans_transaction_id: verifiedStatus.transaction_id || null,
      status,
      payment_type: effectivePaymentType,
      transaction_status: verifiedStatus.transaction_status || null,
      fraud_status: verifiedStatus.fraud_status || null,
      status_code: verifiedStatus.status_code || null,
      status_message: verifiedStatus.status_message || null,
      currency,
      gross_amount: toNumericAmount(verifiedStatus.gross_amount),
      merchant_id: verifiedStatus.merchant_id || null,
      transaction_time: verifiedStatus.transaction_time || null,
      settlement_time: verifiedStatus.settlement_time || null,
      expiry_time: verifiedStatus.expiry_time || null,
      paid_at: existingPayment?.paid_at || getPaidAt(status),
      payment_code: verifiedStatus.payment_code || null,
      store: verifiedStatus.store || null,
      va_numbers: verifiedStatus.va_numbers || [],
      biller_code: verifiedStatus.biller_code || null,
      bill_key: verifiedStatus.bill_key || null,
      bank: verifiedStatus.bank || null,
      acquirer: verifiedStatus.acquirer || null,
      issuer: verifiedStatus.issuer || null,
      card_type: verifiedStatus.card_type || null,
      masked_card: verifiedStatus.masked_card || null,
      approval_code: verifiedStatus.approval_code || null,
      eci: verifiedStatus.eci || null,
      channel_response_code: verifiedStatus.channel_response_code || null,
      channel_response_message: verifiedStatus.channel_response_message || null,
      redirect_url: verifiedStatus.redirect_url || null,
      raw_notification: verifiedStatus,
    },
    { onConflict: "midtrans_order_id" },
  );

  if (error) {
    throw new Error(`Failed to upsert payment record: ${error.message}`);
  }
}

async function listPendingOrders(
  adminClient: ReturnType<typeof getSupabaseAdminClient>,
  limit: number,
): Promise<Order[]> {
  const safeLimit = Math.max(1, Math.min(limit, 50));
  const { data, error } = await adminClient
    .from("orders")
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
    .in("payment_status", ["pending", "authorize"])
    .not("midtrans_order_id", "is", null)
    .not("snap_token", "is", null)
    .order("updated_at", { ascending: true })
    .limit(safeLimit);

  if (error) {
    throw new Error(`Failed to list pending orders: ${error.message}`);
  }

  return (data ?? []) as unknown[] as Order[];
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method Not Allowed" }, 405);
  }

  if (!isAuthorizedRequest(req)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  try {
    const adminClient = getSupabaseAdminClient();
    const body = await req.json().catch(() => ({}));
    const requestedLimit =
      typeof body?.limit === "number" && Number.isFinite(body.limit)
        ? body.limit
        : 10;
    const serverKey = Deno.env.get("MIDTRANS_SERVER_KEY");

    if (!serverKey) {
      return jsonResponse(
        { error: "MIDTRANS_SERVER_KEY is not configured" },
        500,
      );
    }

    const orders = await listPendingOrders(adminClient, requestedLimit);
    const results: Array<Record<string, unknown>> = [];

    for (const order of orders) {
      const midtransOrderId = order.midtrans_order_id?.trim();
      if (!midtransOrderId) {
        results.push({
          orderId: order.id,
          reconciled: false,
          message: "Missing midtrans_order_id",
        });
        continue;
      }

      try {
        const verifiedStatus = await verifyMidtransTransaction(
          midtransOrderId,
          serverKey,
        );
        const verifiedFraudStatus = verifiedStatus.fraud_status || "";

        if (
          (verifiedStatus.transaction_status === "settlement" ||
            (verifiedStatus.transaction_status === "capture" &&
              verifiedFraudStatus.toLowerCase() === "accept")) &&
          !isConfirmedMidtransSuccess({
            transaction_status: verifiedStatus.transaction_status,
            fraud_status: verifiedFraudStatus,
            status_code: verifiedStatus.status_code,
          })
        ) {
          results.push({
            orderId: order.id,
            reconciled: false,
            message: "Success state validation failed",
          });
          continue;
        }

        const expectedAmount = getExpectedOrderAmount(order);
        const verifiedAmount = Math.round(
          toNumericAmount(verifiedStatus.gross_amount),
        );

        if (verifiedAmount !== expectedAmount) {
          results.push({
            orderId: order.id,
            reconciled: false,
            message: "Amount mismatch",
          });
          continue;
        }

        const { newPaymentStatus, newOrderStatus, shouldReduceStock } =
          mapMidtransStatus(
            verifiedStatus.transaction_status,
            verifiedFraudStatus,
            order.payment_status,
            order.status,
          );

        const paymentType = normalizePaymentType(
          verifiedStatus.payment_type || order.payment_type,
        );

        const { data: transitionResult, error: transitionError } =
          await adminClient.rpc("apply_midtrans_webhook_transition", {
            p_provider: "midtrans-reconcile",
            p_event_key: [
              midtransOrderId,
              verifiedStatus.transaction_status,
              verifiedStatus.status_code || "",
              verifiedStatus.gross_amount || "",
              verifiedFraudStatus,
            ].join(":"),
            p_order_id: order.id,
            p_next_payment_status: newPaymentStatus,
            p_next_order_status: newOrderStatus,
            p_midtrans_transaction_id: verifiedStatus.transaction_id || null,
            p_payment_type: paymentType,
          });

        if (transitionError) {
          throw new Error(`Transition error: ${transitionError.message}`);
        }

        const transition = Array.isArray(transitionResult)
          ? transitionResult[0]
          : transitionResult;
        const applied = transition?.applied ?? false;
        const persistedPaymentStatus =
          (transition?.payment_status as PaymentStatus | undefined) ||
          newPaymentStatus;

        await upsertPaymentRecord(
          adminClient,
          order,
          verifiedStatus,
          persistedPaymentStatus,
        );

        if (
          !applied &&
          !isIgnorableMidtransNoop(
            transition?.payment_status as PaymentStatus | undefined,
            newPaymentStatus,
          )
        ) {
          results.push({
            orderId: order.id,
            reconciled: false,
            message: "Transition was not persisted",
            paymentStatus: transition?.payment_status || null,
          });
          continue;
        }

        if (persistedPaymentStatus === "settlement") {
          let existingSideEffectTask = await getSideEffectTask(
            adminClient,
            order.id,
          );
          if (!existingSideEffectTask) {
            await saveSideEffectTask(
              adminClient,
              order.id,
              true,
              !order.biteship_order_id,
              null,
            );
            existingSideEffectTask = await getSideEffectTask(
              adminClient,
              order.id,
            );
          }

          if (existingSideEffectTask && shouldReduceStock) {
            triggerWebhookSideEffectProcessor(order.id);
          }
        }

        results.push({
          orderId: order.id,
          reconciled: true,
          applied,
          paymentStatus: persistedPaymentStatus,
        });
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        results.push({ orderId: order.id, reconciled: false, message });
      }
    }

    return jsonResponse({
      processed_count: results.length,
      reconciled_count: results.filter((result) => result.reconciled === true)
        .length,
      results,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(
      "[reconcile-pending-midtrans-payments] Internal error:",
      message,
    );
    return jsonResponse({ error: message }, 500);
  }
});
