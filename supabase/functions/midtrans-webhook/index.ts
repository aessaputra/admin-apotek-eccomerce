import type { getSupabaseAdminClient } from "../_shared/supabase.ts";
import {
  assertMidtransCurrencyConsistency,
  buildMidtransPaymentRecord,
  calculateMidtransGrossAmount,
  isConfirmedMidtransSuccess,
  isIgnorableMidtransNoop,
  mapMidtransStatus,
  normalizeMidtransPaymentType,
  resolveMidtransWebhookRuntimeConfig,
  MidtransCurrencyValidationError,
  MidtransRuntimeConfigError,
  validateMidtransTransitionCurrency,
  verifyMidtransTransaction,
  type MidtransRuntimeConfig,
} from "../_shared/midtrans.ts";
import {
  ORDER_DETAIL_NOTIFICATION_ROUTE,
  insertNotificationOrThrow,
} from "../_shared/notification-helpers.ts";
import {
  ensureSettlementSideEffectsQueued,
  triggerWebhookSideEffectProcessor,
} from "../_shared/webhook-side-effects.ts";
import { getOrderAggregateByMidtransOrderId } from "../_shared/order-aggregate.ts";
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

type SupabaseAdminClient = ReturnType<typeof getSupabaseAdminClient>;
type VerifiedMidtransWebhookPayload = MidtransWebhookPayload & {
  status_api_verified: boolean;
};

async function getDefaultAdminClient(): Promise<SupabaseAdminClient> {
  const supabaseModule = await import("../_shared/supabase.ts");
  return supabaseModule.getSupabaseAdminClient() as SupabaseAdminClient;
}

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

function toRoundedAmount(value: string | number | null | undefined): number | null {
  if (value == null) return null;

  const amount = Number.parseFloat(String(value));
  return Number.isFinite(amount) ? Math.round(amount) : null;
}

function normalizeComparableText(value: string | null | undefined): string | null {
  const normalizedValue = value?.trim().toLowerCase();
  return normalizedValue ? normalizedValue : null;
}

function hasVerifiedRawNotification(rawNotification: unknown): boolean {
  return !!rawNotification &&
    typeof rawNotification === "object" &&
    (rawNotification as { status_api_verified?: unknown }).status_api_verified === true;
}

function buildVerifiedRawNotification(
  payload: MidtransWebhookPayload,
): VerifiedMidtransWebhookPayload {
  return { ...payload, status_api_verified: true };
}

function isRawNotificationCorroboratedByStatus(
  payload: MidtransWebhookPayload,
  verifiedStatus: MidtransStatusResponse,
): boolean {
  if (verifiedStatus.order_id && verifiedStatus.order_id !== payload.order_id) {
    return false;
  }

  if (payload.transaction_status !== verifiedStatus.transaction_status) {
    return false;
  }

  if (
    (payload.transaction_status === "capture" ||
      verifiedStatus.transaction_status === "capture") &&
    normalizeComparableText(payload.fraud_status) !==
      normalizeComparableText(verifiedStatus.fraud_status)
  ) {
    return false;
  }

  if (
    payload.status_code &&
    verifiedStatus.status_code &&
    payload.status_code !== verifiedStatus.status_code
  ) {
    return false;
  }

  if (toRoundedAmount(payload.gross_amount) !== toRoundedAmount(verifiedStatus.gross_amount)) {
    return false;
  }

  if (
    normalizeComparableText(payload.currency) !==
      normalizeComparableText(verifiedStatus.currency)
  ) {
    return false;
  }

  if (
    payload.transaction_id &&
    verifiedStatus.transaction_id &&
    payload.transaction_id !== verifiedStatus.transaction_id
  ) {
    return false;
  }

  if (
    payload.payment_type &&
    verifiedStatus.payment_type &&
    normalizeComparableText(payload.payment_type) !==
      normalizeComparableText(verifiedStatus.payment_type)
  ) {
    return false;
  }

  return true;
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

function buildPaymentNotification(orderId: string, paymentStatus: PaymentStatus) {
  if (paymentStatus === "settlement") {
    return {
      type: "payment_settlement",
      title: "Pembayaran berhasil",
      body: "Pembayaran pesananmu sudah kami terima. Pesanan akan segera diproses.",
      priority: "high" as const,
      sourceEventKey: `payment_settlement:${orderId}`,
    };
  }

  if (paymentStatus === "expire") {
    return {
      type: "payment_failed_or_expired",
      title: "Pembayaran kedaluwarsa",
      body: "Batas waktu pembayaran pesananmu telah berakhir. Silakan buat pesanan baru jika masih dibutuhkan.",
      priority: "normal" as const,
      sourceEventKey: `payment_failed_or_expired:expire:${orderId}`,
    };
  }

  if (paymentStatus === "deny") {
    return {
      type: "payment_failed_or_expired",
      title: "Pembayaran belum berhasil",
      body: "Pembayaran pesananmu belum berhasil diproses. Silakan cek metode pembayaran lalu coba lagi.",
      priority: "normal" as const,
      sourceEventKey: `payment_failed_or_expired:deny:${orderId}`,
    };
  }

  return null;
}

async function ensurePaymentNotification(
  adminClient: SupabaseAdminClient,
  orderId: string,
  userId: string | null,
  paymentStatus: PaymentStatus,
): Promise<void> {
  const paymentNotification = buildPaymentNotification(orderId, paymentStatus);

  if (!paymentNotification) {
    return;
  }

  await insertNotificationOrThrow(
    adminClient,
    {
      userId,
      type: paymentNotification.type,
      title: paymentNotification.title,
      body: paymentNotification.body,
      ctaRoute: ORDER_DETAIL_NOTIFICATION_ROUTE,
      data: {
        orderId,
        paymentStatus,
      },
      priority: paymentNotification.priority,
      sourceEventKey: paymentNotification.sourceEventKey,
    },
    "[midtrans-webhook]",
  );
}

async function persistRawNotificationEarly(
  adminClient: SupabaseAdminClient,
  payload: MidtransWebhookPayload,
): Promise<void> {
  const rawNotification = { ...payload, status_api_verified: false };

  const { data: existingPayment, error: lookupError } = await adminClient
    .from("payments")
    .select("order_id, raw_notification")
    .eq("midtrans_order_id", payload.order_id)
    .maybeSingle();

  if (lookupError) {
    console.error(
      "[midtrans-webhook] Failed to persist raw notification:",
      { code: "midtrans_raw_notification_persist_failed" },
    );
    return;
  }

  if (hasVerifiedRawNotification(existingPayment?.raw_notification)) {
    return;
  }

  if (existingPayment?.order_id) {
    const { error } = await adminClient
      .from("payments")
      .update({ raw_notification: rawNotification })
      .eq("midtrans_order_id", payload.order_id);

    if (error) {
      console.error(
        "[midtrans-webhook] Failed to persist raw notification:",
        { code: "midtrans_raw_notification_persist_failed" },
      );
    }

    return;
  }

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
    raw_notification: rawNotification,
  };

  const { error } = await adminClient
    .from("payments")
    .upsert(rawRecord, { onConflict: "midtrans_order_id" });

  if (error) {
    console.error(
      "[midtrans-webhook] Failed to persist raw notification:",
      { code: "midtrans_raw_notification_persist_failed" },
    );
  }
}

async function markRawNotificationStatusVerified(
  adminClient: SupabaseAdminClient,
  payload: MidtransWebhookPayload,
): Promise<void> {
  const { error } = await adminClient
    .from("payments")
    .update({ raw_notification: buildVerifiedRawNotification(payload) })
    .eq("midtrans_order_id", payload.order_id);

  if (error) {
    console.error(
      "[midtrans-webhook] Failed to persist raw notification:",
      { code: "midtrans_raw_notification_persist_failed" },
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function verifyMidtransTransactionWithRetry(
  orderId: string,
  runtimeConfig: MidtransRuntimeConfig,
  attempts = 3,
): Promise<MidtransStatusResponse> {
  let lastError: unknown;

  for (let index = 0; index < attempts; index += 1) {
    try {
      return await verifyMidtransTransaction(orderId, runtimeConfig.serverKey, {
        isProduction: runtimeConfig.isProduction,
      });
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
  adminClient: SupabaseAdminClient,
  midtransOrderId: string,
  attempts = 3,
): Promise<Order | null> {
  let latestOrder: Order | null = null;

  for (let index = 0; index < attempts; index += 1) {
    latestOrder = await getOrderAggregateByMidtransOrderId(
      adminClient,
      midtransOrderId,
    );

    if (latestOrder) {
      return latestOrder;
    }

    if (index < attempts - 1) {
      await sleep(300 * (index + 1));
    }
  }

  return latestOrder;
}

async function upsertPaymentRecord(
  adminClient: SupabaseAdminClient,
  order: Order,
  payload: MidtransWebhookPayload,
  verifiedStatus: MidtransStatusResponse,
  status: PaymentStatus,
): Promise<void> {
  const { data: existingPayment } = await adminClient
    .from("payments")
    .select("paid_at, redirect_url, snap_token, snap_token_created_at")
    .eq("midtrans_order_id", payload.order_id)
    .maybeSingle();

  const paymentPayload = buildMidtransPaymentRecord({
    order,
    payload,
    verifiedStatus,
    nextPaymentStatus: status,
    existingPaidAt: existingPayment?.paid_at,
    existingRedirectUrl: existingPayment?.redirect_url,
    existingSnapToken: existingPayment?.snap_token,
    existingSnapTokenCreatedAt: existingPayment?.snap_token_created_at,
  });
  paymentPayload.raw_notification = buildVerifiedRawNotification(payload);

  const { error } = await adminClient
    .from("payments")
    .upsert(paymentPayload, { onConflict: "midtrans_order_id" });

  if (error) {
    throw new Error(`Failed to upsert payment record: ${error.message}`);
  }
}

export function createMidtransWebhookHandler(dependencies: {
  getAdminClient?: () => SupabaseAdminClient | Promise<SupabaseAdminClient>;
} = {}) {
  const getAdminClient = dependencies.getAdminClient ?? getDefaultAdminClient;

  return async (req: Request) => {
  if (req.method !== "POST") {
    console.error("[midtrans-webhook] Invalid method:", req.method);
    return errorResponse("Method Not Allowed", 405);
  }

  let payload: MidtransWebhookPayload | null = null;
  let adminClient: SupabaseAdminClient | null = null;

  try {
    const bodyText = await req.text();

    try {
      payload = JSON.parse(bodyText) as MidtransWebhookPayload;
    } catch {
      console.error("[midtrans-webhook] Invalid JSON:", {
        code: "midtrans_invalid_json",
      });
      return errorResponse("Invalid JSON payload", 400);
    }

    if (
      !payload.order_id ||
      !payload.status_code ||
      !payload.gross_amount ||
      !payload.signature_key
    ) {
      console.error(
        "[midtrans-webhook] Invalid payload:",
        {
          code: "midtrans_invalid_payload",
          reason: "missing_required_fields",
        },
      );
      return errorResponse("Invalid payload", 400);
    }

    adminClient = await getAdminClient();

    let runtimeConfig: MidtransRuntimeConfig;
    let isValidSignature = false;
    try {
      const resolution = await resolveMidtransWebhookRuntimeConfig(
        adminClient,
        payload,
      );
      runtimeConfig = resolution.config;
      isValidSignature = resolution.signatureValid;
    } catch (configError) {
      if (configError instanceof MidtransRuntimeConfigError) {
        console.error("[midtrans-webhook] Midtrans runtime config unavailable");
        return errorResponse("Midtrans runtime config unavailable", 503);
      }

      throw configError;
    }

    if (!isValidSignature) {
      console.error(
        "[midtrans-webhook] Invalid signature for order:",
        payload.order_id,
      );
      return errorResponse("Invalid signature", 401);
    }

    const webhookEventKey = buildWebhookEventKey(payload);

    await persistRawNotificationEarly(adminClient, payload);

    // Verify transaction status with Midtrans API for accurate state.
    let verifiedStatus: MidtransStatusResponse;
    try {
      verifiedStatus = await verifyMidtransTransactionWithRetry(
        payload.order_id,
        runtimeConfig,
      );
    } catch {
      console.error("[midtrans-webhook] Status verification failed:", {
        code: "midtrans_status_verification_failed",
      });
      return errorResponse("Status verification failed, retry later", 503);
    }

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

    if (!isRawNotificationCorroboratedByStatus(payload, verifiedStatus)) {
      console.warn(
        "[midtrans-webhook] Raw notification was not corroborated by Midtrans status API for order:",
        payload.order_id,
        "payload_status:",
        payload.transaction_status,
        "verified_status:",
        verifiedStatus.transaction_status,
      );
      return errorResponse("Midtrans status not corroborated yet", 503);
    }

    await markRawNotificationStatusVerified(adminClient, payload);

    const order = await getOrderWithRetry(
      adminClient,
      payload.order_id,
    );

    if (!order) {
      console.warn("[midtrans-webhook] Order not found for:", payload.order_id);
      return errorResponse("Order not found, retry later", 503);
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
    const paymentCurrency = validateMidtransTransitionCurrency({
      orderId: payload.order_id,
      expectedOrderCurrency: order.currency,
      payloadCurrency: payload.currency,
      verifiedCurrency: verifiedStatus.currency,
    });

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
        { code: "midtrans_transition_failed" },
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
    const ignorableNoop =
      !applied &&
      isIgnorableMidtransNoop(
        transition?.payment_status as PaymentStatus | undefined,
        newPaymentStatus,
        transition?.order_status as string | undefined,
        newOrderStatus,
      );

    await upsertPaymentRecord(
      adminClient,
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

    const shouldRunFulfillment = await ensureSettlementSideEffectsQueued(
      adminClient,
      order.id,
      persistedPaymentStatus,
      { transitionApplied: applied },
    );

    if (!shouldRunFulfillment) {
      await ensurePaymentNotification(
        adminClient,
        order.id,
        order.user_id ?? null,
        persistedPaymentStatus,
      );

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

    await ensurePaymentNotification(
      adminClient,
      order.id,
      order.user_id ?? null,
      persistedPaymentStatus,
    );

    return jsonResponse({ status: "ok" }, 200);
  } catch (error: unknown) {
    console.error("[midtrans-webhook] Internal error:", {
      code: "midtrans_webhook_internal_error",
    });

    if (error instanceof MidtransCurrencyValidationError) {
      return errorResponse(error.message, 409);
    }

    return errorResponse("Internal error", 500);
  }
  };
}

Deno.serve(createMidtransWebhookHandler());
