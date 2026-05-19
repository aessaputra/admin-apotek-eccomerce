import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// @ts-expect-error Deno Edge Runtime resolves npm specifiers at deploy time.
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5";
import { corsHeaders } from "../_shared/cors.ts";
import { buildSnapPayload } from "../_shared/midtrans.ts";
import {
  CONFIG_KEYS,
  createRuntimeConfigProvider,
  RuntimeConfigError,
  type RuntimeConfigEntry,
} from "../_shared/runtime-config.ts";
import { getOrderAggregateById } from "../_shared/order-aggregate.ts";
import { getSupabaseAdminClient } from "../_shared/supabase.ts";
import type { AuthUser, Order, SnapResponse } from "../_shared/types.ts";
import {
  PaymentSessionError,
  bindMidtransPaymentConfigVersions,
  getLatestPaymentSession,
  persistPaymentSession,
  type SelectedMidtransConfigBinding,
  waitForAvailableSnapSession,
} from "./payment-session.ts";

declare const Deno: {
  env: {
    get: (key: string) => string | undefined;
  };
  serve: (
    handler: (req: Request) => Response | Promise<Response>,
  ) => void;
};

const JSON_HEADERS = { ...corsHeaders, "Content-Type": "application/json" };

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

const JWKS = createRemoteJWKSet(
  new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`),
);
const JWT_ISSUER = `${supabaseUrl}/auth/v1`;

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

function ensureMidtransOrderId(order: Order): string {
  if (order.midtrans_order_id) {
    return order.midtrans_order_id;
  }

  const shortId = order.id.replace(/-/g, "").slice(0, 8).toUpperCase();
  const timestamp = Date.now();
  return `APT-${shortId}-${timestamp}`;
}

type MidtransSnapError = {
  error_messages?: string[];
  status_message?: string;
};

type MidtransSnapRuntimeConfig = {
  serverKey: string;
  isProduction: boolean;
  selectedConfig: SelectedMidtransConfigBinding;
};

async function resolveMidtransSnapRuntimeConfig(
  adminClient: ReturnType<typeof getSupabaseAdminClient>,
): Promise<MidtransSnapRuntimeConfig> {
  const runtimeConfig = createRuntimeConfigProvider({
    adminClient,
    cacheTtlMs: 0,
  });

  try {
    const [serverKeyEntry, isProductionEntry] = await Promise.all([
      runtimeConfig.getRequiredConfig(CONFIG_KEYS.midtransServerKey),
      runtimeConfig.getRequiredConfig(CONFIG_KEYS.midtransIsProduction),
    ]);

    return {
      serverKey: readRuntimeString(serverKeyEntry),
      isProduction: readRuntimeBoolean(isProductionEntry),
      selectedConfig: {
        serverKeyVersionId: requireRuntimeVersionId(serverKeyEntry),
        serverKeyVersionNumber: requireRuntimeVersionNumber(serverKeyEntry),
        isProductionVersionId: requireRuntimeVersionId(isProductionEntry),
        isProductionVersionNumber: requireRuntimeVersionNumber(isProductionEntry),
        isProduction: readRuntimeBoolean(isProductionEntry),
      },
    };
  } catch (error) {
    if (error instanceof RuntimeConfigError) {
      throw new HttpError(503, "Midtrans runtime config unavailable");
    }

    throw error;
  }
}

function readRuntimeString(entry: RuntimeConfigEntry): string {
  if (typeof entry.value !== "string" || entry.value.trim() === "") {
    throw new HttpError(503, "Midtrans runtime config unavailable");
  }

  return entry.value;
}

function readRuntimeBoolean(entry: RuntimeConfigEntry): boolean {
  if (typeof entry.value !== "boolean") {
    throw new HttpError(503, "Midtrans runtime config unavailable");
  }

  return entry.value;
}

function requireRuntimeVersionId(entry: RuntimeConfigEntry): string {
  if (!entry.versionId) {
    throw new HttpError(503, "Midtrans runtime config unavailable");
  }

  return entry.versionId;
}

function requireRuntimeVersionNumber(entry: RuntimeConfigEntry): number {
  if (!entry.versionNumber) {
    throw new HttpError(503, "Midtrans runtime config unavailable");
  }

  return entry.versionNumber;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method Not Allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Missing or invalid Authorization header" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      return new Response(
        JSON.stringify({ error: "Missing or invalid Authorization header" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    let userId: string;
    let userEmail: string;
    try {
      const { payload } = await jwtVerify(token, JWKS, {
        issuer: JWT_ISSUER,
        audience: "authenticated",
      });
      userId = payload.sub ?? "";
      userEmail = ((payload as Record<string, unknown>).email as string) ?? "";
      if (!userId) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } catch {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as { order_id?: string };
    const orderId = body.order_id?.trim();
    if (!orderId) {
      throw new HttpError(400, "order_id is required");
    }

    const adminClient = getSupabaseAdminClient();
    const order = await getOrderAggregateById(adminClient, orderId);

    if (!order) {
      throw new HttpError(404, "Order not found");
    }

    if (order.user_id !== userId) {
      throw new HttpError(403, "Forbidden");
    }

    if (order.status !== "pending" || order.payment_status !== "pending") {
      throw new HttpError(400, "Order state invalid for payment");
    }

    if (order.expired_at && new Date(order.expired_at) < new Date()) {
      throw new HttpError(400, "Order has expired");
    }

    const SNAP_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

    const isTokenExpired = (createdAt: string | null | undefined): boolean => {
      if (!createdAt) return true;
      return Date.now() - new Date(createdAt).getTime() > SNAP_TOKEN_TTL_MS;
    };

    if (
      order.snap_token &&
      order.snap_redirect_url &&
      !isTokenExpired(order.snap_token_created_at)
    ) {
      const reusableSession = await getLatestPaymentSession(adminClient, order.id);
      if (!reusableSession?.id || !reusableSession.midtrans_order_id) {
        throw new HttpError(500, "Failed to resolve reusable payment session");
      }

      await bindMidtransPaymentConfigVersions(adminClient, {
        paymentId: reusableSession.id,
        midtransOrderId: reusableSession.midtrans_order_id,
        bindingSource: "snap_token_reuse",
      });

      return jsonResponse({
        snap_token: order.snap_token,
        redirect_url: order.snap_redirect_url,
      });
    }

    if (order.checkout_idempotency_key) {
      const { data: idempotentOrder } = await adminClient
        .from("order_read_model")
        .select(
          "id, user_id, snap_token, snap_redirect_url, snap_token_created_at, midtrans_order_id",
        )
        .eq("checkout_idempotency_key", order.checkout_idempotency_key)
        .eq("user_id", userId)
        .not("snap_token", "is", null)
        .not("snap_redirect_url", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (
        idempotentOrder?.snap_token &&
        idempotentOrder?.snap_redirect_url &&
        !isTokenExpired(idempotentOrder.snap_token_created_at)
      ) {
        const sourcePaymentSession = await getLatestPaymentSession(
          adminClient,
          idempotentOrder.id,
        );

        if (idempotentOrder.id !== order.id) {
          if (!sourcePaymentSession?.id) {
            throw new HttpError(500, "Failed to resolve source payment session");
          }

          await persistPaymentSession(adminClient, order, {
            midtransOrderId: order.midtrans_order_id ?? ensureMidtransOrderId(order),
            snapToken: idempotentOrder.snap_token,
            redirectUrl: idempotentOrder.snap_redirect_url,
            snapTokenCreatedAt: idempotentOrder.snap_token_created_at,
            bindingSource: "snap_token_reuse",
            sourcePaymentId: sourcePaymentSession.id,
          });
        } else if (sourcePaymentSession?.id && sourcePaymentSession.midtrans_order_id) {
          await bindMidtransPaymentConfigVersions(adminClient, {
            paymentId: sourcePaymentSession.id,
            midtransOrderId: sourcePaymentSession.midtrans_order_id,
            bindingSource: "snap_token_reuse",
          });
        }

        return jsonResponse({
          snap_token: idempotentOrder.snap_token,
          redirect_url: idempotentOrder.snap_redirect_url,
        });
      }
    }

    const lockOwner = crypto.randomUUID();
    const lockAcquiredResponse = await adminClient.rpc(
      "acquire_snap_token_generation_lock",
      {
        p_order_id: order.id,
        p_checkout_idempotency_key: order.checkout_idempotency_key ?? order.id,
        p_owner: lockOwner,
        p_ttl_seconds: 90,
      },
    );

    if (lockAcquiredResponse.error) {
      throw new HttpError(500, "Failed to acquire payment token lock");
    }

    const lockAcquired = lockAcquiredResponse.data === true;

    if (!lockAcquired) {
      const pendingSession = await waitForAvailableSnapSession(
        adminClient,
        order.id,
        isTokenExpired,
      );

      if (pendingSession?.snap_token && pendingSession.redirect_url) {
        if (!pendingSession.id || !pendingSession.midtrans_order_id) {
          throw new HttpError(500, "Failed to resolve reusable payment session");
        }

        await bindMidtransPaymentConfigVersions(adminClient, {
          paymentId: pendingSession.id,
          midtransOrderId: pendingSession.midtrans_order_id,
          bindingSource: "snap_token_reuse",
        });

        return jsonResponse({
          snap_token: pendingSession.snap_token,
          redirect_url: pendingSession.redirect_url,
        });
      }

      throw new HttpError(409, "Payment token generation is already in progress");
    }

    try {
      const latestPaymentSession = await getLatestPaymentSession(adminClient, order.id);

      if (
        latestPaymentSession?.snap_token &&
        latestPaymentSession.redirect_url &&
        !isTokenExpired(latestPaymentSession.snap_token_created_at)
      ) {
        if (!latestPaymentSession.id || !latestPaymentSession.midtrans_order_id) {
          throw new HttpError(500, "Failed to resolve reusable payment session");
        }

        await bindMidtransPaymentConfigVersions(adminClient, {
          paymentId: latestPaymentSession.id,
          midtransOrderId: latestPaymentSession.midtrans_order_id,
          bindingSource: "snap_token_reuse",
        });

        return jsonResponse({
          snap_token: latestPaymentSession.snap_token,
          redirect_url: latestPaymentSession.redirect_url,
        });
      }

      const midtransOrderId = latestPaymentSession?.midtrans_order_id ??
        ensureMidtransOrderId(order);
      await persistPaymentSession(adminClient, order, {
        midtransOrderId,
      });

      const payload = buildSnapPayload(
        {
          ...order,
          midtrans_order_id: midtransOrderId,
        },
        {
          id: userId,
          email: userEmail,
        } as AuthUser,
      );

      const midtransConfig = await resolveMidtransSnapRuntimeConfig(adminClient);
      const midtransApiUrl = midtransConfig.isProduction
        ? "https://app.midtrans.com/snap/v1/transactions"
        : "https://app.sandbox.midtrans.com/snap/v1/transactions";

      const PAYMENT_PROVIDER_REQUEST_TIMEOUT_MS = 30_000;

      let midtransResponse: Response;
      try {
        midtransResponse = await fetch(midtransApiUrl, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            Authorization: `Basic ${btoa(`${midtransConfig.serverKey}:`)}`,
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(PAYMENT_PROVIDER_REQUEST_TIMEOUT_MS),
        });
      } catch (error: unknown) {
        if (
          error instanceof Error &&
          (error.name === "AbortError" || error.name === "TimeoutError")
        ) {
          throw new HttpError(504, "Midtrans token creation timed out");
        }

        throw error;
      }

      const midtransData =
        (await midtransResponse.json()) as Partial<SnapResponse> &
          MidtransSnapError;
      if (
        !midtransResponse.ok ||
        !midtransData.token ||
        !midtransData.redirect_url
      ) {
        throw new HttpError(
          502,
          midtransData.error_messages?.[0] ||
            midtransData.status_message ||
            "Midtrans token creation failed",
        );
      }

      const nowIso = new Date().toISOString();
      await persistPaymentSession(adminClient, order, {
        midtransOrderId,
        snapToken: midtransData.token,
        redirectUrl: midtransData.redirect_url,
        snapTokenCreatedAt: nowIso,
        grossAmount: payload.transaction_details.gross_amount,
        bindingSource: "snap_token_created",
        selectedConfig: midtransConfig.selectedConfig,
      });

      return jsonResponse({
        snap_token: midtransData.token,
        redirect_url: midtransData.redirect_url,
      });
    } finally {
      const releaseLockResponse = await adminClient.rpc(
        "release_snap_token_generation_lock",
        {
          p_order_id: order.id,
          p_owner: lockOwner,
        },
      );

      if (releaseLockResponse.error) {
        console.error(
          "[create-snap-token] Failed to release payment token lock:",
          releaseLockResponse.error.message,
        );
      }
    }
  } catch (error: unknown) {
    if (error instanceof HttpError || error instanceof PaymentSessionError) {
      return jsonResponse({ error: error.message }, error.status);
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[create-snap-token] Internal error:", message);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
