import {
  buildMidtransPaymentRecord,
  calculateMidtransGrossAmount,
  isConfirmedMidtransSuccess,
  isIgnorableMidtransNoop,
  mapMidtransStatus,
  normalizeMidtransPaymentType,
  resolveMidtransTransactionRuntimeConfig,
  MidtransCurrencyValidationError,
  MidtransRuntimeConfigError,
  validateMidtransTransitionCurrency,
  verifyMidtransTransaction,
} from "../_shared/midtrans.ts";
import {
  ensureSettlementSideEffectsQueued,
  triggerWebhookSideEffectProcessor,
} from "../_shared/webhook-side-effects.ts";
import { getOrderAggregateById } from "../_shared/order-aggregate.ts";
import type {
  MidtransStatusResponse,
  Order,
  PaymentStatus,
} from "../_shared/types.ts";

const JSON_HEADERS = { "Content-Type": "application/json" };

interface AdminClient {
  from: (table: string) => {
    select: (columns?: string) => {
      eq: (column: string, value: unknown) => {
        maybeSingle: () => Promise<{ data: { paid_at?: string | null } | null; error: { message: string } | null }>;
      };
    };
    upsert: (
      values: Record<string, unknown>,
      options?: Record<string, unknown>,
    ) => Promise<{ error: { message: string } | null }>;
  };
  rpc: (
    name: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
}

export interface ConfirmMidtransPaymentHandlerDependencies {
  getAuthenticatedUserId: (req: Request) => Promise<string | null>;
  getAdminClient: () => AdminClient;
  getOrderById?: (adminClient: AdminClient, orderId: string) => Promise<Order | null>;
  resolveRuntimeConfig?: typeof resolveMidtransTransactionRuntimeConfig;
  verifyTransaction?: typeof verifyMidtransTransaction;
  ensureSettlementSideEffectsQueued?: typeof ensureSettlementSideEffectsQueued;
  triggerWebhookSideEffectProcessor?: typeof triggerWebhookSideEffectProcessor;
  logError?: (message: string) => void;
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function toNumericAmount(value: string | number | null | undefined): number {
  if (value == null) return 0;
  return Number.parseFloat(String(value));
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
  adminClient: AdminClient,
  order: Order,
  verifiedStatus: MidtransStatusResponse,
  status: PaymentStatus,
): Promise<void> {
  const { data: existingPayment } = await adminClient
    .from("payments")
    .select("paid_at")
    .eq("midtrans_order_id", order.midtrans_order_id)
    .maybeSingle();

  const { error } = await adminClient.from("payments").upsert(
    buildMidtransPaymentRecord({
      order,
      payload: null,
      verifiedStatus,
      nextPaymentStatus: status,
      existingPaidAt: existingPayment?.paid_at,
    }),
    { onConflict: "midtrans_order_id" },
  );

  if (error) {
    throw new Error(`Failed to upsert payment record: ${error.message}`);
  }
}

export function createConfirmMidtransPaymentHandler(
  dependencies: ConfirmMidtransPaymentHandlerDependencies,
): (req: Request) => Promise<Response> {
  const getAdminClient = dependencies.getAdminClient;
  const getOrderById = dependencies.getOrderById ?? getOrderAggregateById;
  const resolveRuntimeConfig = dependencies.resolveRuntimeConfig ??
    resolveMidtransTransactionRuntimeConfig;
  const verifyTransaction = dependencies.verifyTransaction ?? verifyMidtransTransaction;
  const queueSettlementSideEffects = dependencies.ensureSettlementSideEffectsQueued ??
    ensureSettlementSideEffectsQueued;
  const triggerSideEffectProcessor = dependencies.triggerWebhookSideEffectProcessor ??
    triggerWebhookSideEffectProcessor;
  const logError = dependencies.logError ??
    ((message: string) => console.error(
      "[confirm-midtrans-payment] internal_error",
      { action: message, errorCategory: "unexpected_failure" },
    ));

  return async (req) => {
    if (req.method !== "POST") {
      return jsonResponse({ error: "Method Not Allowed" }, 405);
    }

    const userId = await dependencies.getAuthenticatedUserId(req);
    if (!userId) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    try {
      const body = await req.json().catch(() => ({}));
      const orderId =
        typeof body?.order_id === "string" ? body.order_id.trim() : "";

      if (!orderId) {
        return jsonResponse({ error: "order_id is required" }, 400);
      }

      const adminClient = getAdminClient();
      const order = await getOrderById(adminClient, orderId);

      if (!order) {
        return jsonResponse({ error: "Order not found" }, 404);
      }

      if (order.user_id !== userId) {
        return jsonResponse({ error: "Forbidden" }, 403);
      }

      const midtransOrderId = order.midtrans_order_id?.trim();
      if (!midtransOrderId) {
        return jsonResponse({ error: "Order is missing midtrans_order_id" }, 400);
      }

      let runtimeConfig;
      try {
        runtimeConfig = await resolveRuntimeConfig(adminClient, midtransOrderId);
      } catch (configError) {
        if (configError instanceof MidtransRuntimeConfigError) {
          return jsonResponse({ error: "Midtrans runtime config unavailable" }, 503);
        }

        throw configError;
      }

      const verifiedStatus = await verifyTransaction(
        midtransOrderId,
        runtimeConfig.serverKey,
        { isProduction: runtimeConfig.isProduction },
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
        return jsonResponse(
          {
            confirmed: false,
            payment_status: order.payment_status,
            order_status: order.status,
            message: "Success state not yet confirmed by Midtrans",
          },
          200,
        );
      }

      const expectedAmount = getExpectedOrderAmount(order);
      const verifiedAmount = Math.round(toNumericAmount(verifiedStatus.gross_amount));

      if (verifiedAmount !== expectedAmount) {
        return jsonResponse({ error: "Amount mismatch" }, 409);
      }

      try {
        validateMidtransTransitionCurrency({
          orderId: midtransOrderId,
          expectedOrderCurrency: order.currency,
          verifiedCurrency: verifiedStatus.currency,
        });
      } catch (currencyError) {
        if (currencyError instanceof MidtransCurrencyValidationError) {
          return jsonResponse({ error: currencyError.message }, 409);
        }

        throw currencyError;
      }

      const { newPaymentStatus, newOrderStatus } = mapMidtransStatus(
        verifiedStatus.transaction_status,
        verifiedFraudStatus,
        order.payment_status,
        order.status,
      );

      const paymentType = normalizeMidtransPaymentType(
        verifiedStatus.payment_type || order.payment_type,
      );

      const { data: transitionResult, error: transitionError } =
        await adminClient.rpc("apply_midtrans_webhook_transition", {
          p_provider: "midtrans-manual-confirm",
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
          p_paid_at:
            newPaymentStatus === "settlement"
              ? verifiedStatus.settlement_time || null
              : null,
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

      await upsertPaymentRecord(adminClient, order, verifiedStatus, persistedPaymentStatus);

      if (
        !applied &&
        !isIgnorableMidtransNoop(
          transition?.payment_status as PaymentStatus | undefined,
          newPaymentStatus,
          transition?.order_status as string | undefined,
          newOrderStatus,
        )
      ) {
        return jsonResponse({ error: "Transition was not persisted" }, 409);
      }

      if (
        await queueSettlementSideEffects(adminClient, order.id, persistedPaymentStatus, {
          transitionApplied: applied,
        })
      ) {
        triggerSideEffectProcessor(order.id);
      }

      return jsonResponse({
        confirmed: true,
        payment_status: persistedPaymentStatus,
        order_status: transition?.order_status || newOrderStatus,
        applied,
      });
    } catch (_error: unknown) {
      logError("payment_confirmation_failed");
      return jsonResponse({ error: "Payment confirmation failed" }, 500);
    }
  };
}
