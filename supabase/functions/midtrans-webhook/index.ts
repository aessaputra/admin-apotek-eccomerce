import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  assertMidtransCurrencyConsistency,
  buildMidtransPaymentRecord,
  calculateMidtransGrossAmount,
  isConfirmedMidtransSuccess,
  isIgnorableMidtransNoop,
  mapMidtransStatus,
  normalizeMidtransPaymentType,
  verifyMidtransSignature,
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
  MidtransWebhookPayload,
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

function errorResponse(message: string, status = 500): Response {
  return jsonResponse({ error: message }, status);
}

function toNumericAmount(value: string | number | null | undefined): number {
  if (value == null) return 0;
  return Number.parseFloat(String(value));
}

function buildWebhookEventKey(payload: MidtransWebhookPayload): string {
  // Include fraud_status to differentiate capture+challenge from capture+accept
  const fraudStatus = payload.fraud_status || "";
  return [
    payload.transaction_id || payload.order_id,
    payload.transaction_status,
    payload.status_code,
    payload.gross_amount,
    fraudStatus,
  ].join(":");
}

function getExpectedOrderAmount(order: Order): number {
  if (order.gross_amount != null) {
    const normalizedGrossAmount = Number(order.gross_amount);

    if (!Number.isFinite(normalizedGrossAmount)) {
      throw new Error(
        `Invalid gross_amount for order ${order.id}. Payment validation requires a numeric persisted Midtrans amount.`,
      );
    }

    return Math.round(normalizedGrossAmount);
  }

  const calculatedGrossAmount = calculateMidtransGrossAmount(order);

  if (!Number.isFinite(calculatedGrossAmount)) {
    throw new Error(
      `Unable to calculate a valid Midtrans gross amount for order ${order.id}. Payment validation requires a numeric order amount.`,
    );
  }

  return Math.round(calculatedGrossAmount);
}

async function persistRawNotificationEarly(
  adminClient: ReturnType<typeof getSupabaseAdminClient>,
  payload: MidtransWebhookPayload,
): Promise<void> {
  const currency = assertMidtransCurrencyConsistency(
    payload.currency,
    payload.currency,
    payload.order_id,
  );

  const rawRecord = {
    midtrans_order_id: payload.order_id,
    midtrans_transaction_id: payload.transaction_id || null,
    transaction_status: payload.transaction_status || null,
    fraud_status: payload.fraud_status || null,
    status_code: payload.status_code || null,
    gross_amount: toNumericAmount(payload.gross_amount),
    currency,
    raw_notification: payload,
  };

  const { error } = await adminClient
    .from("payments")
    .upsert(rawRecord, { onConflict: "midtrans_order_id" });

  if (error) {
    console.error(
      "[midtrans-webhook] Failed to persist raw notification:",
      error.message,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  throw lastError instanceof Error
    ? lastError
    : new Error("Midtrans verification failed");
}

async function getOrderWithRetry(
  adminClient: ReturnType<typeof getSupabaseAdminClient>,
  midtransOrderId: string,
  attempts = 3,
): Promise<{ data: unknown; error: unknown }> {
  let latestResult: { data: unknown; error: unknown } = {
    data: null,
    error: null,
  };

  for (let index = 0; index < attempts; index += 1) {
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
      .eq("midtrans_order_id", midtransOrderId)
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

  const { data: existingPayment } = await adminClient
    .from("payments")
    .select("paid_at")
    .eq("midtrans_order_id", payload.order_id)
    .maybeSingle();

  const paymentPayload = buildMidtransPaymentRecord({
    order,
    payload,
    verifiedStatus,
    nextPaymentStatus: status,
    existingPaidAt: existingPayment?.paid_at,
  });

  const { error } = await adminClient
    .from("payments")
    .upsert(paymentPayload, { onConflict: "midtrans_order_id" });

  if (error) {
    throw new Error(`Failed to upsert payment record: ${error.message}`);
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    console.error("[midtrans-webhook] Invalid method:", req.method);
    return errorResponse("Method Not Allowed", 405);
  }

  let payload: MidtransWebhookPayload | null = null;
  let adminClient: ReturnType<typeof getSupabaseAdminClient> | null = null;

  try {
    const bodyText = await req.text();

    try {
      payload = JSON.parse(bodyText) as MidtransWebhookPayload;
    } catch (parseError) {
      console.error("[midtrans-webhook] Invalid JSON:", parseError);
      return errorResponse("Invalid JSON payload", 400);
    }

    if (
      !payload.order_id ||
      !payload.status_code ||
      !payload.gross_amount ||
      !payload.signature_key
    ) {
      console.error(
        "[midtrans-webhook] Invalid payload: missing required fields",
      );
      return errorResponse("Invalid payload", 400);
    }

    const serverKey = Deno.env.get("MIDTRANS_SERVER_KEY");
    if (!serverKey) {
      console.error("[midtrans-webhook] Missing MIDTRANS_SERVER_KEY");
      return errorResponse("Server key not configured", 500);
    }

    const isValidSignature = await verifyMidtransSignature(
      payload.order_id,
      payload.status_code,
      payload.gross_amount,
      serverKey,
      payload.signature_key,
    );

    if (!isValidSignature) {
      console.error(
        "[midtrans-webhook] Invalid signature for order:",
        payload.order_id,
      );
      return errorResponse("Invalid signature", 401);
    }

    adminClient = getSupabaseAdminClient();

    // Persist raw notification immediately after signature validation for audit trail
    // This ensures we have the payload even if order not found or amount mismatch
    await persistRawNotificationEarly(adminClient, payload);

    const webhookEventKey = buildWebhookEventKey(payload);

    // Verify transaction status with Midtrans API for accurate state.
    let verifiedStatus: MidtransStatusResponse;
    try {
      verifiedStatus = await verifyMidtransTransactionWithRetry(
        payload.order_id,
        serverKey,
      );
    } catch (verificationError) {
      const message =
        verificationError instanceof Error
          ? verificationError.message
          : "Unknown verification error";
      console.error("[midtrans-webhook] Status verification failed:", message);
      return errorResponse("Status verification failed, retry later", 503);
    }

    const { data: rawOrder, error: orderError } = await getOrderWithRetry(
      adminClient,
      payload.order_id,
    );

    if (orderError || !rawOrder) {
      console.warn("[midtrans-webhook] Order not found for:", payload.order_id);
      return errorResponse("Order not found, retry later", 503);
    }

    const order = rawOrder as unknown as Order;
    const verifiedFraudStatus =
      verifiedStatus.fraud_status || payload.fraud_status || "";
    const payloadSuccessSignal =
      payload.transaction_status === "settlement" ||
      (payload.transaction_status === "capture" &&
        (payload.fraud_status || "").toLowerCase() === "accept");
    const verifiedSuccessSignal = isConfirmedMidtransSuccess({
      transaction_status: verifiedStatus.transaction_status,
      fraud_status: verifiedFraudStatus,
      status_code: verifiedStatus.status_code || payload.status_code,
    });

    if (payloadSuccessSignal && !verifiedSuccessSignal) {
      console.warn(
        "[midtrans-webhook] Success webhook received before Midtrans status API confirmed success for order:",
        payload.order_id,
        "payload_status:",
        payload.transaction_status,
        "verified_status:",
        verifiedStatus.transaction_status,
      );
      return errorResponse("Midtrans status not confirmed yet", 503);
    }

    if (
      (verifiedStatus.transaction_status === "settlement" ||
        (verifiedStatus.transaction_status === "capture" &&
          verifiedFraudStatus.toLowerCase() === "accept")) &&
      !verifiedSuccessSignal
    ) {
      console.error(
        "[midtrans-webhook] Success state validation failed for order:",
        payload.order_id,
      );
      return errorResponse("Success state validation failed", 409);
    }

    const expectedAmount = getExpectedOrderAmount(order);
    const webhookAmount = Math.round(
      toNumericAmount(verifiedStatus.gross_amount || payload.gross_amount),
    );

    if (webhookAmount !== expectedAmount) {
      console.error(
        "[midtrans-webhook] Amount mismatch for order:",
        payload.order_id,
        "expected:",
        expectedAmount,
        "got:",
        webhookAmount,
      );
      return errorResponse("Amount mismatch recorded", 409);
    }

    const { newPaymentStatus, newOrderStatus, shouldReduceStock } =
      mapMidtransStatus(
        verifiedStatus.transaction_status,
        verifiedFraudStatus,
        order.payment_status,
        order.status,
      );

    const paymentType = normalizeMidtransPaymentType(
      verifiedStatus.payment_type || payload.payment_type || order.payment_type,
    );
    const paymentCurrency = assertMidtransCurrencyConsistency(
      verifiedStatus.currency,
      payload.currency,
      payload.order_id,
    );

    const { data: transitionResult, error: transitionError } =
      await adminClient.rpc("apply_midtrans_webhook_transition", {
        p_provider: "midtrans",
        p_event_key: webhookEventKey,
        p_order_id: order.id,
        p_next_payment_status: newPaymentStatus,
        p_next_order_status: newOrderStatus,
        p_midtrans_transaction_id:
          verifiedStatus.transaction_id || payload.transaction_id || null,
        p_payment_type: paymentType,
        p_paid_at:
          newPaymentStatus === "settlement"
            ? verifiedStatus.settlement_time || payload.settlement_time || null
            : null,
      });

    if (transitionError) {
      console.error(
        "[midtrans-webhook] Transition error:",
        transitionError.message,
      );
      return errorResponse("Transition error logged", 503);
    }

    const transition = Array.isArray(transitionResult)
      ? transitionResult[0]
      : transitionResult;
    const applied = transition?.applied ?? false;
    const persistedPaymentStatus =
      (transition?.payment_status as PaymentStatus | undefined) ||
      newPaymentStatus;
    const persistedOrderStatus = transition?.order_status || order.status;
    const ignorableNoop =
      !applied &&
      isIgnorableMidtransNoop(
        transition?.payment_status as PaymentStatus | undefined,
        newPaymentStatus,
      );

    await upsertPaymentRecord(
      order,
      payload,
      verifiedStatus,
      persistedPaymentStatus,
    );

    if (!applied && !ignorableNoop) {
      console.error(
        "[midtrans-webhook] Transition was not persisted for order:",
        order.id,
        "current:",
        transition?.payment_status,
        "requested:",
        newPaymentStatus,
      );
      return errorResponse("Transition was not persisted", 503);
    }

    if (applied) {
      await adminClient.from("order_activities").insert({
        order_id: order.id,
        action: shouldReduceStock ? "payment_success" : "payment_updated",
        old_status: order.status,
        new_status: newOrderStatus,
        actor_type: "system",
        metadata: {
          payment_status: persistedPaymentStatus,
          payment_type: paymentType,
          currency: paymentCurrency,
          transaction_id:
            verifiedStatus.transaction_id || payload.transaction_id || null,
        },
      });
    }

    let existingSideEffectTask = await getSideEffectTask(adminClient, order.id);

    if (persistedPaymentStatus === "settlement" && !existingSideEffectTask) {
      await saveSideEffectTask(
        adminClient,
        order.id,
        true,
        true,
        false, // Defer Biteship courier creation to 'awaiting_shipment' manual transition state
        null,
      );
      existingSideEffectTask = await getSideEffectTask(adminClient, order.id);
    }

    const shouldRunFulfillment =
      persistedPaymentStatus === "settlement" && !!existingSideEffectTask;

    if (!shouldRunFulfillment) {
      if (!applied && ignorableNoop) {
        return jsonResponse(
          {
            status: "ok",
            message: "Transition already satisfied or safely ignored",
          },
          200,
        );
      }

      return jsonResponse({ status: "ok" }, 200);
    }

    triggerWebhookSideEffectProcessor(order.id);

    return jsonResponse({ status: "ok" }, 200);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[midtrans-webhook] Internal error:", message);
    return errorResponse("Internal error", 500);
  }
});
