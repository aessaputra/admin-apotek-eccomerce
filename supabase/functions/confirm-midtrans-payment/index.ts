import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// @ts-expect-error Deno Edge Runtime resolves npm specifiers at deploy time.
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5";
import {
  buildMidtransPaymentRecord,
  calculateMidtransGrossAmount,
  isConfirmedMidtransSuccess,
  isIgnorableMidtransNoop,
  mapMidtransStatus,
  normalizeMidtransPaymentType,
  resolveMidtransTransactionRuntimeConfig,
  MidtransRuntimeConfigError,
  verifyMidtransTransaction,
} from "../_shared/midtrans.ts";
import { getSupabaseAdminClient } from "../_shared/supabase.ts";
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

declare const Deno: {
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
  env: {
    get: (key: string) => string | undefined;
  };
};

const JSON_HEADERS = { "Content-Type": "application/json" };
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const JWKS = createRemoteJWKSet(
  new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`),
);
const JWT_ISSUER = `${supabaseUrl}/auth/v1`;

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
  adminClient: ReturnType<typeof getSupabaseAdminClient>,
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

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method Not Allowed" }, 405);
  }

  const userId = await getAuthenticatedUserId(req);
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

    const adminClient = getSupabaseAdminClient();
    const order = await getOrderAggregateById(adminClient, orderId);

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
      runtimeConfig = await resolveMidtransTransactionRuntimeConfig(
        adminClient,
        midtransOrderId,
      );
    } catch (configError) {
      if (configError instanceof MidtransRuntimeConfigError) {
        return jsonResponse(
          { error: "Midtrans runtime config unavailable" },
          503,
        );
      }

      throw configError;
    }

    const verifiedStatus = await verifyMidtransTransaction(
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
    const verifiedAmount = Math.round(
      toNumericAmount(verifiedStatus.gross_amount),
    );

    if (verifiedAmount !== expectedAmount) {
      return jsonResponse({ error: "Amount mismatch" }, 409);
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

    await upsertPaymentRecord(
      adminClient,
      order,
      verifiedStatus,
      persistedPaymentStatus,
    );

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
      await ensureSettlementSideEffectsQueued(
        adminClient,
        order.id,
        persistedPaymentStatus,
      )
    ) {
      triggerWebhookSideEffectProcessor(order.id);
    }

    return jsonResponse({
      confirmed: true,
      payment_status: persistedPaymentStatus,
      order_status: transition?.order_status || newOrderStatus,
      applied,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[confirm-midtrans-payment] Internal error:", message);
    return jsonResponse({ error: message }, 500);
  }
});
