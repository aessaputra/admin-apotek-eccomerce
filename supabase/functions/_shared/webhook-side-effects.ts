import { createBiteshipOrder, persistBiteshipShipment } from "./biteship.ts";
import { getSupabaseAdminClient } from "./supabase.ts";
import type { BiteshipOrderResponse, Order, OrderItem } from "./types.ts";

declare const Deno: {
  env: {
    get: (key: string) => string | undefined;
  };
};

const SIDE_EFFECT_LEASE_MS = 10 * 60 * 1000;
const BITESHIP_CALL_TIMEOUT_MS = 45_000;
const DEFAULT_PROCESSOR_BATCH_SIZE = 10;

export interface SideEffectTask {
  needs_stock: boolean;
  needs_biteship: boolean;
  retry_count: number;
  updated_at: string;
  lease_until: string | null;
  pending_biteship_order_id: string | null;
  pending_waybill_number: string | null;
}

interface SideEffectTaskOrderRow {
  order_id: string | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      "needs_stock, needs_biteship, retry_count, updated_at, lease_until, pending_biteship_order_id, pending_waybill_number",
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
  needsStock: boolean,
  needsBiteship: boolean,
  lastError: string | null,
  pendingBiteshipOrderId: string | null = null,
  pendingWaybillNumber: string | null = null,
): Promise<void> {
  if (!needsStock && !needsBiteship) {
    const { error } = await adminClient
      .from("webhook_side_effect_tasks")
      .delete()
      .eq("order_id", orderId);
    if (error) {
      throw new Error(`Failed to delete side effect task: ${error.message}`);
    }
    return;
  }

  const existingTask = await getSideEffectTask(adminClient, orderId);
  const nextRetryCount = existingTask?.retry_count ?? 0;

  const { error } = await adminClient.from("webhook_side_effect_tasks").upsert(
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
    { onConflict: "order_id" },
  );

  if (error) {
    throw new Error(`Failed to upsert side effect task: ${error.message}`);
  }
}

export async function claimSideEffectTask(
  adminClient: ReturnType<typeof getSupabaseAdminClient>,
  orderId: string,
  currentTask: SideEffectTask,
): Promise<boolean> {
  if (
    currentTask.lease_until &&
    Date.parse(currentTask.lease_until) > Date.now()
  ) {
    return false;
  }

  const nowIso = new Date().toISOString();
  const leaseUntilIso = new Date(
    Date.now() + SIDE_EFFECT_LEASE_MS,
  ).toISOString();

  const { data, error } = await adminClient
    .from("webhook_side_effect_tasks")
    .update({
      retry_count: currentTask.retry_count + 1,
      updated_at: nowIso,
      claimed_at: nowIso,
      lease_until: leaseUntilIso,
    })
    .eq("order_id", orderId)
    .eq("updated_at", currentTask.updated_at)
    .select("order_id")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to claim side effect task: ${error.message}`);
  }

  return !!data;
}

export async function renewSideEffectTaskLease(
  adminClient: ReturnType<typeof getSupabaseAdminClient>,
  orderId: string,
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
    .eq("order_id", orderId);

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
  const leaseUntilIso = new Date(
    Date.now() + SIDE_EFFECT_LEASE_MS,
  ).toISOString();

  const { error } = await adminClient
    .from("webhook_side_effect_tasks")
    .update({
      pending_biteship_order_id: biteshipOrderId,
      pending_waybill_number: waybillNumber,
      updated_at: nowIso,
      lease_until: leaseUntilIso,
    })
    .eq("order_id", orderId);

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
      addresses (*),
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

  return data as unknown as Order;
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

  const claimed = await claimSideEffectTask(
    adminClient,
    orderId,
    existingSideEffectTask,
  );

  if (!claimed) {
    return {
      processed: false,
      needsRetry: true,
      message: "Side effect task already claimed",
    };
  }

  let needsStock = existingSideEffectTask.needs_stock;
  let needsBiteship = existingSideEffectTask.needs_biteship;
  let lastError: string | null = null;
  let pendingBiteshipOrderId =
    existingSideEffectTask.pending_biteship_order_id ?? null;
  let pendingWaybillNumber =
    existingSideEffectTask.pending_waybill_number ?? null;

  try {
    const order = await getOrderForSideEffects(adminClient, orderId);

    if (!order) {
      await saveSideEffectTask(
        adminClient,
        orderId,
        needsStock,
        needsBiteship,
        "Order not found while processing fulfillment side effects",
        pendingBiteshipOrderId,
        pendingWaybillNumber,
      );

      return {
        processed: false,
        needsRetry: true,
        message: "Order not found while processing side effect task",
      };
    }

    if (order.payment_status !== "settlement") {
      await saveSideEffectTask(adminClient, orderId, false, false, null);
      return {
        processed: true,
        needsRetry: false,
        message: "Order no longer requires fulfillment side effects",
      };
    }

    needsBiteship = needsBiteship && !order.biteship_order_id;

    if (needsStock && order.order_items && order.order_items.length > 0) {
      let stockFailed = false;

      for (const item of order.order_items) {
        if (!item.product_id) continue;
        await renewSideEffectTaskLease(adminClient, orderId);

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
          waybillNumber: pendingWaybillNumber,
          actorType: "system",
          metadata: {
            source: "process_webhook_side_effects_pending_task",
          },
        });
        needsBiteship = false;
        pendingBiteshipOrderId = null;
        pendingWaybillNumber = null;
      } catch (persistPendingError: unknown) {
        lastError = `Failed to persist pending Biteship result: ${persistPendingError instanceof Error ? persistPendingError.message : String(persistPendingError)}`;
      }
    }

    if (needsBiteship && !order.biteship_order_id && biteshipKey) {
      await renewSideEffectTaskLease(adminClient, orderId);
      let biteshipResponse: BiteshipOrderResponse | null = null;

      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await renewSideEffectTaskLease(adminClient, orderId);
          type BiteshipOrderInput = Parameters<typeof createBiteshipOrder>[0];
          biteshipResponse = (await withTimeout(
            createBiteshipOrder(
              order as unknown as BiteshipOrderInput,
              biteshipKey,
            ),
            BITESHIP_CALL_TIMEOUT_MS,
            "Biteship request timeout",
          )) as BiteshipOrderResponse;
          break;
        } catch (biteshipError: unknown) {
          const message =
            biteshipError instanceof Error
              ? biteshipError.message
              : "Unknown Biteship error";

          if (attempt === 2) {
            console.error(
              "[process-webhook-side-effects] Biteship automation failed:",
              message,
            );
          } else {
            await sleep(350 * (attempt + 1));
          }
        }
      }

      if (biteshipResponse) {
        await persistPendingBiteshipResult(
          adminClient,
          orderId,
          biteshipResponse.id,
          biteshipResponse.courier?.waybill_id || null,
        );

        try {
          await persistBiteshipShipment(adminClient, {
            orderId,
            biteshipOrderId: biteshipResponse.id,
            waybillNumber: biteshipResponse.courier?.waybill_id || null,
            actorType: "system",
            metadata: {
              source: "process_webhook_side_effects",
              tracking_id: biteshipResponse.courier?.tracking_id || null,
            },
          });
          needsBiteship = false;
          pendingBiteshipOrderId = null;
          pendingWaybillNumber = null;
        } catch (updateOrderError: unknown) {
          needsBiteship = true;
          lastError = `Failed to persist Biteship result: ${updateOrderError instanceof Error ? updateOrderError.message : String(updateOrderError)}`;
          pendingBiteshipOrderId = biteshipResponse.id;
          pendingWaybillNumber = biteshipResponse.courier?.waybill_id || null;
        }
      } else {
        needsBiteship = true;
        if (!lastError) {
          lastError = "Failed to create biteship order after retries";
        }
      }
    } else if (needsBiteship && !biteshipKey && !lastError) {
      lastError = "BITESHIP_API_KEY is not configured";
    }

    await saveSideEffectTask(
      adminClient,
      orderId,
      needsStock,
      needsBiteship,
      lastError,
      pendingBiteshipOrderId,
      pendingWaybillNumber,
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

    await saveSideEffectTask(
      adminClient,
      orderId,
      needsStock,
      needsBiteship,
      message,
      pendingBiteshipOrderId,
      pendingWaybillNumber,
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
  }).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      "[webhook-side-effects] Failed to trigger side effect processor:",
      message,
    );
  });
}
