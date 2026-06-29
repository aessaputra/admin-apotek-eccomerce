import { corsHeaders } from "../_shared/cors.ts";
import {
  buildMidtransPaymentRecord,
  cancelMidtransTransaction,
  mapMidtransStatus,
  normalizeMidtransPaymentType,
  resolveMidtransTransactionRuntimeConfig,
  MidtransCurrencyValidationError,
  MidtransRuntimeConfigError,
  validateMidtransTransitionCurrency,
  verifyMidtransTransaction,
} from "../_shared/midtrans.ts";
import type { MidtransStatusResponse, Order, PaymentStatus } from "../_shared/types.ts";

type CancelUserOrderRequest = {
  order_id?: string;
};

type AdminClient = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (tableName: string) => any;
  rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<{
    data: unknown;
    error: { message?: string } | null;
  }>;
};

type CancelUserOrderHandlerDependencies = {
  getAuthenticatedUserId: (req: Request) => Promise<string | null>;
  getAdminClient: () => AdminClient;
  getOrderById: (adminClient: AdminClient, orderId: string) => Promise<Order | null>;
  resolveRuntimeConfig?: typeof resolveMidtransTransactionRuntimeConfig;
  verifyTransaction?: typeof verifyMidtransTransaction;
  cancelTransaction?: typeof cancelMidtransTransaction;
};

const JSON_HEADERS = { ...corsHeaders, "Content-Type": "application/json" };
const CANCELLABLE_GATEWAY_STATUSES = new Set(["pending", "authorize", "capture"]);
const TERMINAL_GATEWAY_STATUSES = new Set(["cancel", "deny", "expire", "failure"]);

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
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
    .eq("order_id", order.id)
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
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

async function cancelLocallyPendingOrder(
  adminClient: AdminClient,
  order: Order,
): Promise<void> {
  const now = new Date().toISOString();
  const { error: orderError } = await adminClient
    .from("orders")
    .update({ status: "cancelled", updated_at: now })
    .eq("id", order.id)
    .eq("status", order.status);

  if (orderError) {
    throw new Error(`Failed to cancel order: ${orderError.message}`);
  }

  const { error: paymentError } = await adminClient
    .from("payments")
    .update({ status: "cancel", updated_at: now })
    .eq("order_id", order.id)
    .in("status", ["pending", "authorize"]);

  if (paymentError) {
    throw new Error(`Failed to cancel payment snapshot: ${paymentError.message}`);
  }
}

async function reconcileTerminalCancelledOrder(
  adminClient: AdminClient,
  order: Order,
): Promise<void> {
  if (order.status === "cancelled") {
    return;
  }

  const { error } = await adminClient
    .from("orders")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", order.id)
    .eq("status", order.status);

  if (error) {
    throw new Error(`Failed to reconcile cancelled order: ${error.message}`);
  }
}

export function createCancelUserOrderHandler(
  dependencies: CancelUserOrderHandlerDependencies,
): (req: Request) => Promise<Response> {
  const resolveRuntimeConfig = dependencies.resolveRuntimeConfig ??
    resolveMidtransTransactionRuntimeConfig;
  const verifyTransaction = dependencies.verifyTransaction ?? verifyMidtransTransaction;
  const cancelTransaction = dependencies.cancelTransaction ?? cancelMidtransTransaction;

  return async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    if (req.method !== "POST") {
      return jsonResponse({ error: "Method Not Allowed" }, 405);
    }

    const userId = await dependencies.getAuthenticatedUserId(req);
    if (!userId) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    try {
      const body = (await req.json().catch(() => ({}))) as CancelUserOrderRequest;
      const orderId = typeof body.order_id === "string" ? body.order_id.trim() : "";

      if (!orderId) {
        return jsonResponse({ error: "order_id is required" }, 400);
      }

      const adminClient = dependencies.getAdminClient();
      const order = await dependencies.getOrderById(adminClient, orderId);

      if (!order) {
        return jsonResponse({ error: "Order not found" }, 404);
      }

      if (order.user_id !== userId) {
        return jsonResponse({ error: "Forbidden" }, 403);
      }

      if (order.status !== "pending") {
        return jsonResponse(
          {
            error: "Only unpaid orders can be cancelled by the customer",
            order_status: order.status,
            payment_status: order.payment_status,
          },
          409,
        );
      }

      if (["cancel", "deny", "expire"].includes(order.payment_status)) {
        await reconcileTerminalCancelledOrder(adminClient, order);

        return jsonResponse({
          cancelled: true,
          order_status: "cancelled",
          payment_status: order.payment_status,
          applied: false,
        });
      }

      if (order.payment_status === "settlement") {
        return jsonResponse(
          {
            error: "Paid orders cannot be cancelled from the unpaid flow",
            order_status: order.status,
            payment_status: order.payment_status,
          },
          409,
        );
      }

      const midtransOrderId = order.midtrans_order_id?.trim();
      if (!midtransOrderId) {
        await cancelLocallyPendingOrder(adminClient, order);

        return jsonResponse({
          cancelled: true,
          order_status: "cancelled",
          payment_status: "cancel",
          applied: true,
        });
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

      let verifiedStatus = await verifyTransaction(
        midtransOrderId,
        runtimeConfig.serverKey,
        { isProduction: runtimeConfig.isProduction },
      );

      if (verifiedStatus.transaction_status === "settlement") {
        return jsonResponse(
          {
            error: "Paid orders cannot be cancelled from the unpaid flow",
            order_status: order.status,
            payment_status: order.payment_status,
          },
          409,
        );
      }

      if (CANCELLABLE_GATEWAY_STATUSES.has(verifiedStatus.transaction_status)) {
        validateMidtransTransitionCurrency({
          orderId: midtransOrderId,
          expectedOrderCurrency: order.currency,
          verifiedCurrency: verifiedStatus.currency,
        });
        await cancelTransaction(midtransOrderId, runtimeConfig.serverKey, {
          isProduction: runtimeConfig.isProduction,
        });
        verifiedStatus = await verifyTransaction(
          midtransOrderId,
          runtimeConfig.serverKey,
          { isProduction: runtimeConfig.isProduction },
        );
      } else if (!TERMINAL_GATEWAY_STATUSES.has(verifiedStatus.transaction_status)) {
        return jsonResponse(
          {
            error: `Midtrans transaction status '${verifiedStatus.transaction_status}' is not cancellable`,
            order_status: order.status,
            payment_status: order.payment_status,
          },
          409,
        );
      }

      validateMidtransTransitionCurrency({
        orderId: midtransOrderId,
        expectedOrderCurrency: order.currency,
        verifiedCurrency: verifiedStatus.currency,
      });

      const verifiedFraudStatus = verifiedStatus.fraud_status || "";
      const { newPaymentStatus, newOrderStatus } = mapMidtransStatus(
        verifiedStatus.transaction_status,
        verifiedFraudStatus,
        order.payment_status,
        order.status,
      );

      const paymentType = normalizeMidtransPaymentType(
        verifiedStatus.payment_type || order.payment_type,
      );

      const eventKey = [
        midtransOrderId,
        "user-cancel",
        verifiedStatus.transaction_status,
        verifiedStatus.transaction_id || "",
        userId,
      ].join(":");

      const { data: transitionResult, error: transitionError } = await adminClient.rpc(
        "apply_midtrans_webhook_transition",
        {
          p_provider: "midtrans-user-cancel",
          p_event_key: eventKey,
          p_order_id: order.id,
          p_next_payment_status: newPaymentStatus,
          p_next_order_status: newOrderStatus,
          p_midtrans_transaction_id: verifiedStatus.transaction_id || null,
          p_payment_type: paymentType,
          p_paid_at: null,
        },
      );

      if (transitionError) {
        throw new Error(`Transition error: ${transitionError.message}`);
      }

      const transition = Array.isArray(transitionResult)
        ? transitionResult[0]
        : transitionResult;
      const persistedPaymentStatus =
        (transition?.payment_status as PaymentStatus | undefined) || newPaymentStatus;

      await upsertPaymentRecord(adminClient, order, verifiedStatus, persistedPaymentStatus);

      return jsonResponse({
        cancelled: persistedPaymentStatus === "cancel",
        order_status: (transition?.order_status as string | undefined) || newOrderStatus,
        payment_status: persistedPaymentStatus,
        applied: transition?.applied ?? false,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";

      if (error instanceof MidtransCurrencyValidationError) {
        return jsonResponse({ error: message }, 409);
      }

      console.error("[cancel-user-order] Internal error", {
        category: "order_cancellation_failed",
      });

      return jsonResponse({ error: "Order cancellation failed" }, 500);
    }
  };
}
