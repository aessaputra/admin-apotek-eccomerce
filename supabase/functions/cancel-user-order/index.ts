import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// @ts-expect-error Deno Edge Runtime resolves npm specifiers at deploy time.
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5";
import { corsHeaders } from "../_shared/cors.ts";
import {
  buildMidtransPaymentRecord,
  cancelMidtransTransaction,
  mapMidtransStatus,
  normalizeMidtransPaymentType,
  resolveMidtransTransactionRuntimeConfig,
  MidtransRuntimeConfigError,
  verifyMidtransTransaction,
} from "../_shared/midtrans.ts";
import { getOrderAggregateById } from "../_shared/order-aggregate.ts";
import { getSupabaseAdminClient } from "../_shared/supabase.ts";
import type { MidtransStatusResponse, Order, PaymentStatus } from "../_shared/types.ts";

type CancelUserOrderRequest = {
  order_id?: string;
};

declare const Deno: {
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
  env: {
    get: (key: string) => string | undefined;
  };
};

const JSON_HEADERS = { ...corsHeaders, "Content-Type": "application/json" };
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const JWKS = createRemoteJWKSet(
  new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`),
);
const JWT_ISSUER = `${supabaseUrl}/auth/v1`;
const CANCELLABLE_GATEWAY_STATUSES = new Set(["pending", "authorize", "capture"]);
const TERMINAL_GATEWAY_STATUSES = new Set(["cancel", "deny", "expire", "failure"]);

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

async function getAuthenticatedUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return null;
  }

  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: JWT_ISSUER,
      audience: "authenticated",
    });

    return payload.sub ?? null;
  } catch {
    return null;
  }
}

async function upsertPaymentRecord(
  adminClient: ReturnType<typeof getSupabaseAdminClient>,
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
  adminClient: ReturnType<typeof getSupabaseAdminClient>,
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
  adminClient: ReturnType<typeof getSupabaseAdminClient>,
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method Not Allowed" }, 405);
  }

  const userId = await getAuthenticatedUserId(req);
  if (!userId) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  try {
    const body = (await req.json().catch(() => ({}))) as CancelUserOrderRequest;
    const orderId = typeof body.order_id === "string" ? body.order_id.trim() : "";

    if (!orderId) {
      return jsonResponse({ error: "order_id is required" }, 400);
    }

    const adminClient = getSupabaseAdminClient();
    const order = await getOrderAggregateById(adminClient, orderId);

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
      runtimeConfig = await resolveMidtransTransactionRuntimeConfig(
        adminClient,
        midtransOrderId,
      );
    } catch (configError) {
      if (configError instanceof MidtransRuntimeConfigError) {
        return jsonResponse({ error: "Midtrans runtime config unavailable" }, 503);
      }

      throw configError;
    }

    let verifiedStatus = await verifyMidtransTransaction(
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
      await cancelMidtransTransaction(midtransOrderId, runtimeConfig.serverKey, {
        isProduction: runtimeConfig.isProduction,
      });
      verifiedStatus = await verifyMidtransTransaction(
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
    console.error("[cancel-user-order] Internal error:", message);
    return jsonResponse({ error: message }, 500);
  }
});
