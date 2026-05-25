import { afterEach, describe, expect, it, vi } from "vitest";

import { createBiteshipHandler } from "../supabase/functions/biteship/handler.ts";
import { createCheckoutOrderHandler, HttpError } from "../supabase/functions/create-checkout-order/handler.ts";
import { createConfirmMidtransPaymentHandler } from "../supabase/functions/confirm-midtrans-payment/handler.ts";
import { createProcessWebhookSideEffectsHandler } from "../supabase/functions/process-webhook-side-effects/handler.ts";
import { createPushHandler } from "../supabase/functions/push/handler.ts";
import { createReconcilePendingMidtransPaymentsHandler } from "../supabase/functions/reconcile-pending-midtrans-payments/handler.ts";

const SMOKE_SERVICE_ROLE_KEY = "smoke-service-role-token";
const SMOKE_URL = "http://127.0.0.1/functions/v1";

function unreachableDependency(name: string): never {
  throw new Error(`${name} must not be called during mock-only smoke validation`);
}

function jsonRequest(path: string, body: Record<string, unknown>, headers?: HeadersInit): Request {
  return new Request(`${SMOKE_URL}${path}`, {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    method: "POST",
  });
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

describe("mock-only Edge Runtime smoke validation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("rejects checkout requests before admin RPC when authentication fails", async () => {
    const getAdminClient = vi.fn(() => unreachableDependency("checkout admin client"));
    const handler = createCheckoutOrderHandler({
      getAdminClient,
      getAuthenticatedUserId: vi.fn(async () => {
        throw new HttpError(401, "Unauthorized");
      }),
    });

    const response = await handler(jsonRequest("/create-checkout-order", {}));

    expect(response.status).toBe(401);
    expect(await readJson(response)).toEqual({ error: "Unauthorized" });
    expect(getAdminClient).not.toHaveBeenCalled();
  });

  it("rejects manual Midtrans confirmation before admin access when no user is authenticated", async () => {
    const getAdminClient = vi.fn(() => unreachableDependency("confirm payment admin client"));
    const handler = createConfirmMidtransPaymentHandler({
      getAdminClient,
      getAuthenticatedUserId: vi.fn(async () => null),
    });

    const response = await handler(jsonRequest("/confirm-midtrans-payment", { order_id: "smoke-order" }));

    expect(response.status).toBe(401);
    expect(await readJson(response)).toEqual({ error: "Unauthorized" });
    expect(getAdminClient).not.toHaveBeenCalled();
  });

  it("rejects pending Midtrans reconciliation without a service-role bearer before listing orders", async () => {
    const getAdminClient = vi.fn(() => unreachableDependency("reconciliation admin client"));
    const handler = createReconcilePendingMidtransPaymentsHandler({
      getAdminClient,
      getServiceRoleKey: () => SMOKE_SERVICE_ROLE_KEY,
    });

    const response = await handler(jsonRequest("/reconcile-pending-midtrans-payments", { limit: 1 }));

    expect(response.status).toBe(401);
    expect(await readJson(response)).toEqual({ error: "Unauthorized" });
    expect(getAdminClient).not.toHaveBeenCalled();
  });

  it("rejects webhook side-effect processing without a service-role bearer before loading tasks", async () => {
    const getAdminClient = vi.fn(() => unreachableDependency("side-effect admin client"));
    const handler = createProcessWebhookSideEffectsHandler({
      getAdminClient,
      getServiceRoleKey: () => SMOKE_SERVICE_ROLE_KEY,
    });

    const response = await handler(jsonRequest("/process-webhook-side-effects", { limit: 1 }));

    expect(response.status).toBe(401);
    expect(await readJson(response)).toEqual({ error: "Unauthorized" });
    expect(getAdminClient).not.toHaveBeenCalled();
  });

  it("rejects Biteship requests without bearer auth before provider or runtime config access", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
    const getAdminClient = vi.fn(() => unreachableDependency("biteship admin client"));
    const resolveAuthHeader = vi.fn(async () => "Bearer smoke-biteship-provider-key");
    const resolveRuntimeSettings = vi.fn(async () => unreachableDependency("biteship runtime settings"));
    const verifyUserId = vi.fn(async () => "smoke-user");
    const handler = createBiteshipHandler({
      fetchFn,
      getAdminClient,
      resolveAuthHeader,
      resolveRuntimeSettings,
      verifyUserId,
    });

    const response = await handler(jsonRequest("/biteship", { action: "rates", payload: {} }));

    expect(response.status).toBe(401);
    expect(await readJson(response)).toEqual({ error: "Missing or invalid Authorization header" });
    expect(getAdminClient).not.toHaveBeenCalled();
    expect(resolveAuthHeader).not.toHaveBeenCalled();
    expect(resolveRuntimeSettings).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("rejects push webhooks without a service-role bearer before creating an admin client", async () => {
    const createClientFn = vi.fn(() => unreachableDependency("push admin client"));
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ data: [] })));
    const handler = createPushHandler({
      createClientFn,
      env: {
        get: (key) => {
          if (key === "SUPABASE_SERVICE_ROLE_KEY") return SMOKE_SERVICE_ROLE_KEY;
          if (key === "SUPABASE_URL") return SMOKE_URL;
          return undefined;
        },
      },
      fetchFn,
    });

    const response = await handler(jsonRequest("/push", {}));

    expect(response.status).toBe(401);
    expect(await readJson(response)).toEqual({ error: "Unauthorized" });
    expect(createClientFn).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("rejects malformed Midtrans webhook payloads before admin client creation", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const serveMock = vi.fn();
    vi.stubGlobal("Deno", {
      env: { get: () => undefined },
      serve: serveMock,
    });
    const { createMidtransWebhookHandler } = await import(
      "../supabase/functions/midtrans-webhook/index.ts"
    );
    const getAdminClient = vi.fn(() => unreachableDependency("midtrans webhook admin client"));
    const handler = createMidtransWebhookHandler({ getAdminClient });

    const response = await handler(new Request(`${SMOKE_URL}/midtrans-webhook`, {
      body: "not-json",
      method: "POST",
    }));

    expect(response.status).toBe(400);
    expect(await readJson(response)).toEqual({ error: "Invalid JSON payload" });
    expect(getAdminClient).not.toHaveBeenCalled();
    expect(serveMock).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith("[midtrans-webhook] Invalid JSON:", {
      code: "midtrans_invalid_json",
    });
  });
});
