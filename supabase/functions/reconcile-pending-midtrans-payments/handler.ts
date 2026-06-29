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
import type { MidtransStatusResponse, Order, PaymentStatus } from "../_shared/types.ts";

const JSON_HEADERS = { "Content-Type": "application/json" };

interface AdminClient {
  from: (table: string) => {
    select: (columns?: string) => {
      eq: (column: string, value: unknown) => {
        maybeSingle: () => Promise<{ data: { paid_at?: string | null } | null; error: { message: string } | null }>;
      };
      in: (column: string, values: unknown[]) => {
        not: (column: string, operator: string, value: unknown) => {
          not: (column: string, operator: string, value: unknown) => {
            order: (column: string, options: { ascending: boolean }) => {
              limit: (limit: number) => Promise<{ data: unknown[] | null; error: { message: string } | null }>;
            };
          };
        };
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

export interface ReconcilePendingMidtransPaymentsHandlerDependencies {
  getServiceRoleKey: () => string | undefined;
  getAdminClient: () => AdminClient;
  reconcileMidtransOrphans?: (adminClient: AdminClient) => Promise<void>;
  listPendingOrders?: (adminClient: AdminClient, limit: number) => Promise<Order[]>;
  resolveRuntimeConfig?: typeof resolveMidtransTransactionRuntimeConfig;
  verifyTransaction?: typeof verifyMidtransTransaction;
  ensureSettlementSideEffectsQueued?: typeof ensureSettlementSideEffectsQueued;
  triggerWebhookSideEffectProcessor?: typeof triggerWebhookSideEffectProcessor;
  logError?: (message: string) => void;
  logOrphanError?: (message: string) => void;
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function isAuthorizedRequest(req: Request, serviceRoleKey: string | undefined): boolean {
  const authHeader = req.headers.get("Authorization");
  return !!serviceRoleKey && authHeader === `Bearer ${serviceRoleKey}`;
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

async function defaultReconcileMidtransOrphans(
  adminClient: AdminClient,
  logOrphanError: (message: string) => void,
): Promise<void> {
  const { error } = await adminClient.rpc(
    "reconcile_midtrans_orphan_notifications",
    { p_limit: 20 },
  );

  if (error) {
    logOrphanError("midtrans_orphan_reconciliation_failed");
  }
}

async function defaultListPendingOrders(
  adminClient: AdminClient,
  limit: number,
): Promise<Order[]> {
  const safeLimit = Math.max(1, Math.min(limit, 50));
  const { data, error } = await adminClient
    .from("order_read_model")
    .select("id")
    .in("payment_status", ["pending", "authorize"])
    .not("midtrans_order_id", "is", null)
    .not("snap_token", "is", null)
    .order("updated_at", { ascending: true })
    .limit(safeLimit);

  if (error) {
    throw new Error(`Failed to list pending orders: ${error.message}`);
  }

  const rows = (data ?? []) as Array<{ id?: unknown }>;
  const ids = rows
    .map((row) => row.id)
    .filter((value): value is string => typeof value === "string");

  const orders = await Promise.all(
    ids.map((id) => getOrderAggregateById(adminClient, id)),
  );

  return orders.filter((order): order is Order => order !== null);
}

export function createReconcilePendingMidtransPaymentsHandler(
  dependencies: ReconcilePendingMidtransPaymentsHandlerDependencies,
): (req: Request) => Promise<Response> {
  const getAdminClient = dependencies.getAdminClient;
  const resolveRuntimeConfig = dependencies.resolveRuntimeConfig ??
    resolveMidtransTransactionRuntimeConfig;
  const verifyTransaction = dependencies.verifyTransaction ?? verifyMidtransTransaction;
  const queueSettlementSideEffects = dependencies.ensureSettlementSideEffectsQueued ??
    ensureSettlementSideEffectsQueued;
  const triggerSideEffectProcessor = dependencies.triggerWebhookSideEffectProcessor ??
    triggerWebhookSideEffectProcessor;
  const logError = dependencies.logError ??
    ((message: string) => console.error(
      "[reconcile-pending-midtrans-payments] internal_error",
      { action: message, errorCategory: "unexpected_failure" },
    ));
  const logOrphanError = dependencies.logOrphanError ??
    ((message: string) => console.error(
      "[reconcile-pending-midtrans-payments] orphan_reconciliation_failed",
      { action: message, errorCategory: "rpc_failed" },
    ));

  return async (req) => {
    if (req.method !== "POST") {
      return jsonResponse({ error: "Method Not Allowed" }, 405);
    }

    if (!isAuthorizedRequest(req, dependencies.getServiceRoleKey())) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    try {
      const adminClient = getAdminClient();
      const body = await req.json().catch(() => ({}));
      const requestedLimit =
        typeof body?.limit === "number" && Number.isFinite(body.limit)
          ? body.limit
          : 10;
      const reconcileMidtransOrphans = dependencies.reconcileMidtransOrphans ??
        ((client: AdminClient) => defaultReconcileMidtransOrphans(client, logOrphanError));
      const listPendingOrders = dependencies.listPendingOrders ?? defaultListPendingOrders;

      await reconcileMidtransOrphans(adminClient);

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
          const runtimeConfig = await resolveRuntimeConfig(adminClient, midtransOrderId);
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
            results.push({
              orderId: order.id,
              reconciled: false,
              message: "Success state validation failed",
            });
            continue;
          }

          const expectedAmount = getExpectedOrderAmount(order);
          const verifiedAmount = Math.round(toNumericAmount(verifiedStatus.gross_amount));

          if (verifiedAmount !== expectedAmount) {
            results.push({
              orderId: order.id,
              reconciled: false,
              message: "Amount mismatch",
            });
            continue;
          }

          validateMidtransTransitionCurrency({
            orderId: midtransOrderId,
            expectedOrderCurrency: order.currency,
            verifiedCurrency: verifiedStatus.currency,
          });

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
            results.push({
              orderId: order.id,
              reconciled: false,
              message: "Transition was not persisted",
              paymentStatus: transition?.payment_status || null,
            });
            continue;
          }

          if (
            await queueSettlementSideEffects(adminClient, order.id, persistedPaymentStatus, {
              transitionApplied: applied,
            })
          ) {
            triggerSideEffectProcessor(order.id);
          }

          results.push({
            orderId: order.id,
            reconciled: true,
            applied,
            paymentStatus: persistedPaymentStatus,
          });
        } catch (error: unknown) {
          const message = error instanceof MidtransRuntimeConfigError
            ? "Midtrans runtime config unavailable"
            : error instanceof MidtransCurrencyValidationError
            ? error.message
            : "Payment reconciliation failed";
          if (!(error instanceof MidtransRuntimeConfigError || error instanceof MidtransCurrencyValidationError)) {
            logError("pending_order_reconciliation_failed");
          }
          results.push({ orderId: order.id, reconciled: false, message });
        }
      }

      return jsonResponse({
        processed_count: results.length,
        reconciled_count: results.filter((result) => result.reconciled === true).length,
        results,
      });
    } catch (_error: unknown) {
      logError("pending_payment_reconciliation_failed");
      return jsonResponse({ error: "Pending payment reconciliation failed" }, 500);
    }
  };
}
