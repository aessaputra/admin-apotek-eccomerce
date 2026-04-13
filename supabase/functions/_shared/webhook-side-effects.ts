import {
  createBiteshipOrder,
  persistBiteshipShipment,
} from "./biteship.ts";
import { fetchOrderShippingAddress } from "./biteship-order-helpers.ts";
import { getSupabaseAdminClient } from "./supabase.ts";
import type { BiteshipOrderResponse, Order, OrderItem } from "./types.ts";

declare const Deno: {
  env: {
    get: (key: string) => string | undefined;
  };
};

const SIDE_EFFECT_LEASE_MS = 10 * 60 * 1000;
const BITESHIP_CALL_TIMEOUT_MS = 45_000;
const DEFAULT_PROCESSOR_BATCH_SIZE = 3;
const MAX_RETRY_DELAY_MS = 60 * 60 * 1000;

export interface SideEffectTask {
  needs_cart_cleanup: boolean;
  needs_stock: boolean;
  needs_biteship: boolean;
  retry_count: number;
  updated_at: string;
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
      "needs_cart_cleanup, needs_stock, needs_biteship, retry_count, updated_at, lease_owner, lease_until, next_retry_at, last_attempted_at, last_error_code, failed_permanently_at, pending_biteship_order_id, pending_tracking_id, pending_waybill_number",
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

export async function ensureSettlementSideEffectsQueued(
  adminClient: ReturnType<typeof getSupabaseAdminClient>,
  orderId: string,
  paymentStatus: string,
): Promise<boolean> {
  if (paymentStatus !== "settlement") {
    return false;
  }

  let existingSideEffectTask = await getSideEffectTask(adminClient, orderId);
  if (!existingSideEffectTask) {
    await saveSideEffectTask(
      adminClient,
      orderId,
      true,
      true,
      false,
      null,
    );
    existingSideEffectTask = await getSideEffectTask(adminClient, orderId);
  }

  return !!existingSideEffectTask;
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

async function getOrderForSideEffects(
  adminClient: ReturnType<typeof getSupabaseAdminClient>,
  orderId: string,
): Promise<Order | null> {
  const { data, error } = await adminClient
    .from("orders")
    .select(
      `
      *,
      profiles (full_name, phone_number),
      order_items (
        *,
        products (*)
      )
    `,
    )
    .eq("id", orderId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  const order = data as Order;
  const shippingAddress = await fetchOrderShippingAddress(adminClient, order);

  return {
    ...order,
    addresses: shippingAddress,
  };
}

async function clearOrderCart(
  adminClient: ReturnType<typeof getSupabaseAdminClient>,
  order: Order,
): Promise<void> {
  if (!order.user_id) {
    return;
  }

  const { data: userCart, error: cartLookupError } = await adminClient
    .from("carts")
    .select("id")
    .eq("user_id", order.user_id)
    .maybeSingle();

  if (cartLookupError) {
    throw new Error(
      `Failed to look up cart for order ${order.id}: ${cartLookupError.message}`,
    );
  }

  if (!userCart?.id) {
    return;
  }

  const { error: cartClearError } = await adminClient
    .from("cart_items")
    .delete()
    .eq("cart_id", userCart.id);

  if (cartClearError) {
    throw new Error(
      `Failed to clear cart for order ${order.id}: ${cartClearError.message}`,
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
        message: "Order no longer requires fulfillment side effects",
      };
    }

    if (needsCartCleanup) {
      try {
        await renewSideEffectTaskLease(adminClient, orderId, leaseOwner);
        await clearOrderCart(adminClient, order);
        needsCartCleanup = false;
      } catch (cartCleanupError: unknown) {
        lastError =
          cartCleanupError instanceof Error
            ? cartCleanupError.message
            : "Failed to clear cart after settlement";
        lastErrorCode = "cart_cleanup_failed";
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
              "[process-webhook-side-effects] Stock reduction failed for",
              item.product_id,
              ":",
              rpcError.message,
            );
          } else {
            await sleep(250 * (attempt + 1));
          }
        }

        if (!stockReduced) {
          stockFailed = true;
          lastError = "Failed to reduce stock after retries";
          lastErrorCode = "stock_deduction_failed";
        }
      }

      needsStock = stockFailed;
    } else {
      needsStock = false;
    }

    const biteshipKey = Deno.env.get("BITESHIP_API_KEY");

    if (needsBiteship && pendingBiteshipOrderId) {
      try {
        await persistBiteshipShipment(adminClient, {
          orderId,
          biteshipOrderId: pendingBiteshipOrderId,
          trackingId: pendingTrackingId,
          waybillNumber: pendingWaybillNumber,
          actorType: "system",
          metadata: {
            source: "process_webhook_side_effects_pending_task",
          },
        });
        needsBiteship = false;
        pendingBiteshipOrderId = null;
        pendingTrackingId = null;
        pendingWaybillNumber = null;
      } catch (persistPendingError: unknown) {
        lastError = `Failed to persist pending Biteship result: ${persistPendingError instanceof Error ? persistPendingError.message : String(persistPendingError)}`;
        lastErrorCode = "persist_pending_biteship_failed";
      }
    }

    if (needsBiteship && !order.biteship_order_id && biteshipKey) {
      await renewSideEffectTaskLease(adminClient, orderId, leaseOwner);
      let biteshipResponse: BiteshipOrderResponse | null = null;

      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await renewSideEffectTaskLease(adminClient, orderId, leaseOwner);
          biteshipResponse = (await withTimeout(
            createBiteshipOrder(order, biteshipKey),
            BITESHIP_CALL_TIMEOUT_MS,
            "Biteship request timeout",
          )) as BiteshipOrderResponse;
          break;
        } catch (biteshipError: unknown) {
          const message =
            biteshipError instanceof Error
              ? biteshipError.message
              : "Unknown Biteship error";
          const classification = classifySideEffectError(biteshipError);
          lastError = message;
          lastErrorCode = classification.code;
          permanentFailure = classification.permanent;

          if (attempt === 2 || classification.permanent) {
            console.error(
              "[process-webhook-side-effects] Biteship automation failed:",
              message,
            );
          } else {
            await sleep(350 * (attempt + 1));
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
            metadata: {
              source: "process_webhook_side_effects",
              tracking_id: biteshipResponse.courier?.tracking_id || null,
            },
          });
          needsBiteship = false;
          pendingBiteshipOrderId = null;
          pendingTrackingId = null;
          pendingWaybillNumber = null;
        } catch (updateOrderError: unknown) {
          needsBiteship = true;
          lastError = `Failed to persist Biteship result: ${updateOrderError instanceof Error ? updateOrderError.message : String(updateOrderError)}`;
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
    } else if (needsBiteship && !biteshipKey && !lastError) {
      lastError = "BITESHIP_API_KEY is not configured";
      lastErrorCode = "biteship_key_missing";
      permanentFailure = true;
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

    return {
      processed: true,
      needsRetry: needsStock || needsBiteship,
      message:
        needsStock || needsBiteship
          ? lastError || "Fulfillment side effects need retry"
          : "Fulfillment side effects processed",
    };
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown side effect processor error";
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
    .then(async (response) => {
      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        console.error(
          "[webhook-side-effects] Processor trigger returned non-OK response:",
          response.status,
          errorBody,
        );
      }
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        "[webhook-side-effects] Failed to trigger side effect processor:",
        message,
      );
    });
}
