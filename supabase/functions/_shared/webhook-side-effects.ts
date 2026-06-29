import {
  createBiteshipOrder,
  ensureBiteshipOrderConfigSnapshot,
  getStandardBiteshipShipmentOriginAreaIdFromSnapshot,
  isBiteshipConfigSnapshotError,
  persistBiteshipShipment,
  readBiteshipOrderConfigSnapshot,
  resolveBiteshipApiKeyFromRuntimeConfig,
  type BiteshipConfigSnapshotErrorCode,
  type BiteshipOrderConfigSnapshot,
} from "./biteship.ts";
import { fetchOrderShippingAddress } from "./biteship-order-helpers.ts";
import { getOrderAggregateById } from "./order-aggregate.ts";
import {
  deriveSettlementSideEffectFlags,
} from "./order-flow-rules.ts";
import { getSupabaseAdminClient } from "./supabase.ts";
import type { BiteshipOrderResponse, Order, OrderItem } from "./types.ts";

declare const Deno: {
  env: {
    get: (key: string) => string | undefined;
  };
};

const SIDE_EFFECT_LEASE_MS = 10 * 60 * 1000;
export const WEBHOOK_BITESHIP_CALL_TIMEOUT_MS = 4_000;
export const WEBHOOK_BITESHIP_MAX_ATTEMPTS = 2;
export const WEBHOOK_BITESHIP_RETRY_DELAY_MS = 250;
export const DEFAULT_PROCESSOR_BATCH_SIZE = 3;
export const WEBHOOK_SIDE_EFFECTS_BATCH_BUDGET_MS = 30_000;
export const WEBHOOK_SIDE_EFFECTS_EDGE_RUNTIME_RISK_MS = 50_000;
export const WEBHOOK_BITESHIP_WORST_CASE_SINGLE_TASK_MS =
  WEBHOOK_BITESHIP_CALL_TIMEOUT_MS * WEBHOOK_BITESHIP_MAX_ATTEMPTS +
  WEBHOOK_BITESHIP_RETRY_DELAY_MS * (WEBHOOK_BITESHIP_MAX_ATTEMPTS - 1);
export const WEBHOOK_BITESHIP_WORST_CASE_BATCH_MS =
  WEBHOOK_BITESHIP_WORST_CASE_SINGLE_TASK_MS * DEFAULT_PROCESSOR_BATCH_SIZE;
const MAX_RETRY_DELAY_MS = 60 * 60 * 1000;

export interface SideEffectTask {
  needs_cart_cleanup: boolean;
  needs_stock: boolean;
  needs_biteship: boolean;
  retry_count: number;
  updated_at: string;
  last_error: string | null;
  lease_owner: string | null;
  lease_until: string | null;
  next_retry_at: string | null;
  last_attempted_at: string | null;
  last_error_code: string | null;
  failed_permanently_at: string | null;
  pending_biteship_order_id: string | null;
  pending_tracking_id: string | null;
  pending_waybill_number: string | null;
}

interface SideEffectTaskOrderRow {
  order_id: string | null;
}

interface OrderCartItemProvenanceRow {
  source_cart_item_id: string | null;
}

interface SelectedCartItemOwnershipRow {
  id: string | null;
  carts?: { user_id?: string | null } | Array<{ user_id?: string | null }> | null;
}

interface SideEffectErrorClassification {
  code: string;
  permanent: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function classifySideEffectError(
  error: unknown,
): SideEffectErrorClassification {
  if (isBiteshipConfigSnapshotError(error)) {
    return {
      code: error.code,
      permanent: false,
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  const normalizedMessage = message.toLowerCase();

  const permanentPatterns = [
    "missing",
    "required",
    "disabled courier service",
    "not configured",
    "invalid",
    "not found while processing fulfillment side effects",
    "does not expose a tracking_id",
  ];

  const permanent = permanentPatterns.some((pattern) =>
    normalizedMessage.includes(pattern),
  );

  return {
    code: permanent ? "permanent_validation_failure" : "transient_failure",
    permanent,
  };
}

function getBiteshipSnapshotErrorDetails(error: unknown): {
  message: string;
  code: BiteshipConfigSnapshotErrorCode;
} {
  if (isBiteshipConfigSnapshotError(error)) {
    return {
      message: error.message,
      code: error.code,
    };
  }

  const message = error instanceof Error
    ? error.message
    : "Biteship config snapshot unavailable";
  const normalizedMessage = message.toLowerCase();

  if (normalizedMessage.includes("snapshot") && normalizedMessage.includes("missing")) {
    return {
      message,
      code: "biteship_snapshot_missing",
    };
  }

  if (
    normalizedMessage.includes("snapshot") &&
    (normalizedMessage.includes("incomplete") || normalizedMessage.includes("partial"))
  ) {
    return {
      message,
      code: "biteship_snapshot_incomplete",
    };
  }

  return {
    message,
    code: "biteship_snapshot_create_failed",
  };
}

function isSafeCartCleanupValidationMessage(message: string): boolean {
  return (
    message.startsWith("Missing user for order ") &&
      message.includes(" Cart cleanup requires order ownership validation.")
  ) ||
    (
      message.startsWith("Missing selected cart item provenance for order ") &&
      message.includes(" Cart cleanup requires ")
    ) ||
    (
      message.startsWith("Invalid selected cart item provenance for order ") &&
      message.includes(" does not belong to the order user.")
    );
}

function isSafeCartCleanupValidationError(
  error: unknown,
  classification: SideEffectErrorClassification,
): error is Error {
  return classification.permanent &&
    error instanceof Error &&
    isSafeCartCleanupValidationMessage(error.message);
}

function getSafeCartCleanupErrorMessage(
  error: unknown,
  classification: SideEffectErrorClassification,
): string {
  if (isSafeCartCleanupValidationError(error, classification)) {
    return error.message;
  }

  return "cart_cleanup_failed";
}

function getNextRetryAtIso(retryCount: number): string {
  const safeRetryCount = Math.max(1, retryCount);
  const delayMs = Math.min(
    60_000 * 2 ** Math.max(0, safeRetryCount - 1),
    MAX_RETRY_DELAY_MS,
  );

  return new Date(Date.now() + delayMs).toISOString();
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
  onTimeout?: () => void,
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        onTimeout?.();
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

async function createBiteshipOrderWithBudget(
  order: Order,
  biteshipKey: string,
  biteshipSnapshot: BiteshipOrderConfigSnapshot,
): Promise<BiteshipOrderResponse> {
  const controller = new AbortController();
  return await withTimeout(
    createBiteshipOrder(order, biteshipKey, biteshipSnapshot, {
      signal: controller.signal,
    }),
    WEBHOOK_BITESHIP_CALL_TIMEOUT_MS,
    "Biteship request timeout",
    () => controller.abort(),
  );
}

function getRequiredOrderItemQuantity(
  item: OrderItem,
  orderId: string,
): number {
  const parsedQuantity = Number(item.quantity);

  if (!Number.isInteger(parsedQuantity) || parsedQuantity <= 0) {
    throw new Error(
      `Missing quantity for product ${item.product_id ?? "unknown"} in order ${orderId}. Stock deduction requires a quantity greater than 0.`,
    );
  }

  return parsedQuantity;
}

export async function getSideEffectTask(
  adminClient: ReturnType<typeof getSupabaseAdminClient>,
  orderId: string,
): Promise<SideEffectTask | null> {
  const { data, error } = await adminClient
    .from("webhook_side_effect_tasks")
    .select(
      "needs_cart_cleanup, needs_stock, needs_biteship, retry_count, updated_at, last_error, lease_owner, lease_until, next_retry_at, last_attempted_at, last_error_code, failed_permanently_at, pending_biteship_order_id, pending_tracking_id, pending_waybill_number",
    )
    .eq("order_id", orderId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data as SideEffectTask;
}

export async function saveSideEffectTask(
  adminClient: ReturnType<typeof getSupabaseAdminClient>,
  orderId: string,
  needsCartCleanup: boolean,
  needsStock: boolean,
  needsBiteship: boolean,
  lastError: string | null,
  pendingBiteshipOrderId: string | null = null,
  pendingTrackingId: string | null = null,
  pendingWaybillNumber: string | null = null,
  leaseOwner: string | null = null,
  lastErrorCode: string | null = null,
  permanentFailure = false,
): Promise<void> {
  if (!needsCartCleanup && !needsStock && !needsBiteship) {
    let deleteQuery = adminClient
      .from("webhook_side_effect_tasks")
      .delete()
      .eq("order_id", orderId);

    if (leaseOwner) {
      deleteQuery = deleteQuery.eq("lease_owner", leaseOwner);
    }

    const { error } = await deleteQuery;
    if (error) {
      throw new Error(`Failed to delete side effect task: ${error.message}`);
    }
    return;
  }

  const existingTask = await getSideEffectTask(adminClient, orderId);
  const nextRetryCount = existingTask?.retry_count ?? 0;
  const nowIso = new Date().toISOString();
  const nextRetryAt =
    permanentFailure || !lastError ? null : getNextRetryAtIso(nextRetryCount);

  const taskPayload = {
    order_id: orderId,
    needs_cart_cleanup: needsCartCleanup,
    needs_stock: needsStock,
    needs_biteship: needsBiteship,
    last_error: lastError,
    last_error_code: lastErrorCode,
    updated_at: nowIso,
    retry_count: nextRetryCount,
    claimed_at: null,
    lease_owner: null,
    lease_until: null,
    last_attempted_at: existingTask?.last_attempted_at ?? nowIso,
    next_retry_at: nextRetryAt,
    failed_permanently_at: permanentFailure ? nowIso : null,
    pending_biteship_order_id: pendingBiteshipOrderId,
    pending_tracking_id: pendingTrackingId,
    pending_waybill_number: pendingWaybillNumber,
  };

  if (!existingTask || !leaseOwner) {
    const { error } = await adminClient
      .from("webhook_side_effect_tasks")
      .upsert(taskPayload, { onConflict: "order_id" });

    if (error) {
      throw new Error(`Failed to upsert side effect task: ${error.message}`);
    }
    return;
  }

  const { error } = await adminClient
    .from("webhook_side_effect_tasks")
    .update(taskPayload)
    .eq("order_id", orderId)
    .eq("lease_owner", leaseOwner);

  if (error) {
    throw new Error(`Failed to save side effect task: ${error.message}`);
  }
}

type EnsureSettlementSideEffectsQueuedOptions = {
  transitionApplied?: boolean;
};

function isIncompleteSideEffectTask(task: SideEffectTask | null): boolean {
  return Boolean(
    task &&
      !task.failed_permanently_at &&
      (task.needs_cart_cleanup ||
        task.needs_stock ||
        task.needs_biteship ||
        task.pending_biteship_order_id),
  );
}

export async function ensureSettlementSideEffectsQueued(
  adminClient: ReturnType<typeof getSupabaseAdminClient>,
  orderId: string,
  paymentStatus: string,
  options: EnsureSettlementSideEffectsQueuedOptions = {},
): Promise<boolean> {
  const existingSideEffectTask = await getSideEffectTask(adminClient, orderId);
  const transitionApplied = options.transitionApplied ?? true;

  if (!transitionApplied) {
    return paymentStatus === "settlement" &&
      isIncompleteSideEffectTask(existingSideEffectTask);
  }

  const order = await getOrderAggregateById(adminClient, orderId);
  const nextSideEffects = order
    ? deriveSettlementSideEffectFlags({
        paymentStatus,
        status: order.status,
        biteshipOrderId: order.biteship_order_id,
        courierCode: order.courier_code,
        existingNeedsBiteship: existingSideEffectTask?.needs_biteship,
        pendingBiteshipOrderId: existingSideEffectTask?.pending_biteship_order_id,
      })
    : null;

  if (!order || !nextSideEffects) {
    return false;
  }

  let snapshotError: { message: string; code: BiteshipConfigSnapshotErrorCode } | null = null;
  if (nextSideEffects.needsBiteship) {
    try {
      await ensureBiteshipOrderConfigSnapshot(adminClient, order);
    } catch (error) {
      snapshotError = getBiteshipSnapshotErrorDetails(error);
    }
  }

  if (!existingSideEffectTask) {
    await saveSideEffectTask(
      adminClient,
      orderId,
      nextSideEffects.needsCartCleanup,
      nextSideEffects.needsStock,
      nextSideEffects.needsBiteship,
      snapshotError?.message ?? null,
      null,
      null,
      null,
      null,
      snapshotError?.code ?? null,
      false,
    );
  } else {
    await saveSideEffectTask(
      adminClient,
      orderId,
      nextSideEffects.needsCartCleanup,
      nextSideEffects.needsStock,
      nextSideEffects.needsBiteship,
      snapshotError?.message ?? null,
      existingSideEffectTask.pending_biteship_order_id ?? null,
      existingSideEffectTask.pending_tracking_id ?? null,
      existingSideEffectTask.pending_waybill_number ?? null,
      null,
      snapshotError?.code ?? null,
      false,
    );
  }

  return true;
}

export async function claimSideEffectTask(
  adminClient: ReturnType<typeof getSupabaseAdminClient>,
  orderId: string,
  currentTask: SideEffectTask,
): Promise<string | null> {
  if (
    currentTask.failed_permanently_at ||
    (currentTask.next_retry_at && Date.parse(currentTask.next_retry_at) > Date.now()) ||
    currentTask.lease_until &&
    Date.parse(currentTask.lease_until) > Date.now()
  ) {
    return null;
  }

  const nowIso = new Date().toISOString();
  const leaseUntilIso = new Date(
    Date.now() + SIDE_EFFECT_LEASE_MS,
  ).toISOString();
  const leaseOwner = crypto.randomUUID();

  const { data, error } = await adminClient
    .from("webhook_side_effect_tasks")
    .update({
      retry_count: currentTask.retry_count + 1,
      updated_at: nowIso,
      claimed_at: nowIso,
      lease_owner: leaseOwner,
      lease_until: leaseUntilIso,
      last_attempted_at: nowIso,
    })
    .eq("order_id", orderId)
    .eq("updated_at", currentTask.updated_at)
    .select("order_id, lease_owner")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to claim side effect task: ${error.message}`);
  }

  return data?.lease_owner ?? null;
}

export async function renewSideEffectTaskLease(
  adminClient: ReturnType<typeof getSupabaseAdminClient>,
  orderId: string,
  leaseOwner: string,
): Promise<void> {
  const nowIso = new Date().toISOString();
  const leaseUntilIso = new Date(
    Date.now() + SIDE_EFFECT_LEASE_MS,
  ).toISOString();

  const { error } = await adminClient
    .from("webhook_side_effect_tasks")
    .update({
      claimed_at: nowIso,
      lease_until: leaseUntilIso,
      updated_at: nowIso,
    })
    .eq("order_id", orderId)
    .eq("lease_owner", leaseOwner);

  if (error) {
    throw new Error(`Failed to renew side effect lease: ${error.message}`);
  }
}

async function persistPendingBiteshipResult(
  adminClient: ReturnType<typeof getSupabaseAdminClient>,
  orderId: string,
  biteshipOrderId: string,
  trackingId: string | null,
  waybillNumber: string | null,
  leaseOwner: string,
): Promise<void> {
  const nowIso = new Date().toISOString();
  const leaseUntilIso = new Date(
    Date.now() + SIDE_EFFECT_LEASE_MS,
  ).toISOString();

  const { error } = await adminClient
    .from("webhook_side_effect_tasks")
    .update({
      pending_biteship_order_id: biteshipOrderId,
      pending_tracking_id: trackingId,
      pending_waybill_number: waybillNumber,
      updated_at: nowIso,
      lease_until: leaseUntilIso,
    })
    .eq("order_id", orderId)
    .eq("lease_owner", leaseOwner);

  if (error) {
    throw new Error(
      `Failed to persist pending Biteship result: ${error.message}`,
    );
  }
}

async function clearCompletedBiteshipRetryState(
  adminClient: ReturnType<typeof getSupabaseAdminClient>,
  orderId: string,
  leaseOwner: string,
): Promise<void> {
  const { error } = await adminClient
    .from("webhook_side_effect_tasks")
    .update({
      needs_cart_cleanup: false,
      needs_stock: false,
      needs_biteship: false,
      last_error: null,
      last_error_code: null,
      failed_permanently_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("order_id", orderId)
    .eq("lease_owner", leaseOwner);

  if (error) {
    console.error("[process-webhook-side-effects] completed Biteship retry state update failed", {
      code: "completed_biteship_retry_state_update_failed",
    });
  }
}

async function getOrderForSideEffects(
  adminClient: ReturnType<typeof getSupabaseAdminClient>,
  orderId: string,
): Promise<Order | null> {
  const order = await getOrderAggregateById(adminClient, orderId);

  if (!order) {
    return null;
  }

  const shippingAddress = await fetchOrderShippingAddress(adminClient, order);

  return {
    ...order,
    addresses: shippingAddress,
  };
}

async function clearSelectedOrderCartItems(
  adminClient: ReturnType<typeof getSupabaseAdminClient>,
  order: Order,
): Promise<void> {
  if (!order.user_id) {
    throw new Error(
      `Missing user for order ${order.id}. Cart cleanup requires order ownership validation.`,
    );
  }

  const { data, error: provenanceLookupError } = await adminClient
    .from("order_items")
    .select("source_cart_item_id")
    .eq("order_id", order.id);

  if (provenanceLookupError) {
    throw new Error(
      `Failed to load selected cart item provenance for order ${order.id}: ${provenanceLookupError.message}`,
    );
  }

  const provenanceRows = (data ?? []) as OrderCartItemProvenanceRow[];
  const hasMissingProvenance =
    provenanceRows.length === 0 ||
    provenanceRows.some(
      (item) =>
        typeof item.source_cart_item_id !== "string" ||
        item.source_cart_item_id.trim().length === 0,
    );

  if (hasMissingProvenance) {
    throw new Error(
      `Missing selected cart item provenance for order ${order.id}. Cart cleanup requires every order item to include order_items.source_cart_item_id.`,
    );
  }

  const selectedCartItemIds = Array.from(
    new Set(
      provenanceRows.map((item) => item.source_cart_item_id?.trim() ?? ""),
    ),
  );

  if (selectedCartItemIds.length === 0) {
    throw new Error(
      `Missing selected cart item provenance for order ${order.id}. Cart cleanup requires order_items.source_cart_item_id.`,
    );
  }

  const { data: existingCartItems, error: ownershipLookupError } = await adminClient
    .from("cart_items")
    .select("id, carts(user_id)")
    .in("id", selectedCartItemIds);

  if (ownershipLookupError) {
    throw new Error(
      `Failed to validate selected cart item ownership for order ${order.id}: ${ownershipLookupError.message}`,
    );
  }

  const invalidOwnerCartItem = ((existingCartItems ?? []) as SelectedCartItemOwnershipRow[])
    .find((cartItem) => {
      const cart = Array.isArray(cartItem.carts) ? cartItem.carts[0] : cartItem.carts;
      return cart?.user_id !== order.user_id;
    });

  if (invalidOwnerCartItem) {
    throw new Error(
      `Invalid selected cart item provenance for order ${order.id}. Cart item ${invalidOwnerCartItem.id ?? "unknown"} does not belong to the order user.`,
    );
  }

  const { error: cartClearError } = await adminClient
    .from("cart_items")
    .delete()
    .in("id", selectedCartItemIds);

  if (cartClearError) {
    throw new Error(
      `Failed to clear selected cart items for order ${order.id}: ${cartClearError.message}`,
    );
  }
}

export async function listDueSideEffectTaskOrderIds(
  adminClient: ReturnType<typeof getSupabaseAdminClient>,
  limit = DEFAULT_PROCESSOR_BATCH_SIZE,
): Promise<string[]> {
  const safeLimit = Math.max(1, Math.min(limit, 50));
  const nowIso = new Date().toISOString();

  const { data, error } = await adminClient
    .from("webhook_side_effect_tasks")
    .select("order_id")
    .is("failed_permanently_at", null)
    .or(`next_retry_at.is.null,next_retry_at.lte.${nowIso}`)
    .or(`lease_until.is.null,lease_until.lt.${nowIso}`)
    .order("updated_at", { ascending: true })
    .limit(safeLimit);

  if (error) {
    throw new Error(`Failed to list side effect tasks: ${error.message}`);
  }

  return ((data ?? []) as SideEffectTaskOrderRow[])
    .map((row: SideEffectTaskOrderRow) => row.order_id)
    .filter((orderId): orderId is string => typeof orderId === "string");
}

export async function processWebhookSideEffectTask(
  adminClient: ReturnType<typeof getSupabaseAdminClient>,
  orderId: string,
): Promise<{
  processed: boolean;
  needsRetry: boolean;
  message: string;
}> {
  const existingSideEffectTask = await getSideEffectTask(adminClient, orderId);
  if (!existingSideEffectTask) {
    return {
      processed: false,
      needsRetry: false,
      message: "No side effect task found",
    };
  }

  const leaseOwner = await claimSideEffectTask(
    adminClient,
    orderId,
    existingSideEffectTask,
  );

  if (!leaseOwner) {
    return {
      processed: false,
      needsRetry: true,
      message: "Side effect task already claimed",
    };
  }

  let needsCartCleanup = existingSideEffectTask.needs_cart_cleanup;
  let needsStock = existingSideEffectTask.needs_stock;
  let needsBiteship = existingSideEffectTask.needs_biteship;
  let lastError: string | null = null;
  let lastErrorCode: string | null = null;
  let permanentFailure = false;
  let pendingBiteshipOrderId =
    existingSideEffectTask.pending_biteship_order_id ?? null;
  let pendingTrackingId = existingSideEffectTask.pending_tracking_id ?? null;
  let pendingWaybillNumber =
    existingSideEffectTask.pending_waybill_number ?? null;

  try {
    const order = await getOrderForSideEffects(adminClient, orderId);

    if (!order) {
      await saveSideEffectTask(
        adminClient,
        orderId,
        false,
        false,
        false,
        null,
        null,
        null,
        null,
        leaseOwner,
      );

      return {
        processed: true,
        needsRetry: false,
        message: "Order not found while processing side effect task",
      };
    }

    if (order.payment_status !== "settlement") {
      await saveSideEffectTask(
        adminClient,
        orderId,
        false,
        false,
        false,
        null,
        null,
        null,
        null,
        leaseOwner,
      );
      return {
        processed: true,
        needsRetry: false,
        message: "Order fulfillment side effects are waiting for settlement",
      };
    }

    if (needsCartCleanup) {
      try {
        await renewSideEffectTaskLease(adminClient, orderId, leaseOwner);
        await clearSelectedOrderCartItems(adminClient, order);
        needsCartCleanup = false;
      } catch (cartCleanupError: unknown) {
        const classification = classifySideEffectError(cartCleanupError);
        const safePermanentValidation = isSafeCartCleanupValidationError(
          cartCleanupError,
          classification,
        );
        lastError = getSafeCartCleanupErrorMessage(
          cartCleanupError,
          classification,
        );
        lastErrorCode = safePermanentValidation
          ? classification.code
          : "cart_cleanup_failed";
        permanentFailure = permanentFailure || safePermanentValidation;
      }
    }

    needsBiteship = needsBiteship && !order.biteship_order_id;

    if (needsStock && order.order_items && order.order_items.length > 0) {
      let stockFailed = false;

      for (const item of order.order_items) {
        if (!item.product_id) continue;
        await renewSideEffectTaskLease(adminClient, orderId, leaseOwner);

        let stockReduced = false;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const { error: rpcError } = await adminClient.rpc(
            "apply_order_item_stock_deduction",
            {
              p_order_id: orderId,
              p_product_id: item.product_id,
              p_quantity: getRequiredOrderItemQuantity(item, orderId),
            },
          );

          if (!rpcError) {
            stockReduced = true;
            break;
          }

          if (attempt === 2) {
            console.error(
              "[process-webhook-side-effects] Stock reduction failed:",
              {
                code: "stock_deduction_failed",
                productId: item.product_id,
              },
            );
          } else {
            await sleep(250 * (attempt + 1));
          }
        }

        if (!stockReduced) {
          stockFailed = true;
          lastError = "stock_deduction_failed";
          lastErrorCode = "stock_deduction_failed";
        }
      }

      needsStock = stockFailed;
    } else {
      needsStock = false;
    }

    let biteshipSnapshot: BiteshipOrderConfigSnapshot | null = null;

    if (needsBiteship) {
      try {
        biteshipSnapshot = await ensureBiteshipOrderConfigSnapshot(
          adminClient,
          order,
        );
      } catch (snapshotReadError: unknown) {
        const snapshotError = getBiteshipSnapshotErrorDetails(snapshotReadError);
        lastError = snapshotError.message;
        lastErrorCode = snapshotError.code;
      }
    }

    if (needsBiteship && biteshipSnapshot && pendingBiteshipOrderId) {
      try {
        await persistBiteshipShipment(adminClient, {
          orderId,
          biteshipOrderId: pendingBiteshipOrderId,
          trackingId: pendingTrackingId,
          waybillNumber: pendingWaybillNumber,
          actorType: "system",
          originAreaId: getStandardBiteshipShipmentOriginAreaIdFromSnapshot(
            order,
            biteshipSnapshot,
          ),
          metadata: {
            source: "process_webhook_side_effects_pending_task",
          },
        });
        needsBiteship = false;
        pendingBiteshipOrderId = null;
        pendingTrackingId = null;
        pendingWaybillNumber = null;
      } catch {
        lastError = "persist_pending_biteship_failed";
        lastErrorCode = "persist_pending_biteship_failed";
      }
    }

    if (
      needsBiteship &&
      biteshipSnapshot &&
      !order.biteship_order_id &&
      !pendingBiteshipOrderId
    ) {
      await renewSideEffectTaskLease(adminClient, orderId, leaseOwner);
      let biteshipResponse: BiteshipOrderResponse | null = null;
      let biteshipKey: string;
      const priorLastError = lastError;
      const priorLastErrorCode = lastErrorCode;
      const priorPermanentFailure = permanentFailure;
      let hadTransientBiteshipRetry = false;

      try {
        biteshipKey = await resolveBiteshipApiKeyFromRuntimeConfig(adminClient);
      } catch {
        lastError = "Biteship runtime config unavailable";
        lastErrorCode = "biteship_config_unavailable";
        biteshipKey = "";
      }

      for (
        let attempt = 0;
        biteshipKey && attempt < WEBHOOK_BITESHIP_MAX_ATTEMPTS;
        attempt += 1
      ) {
        try {
          await renewSideEffectTaskLease(adminClient, orderId, leaseOwner);
          biteshipResponse = await createBiteshipOrderWithBudget(
            order,
            biteshipKey,
            biteshipSnapshot,
          );
          break;
        } catch (biteshipError: unknown) {
          const classification = classifySideEffectError(biteshipError);
          lastError = classification.permanent
            ? "biteship_permanent_validation_failed"
            : "biteship_order_create_failed";
          lastErrorCode = classification.code;
          permanentFailure = permanentFailure || classification.permanent;
          hadTransientBiteshipRetry ||= !classification.permanent;

          if (
            attempt === WEBHOOK_BITESHIP_MAX_ATTEMPTS - 1 ||
            classification.permanent
          ) {
            console.error(
              "[process-webhook-side-effects] Biteship automation failed:",
              {
                code: lastError,
                errorCode: classification.code,
                permanent: classification.permanent,
              },
            );
          } else {
            await sleep(WEBHOOK_BITESHIP_RETRY_DELAY_MS);
          }

          if (classification.permanent) {
            break;
          }
        }
      }

      if (biteshipResponse) {
        await persistPendingBiteshipResult(
          adminClient,
          orderId,
          biteshipResponse.id,
          biteshipResponse.courier?.tracking_id || null,
          biteshipResponse.courier?.waybill_id || null,
          leaseOwner,
        );

        try {
          await persistBiteshipShipment(adminClient, {
            orderId,
            biteshipOrderId: biteshipResponse.id,
            trackingId: biteshipResponse.courier?.tracking_id || null,
            waybillNumber: biteshipResponse.courier?.waybill_id || null,
            actorType: "system",
            originAreaId: getStandardBiteshipShipmentOriginAreaIdFromSnapshot(
              order,
              biteshipSnapshot,
            ),
            metadata: {
              source: "process_webhook_side_effects",
              tracking_id: biteshipResponse.courier?.tracking_id || null,
            },
          });
          needsBiteship = false;
          pendingBiteshipOrderId = null;
          pendingTrackingId = null;
          pendingWaybillNumber = null;
          if (hadTransientBiteshipRetry) {
            lastError = priorLastError;
            lastErrorCode = priorLastErrorCode;
            permanentFailure = priorPermanentFailure;
            await clearCompletedBiteshipRetryState(
              adminClient,
              orderId,
              leaseOwner,
            );
          }
        } catch {
          needsBiteship = true;
          lastError = "persist_biteship_result_failed";
          lastErrorCode = "persist_biteship_result_failed";
          pendingBiteshipOrderId = biteshipResponse.id;
          pendingTrackingId = biteshipResponse.courier?.tracking_id || null;
          pendingWaybillNumber = biteshipResponse.courier?.waybill_id || null;
        }
      } else {
        needsBiteship = true;
        if (!lastError) {
          lastError = "Failed to create biteship order after retries";
          lastErrorCode = "biteship_create_failed";
        }
      }
    }

    await saveSideEffectTask(
      adminClient,
      orderId,
      needsCartCleanup,
      needsStock,
      needsBiteship,
      lastError,
      pendingBiteshipOrderId,
      pendingTrackingId,
      pendingWaybillNumber,
      leaseOwner,
      lastErrorCode,
      permanentFailure,
    );

    const needsRetry =
      ((needsCartCleanup || needsBiteship) && !permanentFailure) || needsStock;

    return {
      processed: true,
      needsRetry,
      message:
        needsRetry || permanentFailure
          ? lastError || "Fulfillment side effects need retry"
          : "Fulfillment side effects processed",
    };
  } catch (error: unknown) {
    const message = "side_effect_processing_failed";
    const classification = classifySideEffectError(error);

    await saveSideEffectTask(
      adminClient,
      orderId,
      needsCartCleanup,
      needsStock,
      needsBiteship,
      message,
      pendingBiteshipOrderId,
      pendingTrackingId,
      pendingWaybillNumber,
      leaseOwner,
      classification.code,
      classification.permanent,
    );

    return {
      processed: false,
      needsRetry: true,
      message,
    };
  }
}

export function triggerWebhookSideEffectProcessor(orderId: string): void {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return;
  }

  const processorUrl = `${supabaseUrl}/functions/v1/process-webhook-side-effects`;

  void fetch(processorUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify({ orderId, limit: 1 }),
  })
    .then((response) => {
      if (!response.ok) {
        console.error("[webhook-side-effects] webhook_side_effect_processor_trigger_failed", {
          status: response.status,
        });
      }
    })
    .catch(() => {
      console.error("[webhook-side-effects] webhook_side_effect_processor_trigger_error");
    });
}
