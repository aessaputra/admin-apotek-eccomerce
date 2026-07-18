import { corsHeaders } from "../_shared/cors.ts";
import {
  type NotificationInsertPayload,
  ORDER_DETAIL_NOTIFICATION_ROUTE,
  TRACK_SHIPMENT_NOTIFICATION_ROUTE,
  insertNotificationOrThrow,
} from "../_shared/notification-helpers.ts";
import {
  buildShipmentRestorePayload,
  runMutationWithRollback,
  type ShipmentSnapshot,
  toShipmentSnapshot,
} from "../_shared/order-manager-mutation.ts";
import {
  canApplyOrderStatusForPaymentStatus,
  requiresBiteshipSyncForProviderStatusTransition,
} from "../_shared/order-flow-rules.ts";
import { resolveBiteshipStatus } from "../_shared/order-status.ts";
import {
  cancelMidtransTransaction,
  mapMidtransStatus,
  resolveMidtransTransactionRuntimeConfig,
  MidtransCurrencyValidationError,
  MidtransTransactionNotFoundError,
  validateMidtransTransitionCurrency,
  verifyMidtransTransaction,
} from "../_shared/midtrans.ts";
import {
  getSideEffectTask,
  saveSideEffectTask,
  triggerWebhookSideEffectProcessor,
} from "../_shared/webhook-side-effects.ts";
import {
  getBiteshipAuthorizationHeader,
  resolveBiteshipApiKeyFromRuntimeConfig,
  cancelBiteshipOrder,
} from "../_shared/biteship.ts";

type TransitionPayload = {
  to: string;
  waybill_number?: string;
  waybill_source?: "system" | "manual";
  waybill_override_reason?: string;
  notes?: string;
};

type OrderManagerRequest = {
  action: "transition_status" | "sync_tracking";
  orderId: string;
  payload?: TransitionPayload;
};

const BITESHIP_BASE_URL = "https://api.biteship.com/v1";
const BITESHIP_TRACKING_SYNC_TIMEOUT_MS = 4_000;
const BITESHIP_TRACKING_SYNC_MAX_ATTEMPTS = 2;
const BITESHIP_TRACKING_SYNC_RETRYABLE_STATUSES = new Set([
  408,
  425,
  429,
  500,
  502,
  503,
  504,
]);

const TRANSITION_RULES: Record<string, string[]> = {
  pending: ["processing", "cancelled"],
  processing: ["awaiting_shipment", "cancelled"],
  awaiting_shipment: ["shipped", "cancelled"],
  shipped: ["in_transit", "delivered"],
  in_transit: ["delivered"],
};

const PAYMENT_PROVIDER_CANCELLABLE_TRANSACTION_STATUSES = new Set([
  "pending",
  "authorize",
]);
const PAYMENT_PROVIDER_TERMINAL_CANCEL_STATUSES = new Set([
  "cancel",
  "deny",
  "expire",
  "failure",
]);

const TERMINAL_STATUSES = new Set(["delivered", "cancelled"]);
const STATUS_PROGRESS_ORDER: Record<string, number> = {
  pending: 0,
  processing: 1,
  awaiting_shipment: 2,
  shipped: 3,
  in_transit: 4,
  delivered: 5,
  cancelled: 5,
};

const MANUAL_WAYBILL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{4,63}$/;

function canTransition(from: string, to: string): boolean {
  return (TRANSITION_RULES[from] || []).includes(to);
}

function canApplySyncedStatus(currentStatus: string, nextStatus: string): boolean {
  if (TERMINAL_STATUSES.has(currentStatus)) {
    return false;
  }

  if (currentStatus === nextStatus) {
    return true;
  }

  const currentRank = STATUS_PROGRESS_ORDER[currentStatus];
  const nextRank = STATUS_PROGRESS_ORDER[nextStatus];

  if (currentRank === undefined || nextRank === undefined) {
    return false;
  }

  return nextRank >= currentRank;
}

function normalizeWaybillNumber(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim();
  if (!normalizedValue) {
    return null;
  }

  return MANUAL_WAYBILL_PATTERN.test(normalizedValue)
    ? normalizedValue
    : null;
}

class BiteshipTrackingSyncTimeoutError extends Error {
  constructor() {
    super("Biteship tracking sync timed out.");
    this.name = "BiteshipTrackingSyncTimeoutError";
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function isBiteshipTrackingSyncTimeoutError(
  error: unknown,
): error is BiteshipTrackingSyncTimeoutError {
  return error instanceof Error && error.name === "BiteshipTrackingSyncTimeoutError";
}

function isRetryableBiteshipTrackingStatus(status: number): boolean {
  return BITESHIP_TRACKING_SYNC_RETRYABLE_STATUSES.has(status);
}

function createBiteshipTrackingTimeoutResponse(): Response {
  return new Response(
    JSON.stringify({
      error: "BITESHIP_TRACKING_SYNC_TIMEOUT",
      message: "Biteship tracking sync timed out.",
      retryable: true,
    }),
    {
      status: 504,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}

function createBiteshipTrackingRejectedResponse(status: number): Response {
  return new Response(
    JSON.stringify({
      error: "BITESHIP_TRACKING_SYNC_REJECTED",
      message: "Biteship tracking sync was rejected by the provider.",
      retryable: false,
    }),
    {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}

async function fetchBiteshipTrackingResource(
  url: string,
  authHeader: string,
): Promise<Response> {
  let lastTimeoutError: BiteshipTrackingSyncTimeoutError | null = null;

  for (let attempt = 0; attempt < BITESHIP_TRACKING_SYNC_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          controller.abort();
          lastTimeoutError = new BiteshipTrackingSyncTimeoutError();
          reject(lastTimeoutError);
        }, BITESHIP_TRACKING_SYNC_TIMEOUT_MS);
      });
      const response = await Promise.race([
        fetch(url, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: authHeader,
          },
          signal: controller.signal,
        }),
        timeoutPromise,
      ]);

      if (
        response.ok ||
        !isRetryableBiteshipTrackingStatus(response.status) ||
        attempt === BITESHIP_TRACKING_SYNC_MAX_ATTEMPTS - 1
      ) {
        return response;
      }
    } catch (error: unknown) {
      const timeoutError = isAbortError(error)
        ? new BiteshipTrackingSyncTimeoutError()
        : error;

      if (isBiteshipTrackingSyncTimeoutError(timeoutError)) {
        lastTimeoutError = timeoutError;
      }

      if (attempt === BITESHIP_TRACKING_SYNC_MAX_ATTEMPTS - 1) {
        throw timeoutError;
      }
    } finally {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  throw lastTimeoutError ?? new BiteshipTrackingSyncTimeoutError();
}

function buildOrderStatusNotification(
  nextStatus: string,
  orderId: string,
): Pick<
  NotificationInsertPayload,
  "type" | "title" | "body" | "ctaRoute" | "data" | "priority" | "sourceEventKey"
> | null {
  if (nextStatus === "processing") {
    return {
      type: "order_processing",
      title: "Pesanan diproses",
      body: "Pesananmu sedang kami siapkan. Kami akan memberi kabar saat siap dikirim.",
      ctaRoute: ORDER_DETAIL_NOTIFICATION_ROUTE,
      data: {
        orderId,
      },
      priority: "normal",
      sourceEventKey: `order_processing:${orderId}`,
    };
  }

  if (nextStatus === "awaiting_shipment") {
    return {
      type: "order_awaiting_shipment",
      title: "Pesanan siap dikirim",
      body: "Pesananmu sudah siap dikirim. Kami sedang menyiapkan pengiriman ke alamat tujuan.",
      ctaRoute: ORDER_DETAIL_NOTIFICATION_ROUTE,
      data: {
        orderId,
      },
      priority: "normal",
      sourceEventKey: `order_awaiting_shipment:${orderId}`,
    };
  }

  if (nextStatus === "shipped") {
    return {
      type: "order_shipped",
      title: "Pesanan dikirim",
      body: "Pesananmu sudah dikirim. Kamu bisa melacak pengiriman dari aplikasi.",
      ctaRoute: TRACK_SHIPMENT_NOTIFICATION_ROUTE,
      data: {
        orderId,
        shipmentStage: "shipped",
      },
      priority: "high",
      sourceEventKey: `order_shipped:manual:${orderId}`,
    };
  }

  if (nextStatus === "in_transit") {
    return {
      type: "order_shipped",
      title: "Pesanan dalam perjalanan",
      body: "Pesananmu sedang dalam perjalanan. Pantau status terbarunya di aplikasi.",
      ctaRoute: TRACK_SHIPMENT_NOTIFICATION_ROUTE,
      data: {
        orderId,
        shipmentStage: "in_transit",
      },
      priority: "normal",
      sourceEventKey: `order_shipped:in_transit:${orderId}`,
    };
  }

  if (nextStatus === "delivered") {
    return {
      type: "order_delivered_action_required",
      title: "Pesanan sudah tiba",
      body: "Pesananmu sudah tiba. Konfirmasi penerimaan jika pesanan sudah sesuai.",
      ctaRoute: ORDER_DETAIL_NOTIFICATION_ROUTE,
      data: {
        orderId,
      },
      priority: "high",
      sourceEventKey: `order_delivered_action_required:${orderId}`,
    };
  }

  return null;
}

async function upsertShipmentPatch(
  adminClient: SupabaseAdminClient,
  orderId: string,
  values: Record<string, unknown>,
): Promise<void> {
  const { error } = await adminClient
    .from("shipments")
    .upsert(
      {
        order_id: orderId,
        ...values,
      },
      { onConflict: "order_id" },
    );

  if (error) {
    throw error;
  }
}

async function readShipmentSnapshot(
  adminClient: SupabaseAdminClient,
  orderId: string,
): Promise<ShipmentSnapshot> {
  const { data, error } = await adminClient
    .from("shipments")
    .select(
      "provider, status, biteship_order_id, biteship_tracking_id, waybill_number, waybill_source, waybill_overridden_by, waybill_override_reason, waybill_overridden_at, latest_biteship_status",
    )
    .eq("order_id", orderId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return toShipmentSnapshot(data);
}

async function ensureAwaitingShipmentSideEffectsQueued(
  adminClient: SupabaseAdminClient,
  orderId: string,
  biteshipOrderId: string | null | undefined,
): Promise<void> {
  if (biteshipOrderId) {
    return;
  }

  const existingTask = await getSideEffectTask(adminClient, orderId);
  await saveSideEffectTask(
    adminClient,
    orderId,
    existingTask?.needs_cart_cleanup ?? false,
    existingTask?.needs_stock ?? false,
    true,
    existingTask?.last_error ?? null,
    existingTask?.pending_biteship_order_id ?? null,
    existingTask?.pending_tracking_id ?? null,
    existingTask?.pending_waybill_number ?? null,
    null,
    existingTask?.last_error_code ?? null,
    existingTask?.failed_permanently_at ? true : false,
  );
  triggerWebhookSideEffectProcessor(orderId);
}

async function restoreOrderStockDeductions(
  adminClient: SupabaseAdminClient,
  orderId: string,
): Promise<void> {
  const { data: deductions, error: queryError } = await adminClient
    .from("order_item_stock_deductions")
    .select("product_id")
    .eq("order_id", orderId);

  if (queryError || !deductions || deductions.length === 0) {
    return;
  }

  for (const row of deductions as Array<{ product_id: string }>) {
    const { error: rpcError } = await adminClient.rpc(
      "reverse_order_item_stock_deduction",
      { p_order_id: orderId, p_product_id: row.product_id },
    );

    if (rpcError) {
      console.error(
        "[order-manager] Stock restoration failed for product:",
        { orderId, productId: row.product_id, code: "stock_restoration_failed" },
      );
    }
  }
}

async function buildCancellationPaymentUpdate(
  adminClient: SupabaseAdminClient,
  order: {
    id: string;
    status: string;
    payment_status: string;
    midtrans_order_id?: string | null;
    currency?: string | null;
  },
): Promise<Record<string, unknown>> {
  if (order.payment_status === "settlement") {
    return {};
  }

  if (!["pending", "authorize"].includes(order.payment_status)) {
    return {};
  }

  const midtransOrderId = order.midtrans_order_id?.trim();
  if (!midtransOrderId) {
    return { status: "cancel" };
  }

  const runtimeConfig = await resolveMidtransTransactionRuntimeConfig(
    adminClient,
    midtransOrderId,
  );

  let verifiedStatus: {
    transaction_status: string;
    currency?: string;
    transaction_id?: string;
    fraud_status?: string;
  };

  try {
    verifiedStatus = await verifyMidtransTransaction(
      midtransOrderId,
      runtimeConfig.serverKey,
      { isProduction: runtimeConfig.isProduction },
    );
  } catch (error) {
    if (error instanceof MidtransTransactionNotFoundError) {
      return { status: "cancel" };
    }
    throw error;
  }

  if (verifiedStatus.transaction_status === "settlement") {
    throw new Error("Paid Midtrans transactions must be refunded through a refund flow before marking payment as refunded");
  }

  if (PAYMENT_PROVIDER_CANCELLABLE_TRANSACTION_STATUSES.has(verifiedStatus.transaction_status)) {
    validateMidtransTransitionCurrency({
      orderId: midtransOrderId,
      expectedOrderCurrency: order.currency,
      verifiedCurrency: verifiedStatus.currency,
    });
    await cancelMidtransTransaction(midtransOrderId, runtimeConfig.serverKey, {
      isProduction: runtimeConfig.isProduction,
    });
    verifiedStatus = await verifyMidtransTransaction(
      midtransOrderId,
      runtimeConfig.serverKey,
      { isProduction: runtimeConfig.isProduction },
    );
  } else if (!PAYMENT_PROVIDER_TERMINAL_CANCEL_STATUSES.has(verifiedStatus.transaction_status)) {
    throw new Error(`Midtrans transaction status '${verifiedStatus.transaction_status}' is not cancellable`);
  }

  validateMidtransTransitionCurrency({
    orderId: midtransOrderId,
    expectedOrderCurrency: order.currency,
    verifiedCurrency: verifiedStatus.currency,
  });

  const { newPaymentStatus } = mapMidtransStatus(
    verifiedStatus.transaction_status,
    verifiedStatus.fraud_status || "",
    order.payment_status as "pending" | "authorize",
    order.status,
  );

  return {
    status: newPaymentStatus,
    midtrans_transaction_id: verifiedStatus.transaction_id || null,
  };
}

async function restoreMutationState(
  adminClient: SupabaseAdminClient,
  params: {
    orderId: string;
    rollbackTimestamp: string;
    originalOrderStatus: string;
    originalPaymentStatus: string | null;
    originalShipment: ShipmentSnapshot;
    operationTimestamp: string;
    revertPayment: boolean;
    revertShipment: boolean;
  },
): Promise<void> {
  const {
    orderId,
    rollbackTimestamp,
    originalOrderStatus,
    originalPaymentStatus,
    originalShipment,
    operationTimestamp,
    revertPayment,
    revertShipment,
  } = params;

  const { error: orderRollbackError } = await adminClient
    .from("orders")
    .update({
      status: originalOrderStatus,
      updated_at: rollbackTimestamp,
    })
    .eq("id", orderId);

  if (orderRollbackError) {
    throw orderRollbackError;
  }

  if (revertPayment && originalPaymentStatus) {
    const { error: paymentRollbackError } = await adminClient
      .from("payments")
      .update({
        status: originalPaymentStatus,
        updated_at: rollbackTimestamp,
      })
      .eq("order_id", orderId);

    if (paymentRollbackError) {
      throw paymentRollbackError;
    }
  }

  if (!revertShipment) {
    return;
  }

  const shipmentRestorePayload = buildShipmentRestorePayload(
    originalShipment,
    rollbackTimestamp,
  );

  if (shipmentRestorePayload) {
    await upsertShipmentPatch(adminClient, orderId, shipmentRestorePayload);
    return;
  }

  const { error: shipmentDeleteError } = await adminClient
    .from("shipments")
    .delete()
    .eq("order_id", orderId)
    .eq("updated_at", operationTimestamp);

  if (shipmentDeleteError) {
    throw shipmentDeleteError;
  }
}

type SupabaseAdminClient = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (tableName: string) => any;
  rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<{
    data: unknown;
    error: { message?: string } | null;
  }>;
};

export function createOrderManagerHandler(dependencies: {
  requireAdmin: (req: Request) => Promise<{ userId: string }>;
  getAdminClient: () => SupabaseAdminClient;
}): (req: Request) => Promise<Response> {
  return async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { userId } = await dependencies.requireAdmin(req);
    const body: OrderManagerRequest = await req.json();

    if (!body.action || !body.orderId) {
      return new Response(
        JSON.stringify({ error: "action and orderId are required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const adminClient = dependencies.getAdminClient();
    const { data: order, error: orderError } = await adminClient
      .from("order_read_model")
      .select(
        "id, user_id, status, payment_status, midtrans_order_id, waybill_number, waybill_source, biteship_order_id, biteship_tracking_id",
      )
      .eq("id", body.orderId)
      .single();

    if (orderError || !order) {
      return new Response(JSON.stringify({ error: "Order not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (body.action === "transition_status") {
      const to = body.payload?.to;
      const orderStatusNotification = to
        ? buildOrderStatusNotification(to, body.orderId)
        : null;

      if (!to) {
        return new Response(
          JSON.stringify({ error: "payload.to is required" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      if (
        !canApplyOrderStatusForPaymentStatus({
          targetStatus: to,
          paymentStatus: order.payment_status,
        })
      ) {
        return new Response(
          JSON.stringify({
            error: "PAYMENT_NOT_SETTLED",
            message: "Order fulfillment requires settled payment",
          }),
          {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      if (order.status === to && orderStatusNotification) {
        if (to === "awaiting_shipment") {
          try {
            await ensureAwaitingShipmentSideEffectsQueued(
              adminClient,
              body.orderId,
              order.biteship_order_id,
            );
          } catch (queueError) {
            console.error("[order-manager] Failed to enqueue biteship side effect:", queueError);
          }
        }

        await insertNotificationOrThrow(
          adminClient,
          {
            userId: order.user_id,
            type: orderStatusNotification.type,
            title: orderStatusNotification.title,
            body: orderStatusNotification.body,
            ctaRoute: orderStatusNotification.ctaRoute,
            data: orderStatusNotification.data,
            priority: orderStatusNotification.priority,
            sourceEventKey: orderStatusNotification.sourceEventKey,
          },
          "[order-manager]",
        );

        return new Response(
          JSON.stringify({
            success: true,
            data: {
              id: order.id,
              status: order.status,
              notification_backfilled: true,
            },
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      if (!canTransition(order.status, to)) {
        return new Response(
          JSON.stringify({
            error: "INVALID_TRANSITION",
            message: `Cannot transition order from '${order.status}' to '${to}'`,
          }),
          {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const operationTimestamp = new Date().toISOString();
      const originalShipment = await readShipmentSnapshot(adminClient, body.orderId);
      const nextWaybill =
        body.payload?.waybill_number?.trim() || order.waybill_number || null;
      const effectiveWaybillSource =
        body.payload?.waybill_source ?? order.waybill_source ?? null;

      if (
        body.payload?.waybill_source === "manual" &&
        body.payload?.waybill_number?.trim() &&
        !normalizeWaybillNumber(body.payload.waybill_number)
      ) {
        return new Response(
          JSON.stringify({
            error:
              "Manual waybill_number must contain 5-64 characters using only letters, numbers, or hyphens",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      if (
        requiresBiteshipSyncForProviderStatusTransition({
          targetStatus: to,
          biteshipOrderId: order.biteship_order_id,
          waybillSource: effectiveWaybillSource,
        })
      ) {
        const targetLabel =
          to === "shipped"
            ? "enter shipped status unless you are applying a manual waybill override"
            : `set ${to} manually`;
        return new Response(
          JSON.stringify({
            error: `Biteship-managed shipments must use sync_tracking to ${targetLabel}`,
          }),
          {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      if (to === "shipped" && !nextWaybill) {
        return new Response(
          JSON.stringify({
            error: "waybill_number is required for shipped status",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      // Build update payload with optional waybill override metadata
      const updatePayload: Record<string, unknown> = {
        status: to,
        updated_at: operationTimestamp,
      };

      const paymentUpdatePayload: Record<string, unknown> = {};
      const shipmentUpdatePayload: Record<string, unknown> = {
        status:
          to === "awaiting_shipment" ||
          to === "shipped" ||
          to === "in_transit" ||
          to === "delivered" ||
          to === "cancelled"
            ? to
            : undefined,
        waybill_number: nextWaybill,
        updated_at: operationTimestamp,
      };

      if (to === "cancelled") {
        try {
          const { data: payment } = await adminClient.from("payments").select("currency").eq("order_id", order.id).single();
          const orderWithCurrency = { ...order, currency: payment?.currency || null };
          Object.assign(paymentUpdatePayload, await buildCancellationPaymentUpdate(adminClient, orderWithCurrency));
        } catch (error) {
          if (error instanceof MidtransCurrencyValidationError) {
            return new Response(JSON.stringify({ error: error.message }), {
              status: 409,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          if (error instanceof MidtransTransactionNotFoundError) {
            // Already handled by buildCancellationPaymentUpdate but just in case
            Object.assign(paymentUpdatePayload, { status: "cancel" });
          } else {
            throw error;
          }
        }
      }

      // If admin is providing a manual waybill (override), record audit metadata
      if (
        body.payload?.waybill_source === "manual" &&
        body.payload?.waybill_number?.trim()
      ) {
        if (!body.payload?.waybill_override_reason?.trim() && order.biteship_order_id) {
          return new Response(
            JSON.stringify({
              error:
                "waybill_override_reason is required when overriding a Biteship-generated shipment",
            }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }
        shipmentUpdatePayload.waybill_source = "manual";
        shipmentUpdatePayload.waybill_overridden_by = userId;
        shipmentUpdatePayload.waybill_override_reason =
          body.payload.waybill_override_reason || null;
        shipmentUpdatePayload.waybill_overridden_at = new Date().toISOString();
      } else if (
        body.payload?.waybill_number?.trim() &&
        !order.biteship_order_id
      ) {
        // No Biteship — still manual but not an override
        shipmentUpdatePayload.waybill_source = "manual";
      }

      let paymentUpdated = false;
      let shipmentUpdated = false;

      const updated = await runMutationWithRollback({
        apply: async () => {
          const { data: updatedOrder, error: updateError } = await adminClient
            .from("orders")
            .update(updatePayload)
            .eq("id", body.orderId)
            .eq("status", order.status)
            .select("id, status, updated_at")
            .single();

          if (updateError) {
            throw updateError;
          }

          if (Object.keys(paymentUpdatePayload).length > 0) {
            const { error: paymentUpdateError } = await adminClient
              .from("payments")
              .update({
                ...paymentUpdatePayload,
                updated_at: operationTimestamp,
              })
              .eq("order_id", body.orderId);

            if (paymentUpdateError) {
              throw paymentUpdateError;
            }

            paymentUpdated = true;
          }

          if (
            nextWaybill ||
            shipmentUpdatePayload.status ||
            shipmentUpdatePayload.waybill_source
          ) {
            await upsertShipmentPatch(adminClient, body.orderId, shipmentUpdatePayload);
            shipmentUpdated = true;
          }

          return updatedOrder;
        },
        shouldRollback: (updatedOrder) => Boolean(updatedOrder),
        rollback: () => restoreMutationState(adminClient, {
          orderId: body.orderId,
          rollbackTimestamp: new Date().toISOString(),
          originalOrderStatus: order.status,
          originalPaymentStatus: order.payment_status ?? null,
          originalShipment,
          operationTimestamp,
          revertPayment: paymentUpdated,
          revertShipment: shipmentUpdated,
        }),
        onRollbackError: (rollbackError, mutationError) => {
          console.error("[order-manager] Failed to rollback transition mutation:", {
            mutationError: String(mutationError),
            rollbackError: String(rollbackError),
            orderId: body.orderId,
          });
        },
      });

      const { error: activityError } = await adminClient
        .from("order_activities")
        .insert({
          order_id: body.orderId,
          action: "status_update",
          old_status: order.status,
          new_status: to,
          actor_id: userId,
          actor_type: "admin",
          metadata: {
            notes: body.payload?.notes ?? null,
            waybill: nextWaybill,
            waybill_source:
              shipmentUpdatePayload.waybill_source ?? order.waybill_source ?? null,
            override_reason: body.payload?.waybill_override_reason ?? null,
          },
        });

      if (activityError) {
        console.error("[order-manager] Failed to log activity:", activityError);
        // Don't throw - order already updated, just log the error
      }

      // Restore stock deductions when cancelling a post-settlement order
      if (to === "cancelled") {
        try {
          await restoreOrderStockDeductions(adminClient, body.orderId);
        } catch (stockRestoreError) {
          console.error("[order-manager] Failed to restore stock on cancellation:", stockRestoreError);
          // Non-blocking: order is already cancelled, stock can be fixed manually
        }

        if (order.biteship_order_id) {
          try {
            const biteshipApiKey = await resolveBiteshipApiKeyFromRuntimeConfig(adminClient);
            await cancelBiteshipOrder(order.biteship_order_id, biteshipApiKey, "Cancelled by Admin");
          } catch (biteshipCancelError) {
            console.error("[order-manager] Failed to cancel biteship order on cancellation:", biteshipCancelError);
            // Non-blocking: order is already cancelled, biteship cancellation can be done manually if needed
          }
        }
      }

      // Enqueue courier fulfillment if moving to awaiting_shipment
      if (to === "awaiting_shipment" && !order.biteship_order_id) {
        try {
          await ensureAwaitingShipmentSideEffectsQueued(
            adminClient,
            body.orderId,
            order.biteship_order_id,
          );
        } catch (queueError) {
          console.error("[order-manager] Failed to enqueue biteship side effect:", queueError);
          // Non-blocking: we continue since DB status already changed
        }
      }

      if (orderStatusNotification) {
        await insertNotificationOrThrow(
          adminClient,
          {
            userId: order.user_id,
            type: orderStatusNotification.type,
            title: orderStatusNotification.title,
            body: orderStatusNotification.body,
            ctaRoute: orderStatusNotification.ctaRoute,
            data: orderStatusNotification.data,
            priority: orderStatusNotification.priority,
            sourceEventKey: orderStatusNotification.sourceEventKey,
          },
          "[order-manager]",
        );
      }

      return new Response(JSON.stringify({ success: true, data: updated }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (body.action === "sync_tracking") {
      if (order.payment_status !== "settlement") {
        return new Response(
          JSON.stringify({
            error: "PAYMENT_NOT_SETTLED",
            message: "Tracking sync requires settled payment",
          }),
          {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      if (!order.biteship_order_id) {
        return new Response(
          JSON.stringify({ error: "Order has no biteship_order_id" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      let authHeader: string;
      try {
        const biteshipKey = await resolveBiteshipApiKeyFromRuntimeConfig(adminClient);
        authHeader = getBiteshipAuthorizationHeader(biteshipKey);
      } catch (configError: unknown) {
        if (configError instanceof Error && configError.name === "BiteshipRuntimeConfigError") {
          return new Response(
            JSON.stringify({ error: "Biteship runtime config unavailable" }),
            {
              status: 503,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }

        throw configError;
      }
      let trackingId = order.biteship_tracking_id ?? null;
      let waybill = order.waybill_number ?? null;
      let orderStatusFromBiteship: string | null = null;
      let trackingStatusFromBiteship: string | null = null;

      if (!trackingId || !waybill) {
        let orderResp: Response;
        try {
          orderResp = await fetchBiteshipTrackingResource(
            `${BITESHIP_BASE_URL}/orders/${order.biteship_order_id}`,
            authHeader,
          );
        } catch (trackingSyncError: unknown) {
          if (isBiteshipTrackingSyncTimeoutError(trackingSyncError)) {
            return createBiteshipTrackingTimeoutResponse();
          }

          throw trackingSyncError;
        }

        if (!orderResp.ok) {
          return createBiteshipTrackingRejectedResponse(orderResp.status);
        }

        const biteshipOrderData = (await orderResp.json()) as Record<
          string,
          unknown
        >;
        
        orderStatusFromBiteship = String(biteshipOrderData.status || "");
        
        const recoveredTrackingId = String(
          ((biteshipOrderData.courier as Record<string, unknown> | undefined)
            ?.tracking_id as string | undefined) || "",
        ).trim();

        const recoveredWaybill = normalizeWaybillNumber(
          ((biteshipOrderData.courier as Record<string, unknown> | undefined)
            ?.waybill_id as string | undefined) || "",
        );

        const shouldPatch = recoveredTrackingId !== trackingId || recoveredWaybill !== waybill;

        trackingId = recoveredTrackingId || trackingId;
        waybill = recoveredWaybill || waybill;

        if (shouldPatch) {
          await upsertShipmentPatch(adminClient, body.orderId, {
            provider: "biteship",
            biteship_order_id: order.biteship_order_id,
            biteship_tracking_id: trackingId,
            waybill_number: waybill || null,
            waybill_source: waybill ? "system" : order.waybill_source,
            updated_at: new Date().toISOString(),
          });
        }
      }

      let finalTrackingStatus = orderStatusFromBiteship;

      if (trackingId) {
        let trackingResp: Response;
        try {
          trackingResp = await fetchBiteshipTrackingResource(
            `${BITESHIP_BASE_URL}/trackings/${trackingId}`,
            authHeader,
          );
        } catch (trackingSyncError: unknown) {
          if (isBiteshipTrackingSyncTimeoutError(trackingSyncError)) {
            return createBiteshipTrackingTimeoutResponse();
          }

          throw trackingSyncError;
        }

        if (!trackingResp.ok) {
          return createBiteshipTrackingRejectedResponse(trackingResp.status);
        }

        const trackingData = (await trackingResp.json()) as Record<
          string,
          unknown
        >;
        trackingStatusFromBiteship = String(trackingData.status || "");
        
        const recoveredWaybillFromTracking = String(trackingData.waybill || trackingData.waybill_id || "") || null;
        if (recoveredWaybillFromTracking) {
            waybill = normalizeWaybillNumber(recoveredWaybillFromTracking) || waybill;
        }
        
        finalTrackingStatus = trackingStatusFromBiteship || orderStatusFromBiteship;
      }
      
      if (!finalTrackingStatus) {
         return new Response(
            JSON.stringify({
              error: "Biteship order does not expose a tracking_id or status yet",
            }),
            {
              status: 409,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
      }

      const statusResolution = resolveBiteshipStatus(finalTrackingStatus, order.status);
      const nextStatus = statusResolution.nextStatus;

      if (TERMINAL_STATUSES.has(order.status)) {
        return new Response(
          JSON.stringify({
            error: "INVALID_SYNC_STATE",
            message:
              "Tracking sync is not allowed for delivered or cancelled orders",
          }),
          {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      if (!canApplySyncedStatus(order.status, nextStatus)) {
        return new Response(
          JSON.stringify({
            error: "INVALID_SYNC_TRANSITION",
            message: `Ignoring Biteship status ${finalTrackingStatus} because it would move the order backward from ${order.status} to ${nextStatus}`,
          }),
          {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      // Enforce waybill requirement for shipped status
      if (nextStatus === "shipped" && !waybill && !order.waybill_number) {
        return new Response(
          JSON.stringify({
            error: "Cannot set status to shipped without a waybill number",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const syncWaybill = waybill || order.waybill_number || null;
      const syncWaybillSource = waybill
        ? "system"
        : (order.waybill_source ?? null);

      const operationTimestamp = new Date().toISOString();
      const originalShipment = await readShipmentSnapshot(adminClient, body.orderId);
      let shipmentUpdated = false;

      const updated = await runMutationWithRollback({
        apply: async () => {
          const { data: updatedOrder, error: updateError } = await adminClient
            .from("orders")
            .update({
              status: nextStatus,
              updated_at: operationTimestamp,
            })
            .eq("id", body.orderId)
            .eq("status", order.status)
            .select(
              "id, status, updated_at",
            )
            .single();

          if (updateError) {
            throw updateError;
          }

          await upsertShipmentPatch(adminClient, body.orderId, {
            provider: "biteship",
            status: nextStatus,
            biteship_order_id: order.biteship_order_id,
            biteship_tracking_id: trackingId,
            waybill_number: syncWaybill,
            waybill_source: syncWaybillSource,
            latest_biteship_status: finalTrackingStatus,
            updated_at: operationTimestamp,
          });
          shipmentUpdated = true;

          return updatedOrder;
        },
        shouldRollback: (updatedOrder) => Boolean(updatedOrder),
        rollback: () => restoreMutationState(adminClient, {
          orderId: body.orderId,
          rollbackTimestamp: new Date().toISOString(),
          originalOrderStatus: order.status,
          originalPaymentStatus: order.payment_status ?? null,
          originalShipment,
          operationTimestamp,
          revertPayment: false,
          revertShipment: shipmentUpdated,
        }),
        onRollbackError: (rollbackError, mutationError) => {
          console.error("[order-manager] Failed to rollback sync mutation:", {
            mutationError: String(mutationError),
            rollbackError: String(rollbackError),
            orderId: body.orderId,
          });
        },
      });

      const { error: syncActivityError } = await adminClient
        .from("order_activities")
        .insert({
          order_id: body.orderId,
          action: "sync_tracking",
          old_status: order.status,
          new_status: nextStatus,
          actor_id: userId,
          actor_type: "admin",
          metadata: {
            biteship_order_id: order.biteship_order_id,
            tracking_id: trackingId,
            biteship_status: finalTrackingStatus,
            biteship_status_mapped: statusResolution.mapped,
            biteship_exception_status: statusResolution.exception?.status ?? null,
            biteship_exception_alert_type: statusResolution.exception?.alertType ?? null,
            biteship_exception_message_key: statusResolution.exception?.messageKey ?? null,
            waybill: syncWaybill,
            waybill_source: syncWaybillSource,
          },
        });

      if (syncActivityError) {
        console.error(
          "[order-manager] Failed to log sync activity:",
          syncActivityError,
        );
      }

      const shipmentNotification = buildOrderStatusNotification(nextStatus, body.orderId);

      if (shipmentNotification && nextStatus !== "shipped") {
        await insertNotificationOrThrow(
          adminClient,
          {
            userId: order.user_id,
            type: shipmentNotification.type,
            title: shipmentNotification.title,
            body: shipmentNotification.body,
            ctaRoute: shipmentNotification.ctaRoute,
            data: shipmentNotification.data,
            priority: shipmentNotification.priority,
            sourceEventKey: shipmentNotification.sourceEventKey,
          },
          "[order-manager]",
        );
      }

      return new Response(JSON.stringify({ success: true, data: updated }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";

    // Determine status and client-facing error message
    // Log full error internally but only return generic message for 500s
    const isForbidden = message.startsWith("Forbidden");
    const isUnauthorized = message.startsWith("Unauthorized");
    const status = isForbidden ? 403 : isUnauthorized ? 401 : 500;

    // Log full error for debugging (includes stack trace details)
    console.error("[order-manager] Internal error:", {
      message,
      error: String(error),
    });

    // Return safe error message to client - don't leak internal details for 500 errors
    const clientError = isForbidden
      ? "Forbidden: Admin role required"
      : isUnauthorized
        ? "Unauthorized: Invalid authentication"
        : "Internal server error";

    return new Response(JSON.stringify({ error: clientError }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  };
}
