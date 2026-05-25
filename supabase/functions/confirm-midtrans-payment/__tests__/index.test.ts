import { describe, expect, it, vi } from "vitest";
import { createConfirmMidtransPaymentHandler } from "../handler.ts";
import type { MidtransStatusResponse, Order } from "../../_shared/types.ts";

function createRequest(orderId: unknown = "order-1") {
  return new Request("https://example.test/functions/v1/confirm-midtrans-payment", {
    method: "POST",
    headers: {
      Authorization: "Bearer user-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ order_id: orderId }),
  });
}

function createOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: "order-1",
    user_id: "user-1",
    status: "pending",
    payment_status: "pending",
    payment_type: "bank_transfer",
    currency: "IDR",
    total_amount: 150000,
    shipping_cost: 0,
    gross_amount: 150000,
    midtrans_order_id: "MIDTRANS-ORDER-1",
    ...overrides,
  };
}

function createVerifiedStatus(overrides: Partial<MidtransStatusResponse> = {}): MidtransStatusResponse {
  return {
    order_id: "MIDTRANS-ORDER-1",
    transaction_id: "transaction-1",
    transaction_status: "settlement",
    fraud_status: "accept",
    status_code: "200",
    gross_amount: "150000.00",
    payment_type: "bank_transfer",
    currency: "IDR",
    settlement_time: "2026-05-24 12:00:00",
    ...overrides,
  };
}

function createAdminClient() {
  const upsert = vi.fn(async () => ({ error: null }));
  const maybeSingle = vi.fn(async () => ({ data: null, error: null }));
  const from = vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({ maybeSingle })),
    })),
    upsert,
  }));
  const rpc = vi.fn(async () => ({
    data: [{ applied: true, payment_status: "settlement", order_status: "processing" }],
    error: null,
  }));

  return { adminClient: { from, rpc }, from, rpc, upsert, maybeSingle };
}

function createHandler(options?: {
  order?: Order;
  verifiedStatus?: MidtransStatusResponse;
  queueSideEffects?: boolean;
}) {
  const { adminClient, from, rpc, upsert } = createAdminClient();
  const getAuthenticatedUserId = vi.fn(async () => "user-1");
  const getAdminClient = vi.fn(() => adminClient as never);
  const getOrderById = vi.fn(async () => options?.order ?? createOrder());
  const resolveRuntimeConfig = vi.fn(async () => ({
    serverKey: "server-key",
    isProduction: false,
    source: "active" as const,
    serverKeyVersionId: "server-key-version-id",
    serverKeyVersionNumber: 1,
    isProductionVersionId: "is-production-version-id",
    isProductionVersionNumber: 1,
  }));
  const verifyTransaction = vi.fn(async () => options?.verifiedStatus ?? createVerifiedStatus());
  const ensureSettlementSideEffectsQueued = vi.fn(async () => options?.queueSideEffects ?? true);
  const triggerWebhookSideEffectProcessor = vi.fn();
  const logError = vi.fn();

  return {
    handler: createConfirmMidtransPaymentHandler({
      getAuthenticatedUserId,
      getAdminClient,
      getOrderById,
      resolveRuntimeConfig,
      verifyTransaction,
      ensureSettlementSideEffectsQueued,
      triggerWebhookSideEffectProcessor,
      logError,
    }),
    from,
    rpc,
    upsert,
    ensureSettlementSideEffectsQueued,
    triggerWebhookSideEffectProcessor,
  };
}

describe("confirm-midtrans-payment handler currency validation", () => {

  it("rejects unauthenticated requests before DB access", async () => {
    const { from, rpc, upsert } = createAdminClient();
    const handler = createConfirmMidtransPaymentHandler({
      getAuthenticatedUserId: vi.fn(async () => null),
      getAdminClient: vi.fn(() => ({ from, rpc } as never)),
    });

    const response = await handler(createRequest());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("rejects malformed request bodies before DB access", async () => {
    const { from, rpc, upsert } = createAdminClient();
    const handler = createConfirmMidtransPaymentHandler({
      getAuthenticatedUserId: vi.fn(async () => "user-1"),
      getAdminClient: vi.fn(() => ({ from, rpc } as never)),
    });

    const response = await handler(createRequest(" "));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "order_id is required" });
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("rejects amount mismatch before transition, payment upsert, or side effects", async () => {
    const { handler, rpc, upsert, ensureSettlementSideEffectsQueued, triggerWebhookSideEffectProcessor } = createHandler({
      verifiedStatus: createVerifiedStatus({ gross_amount: "149000.00" }),
    });

    const response = await handler(createRequest());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Amount mismatch" });
    expect(rpc).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(ensureSettlementSideEffectsQueued).not.toHaveBeenCalled();
    expect(triggerWebhookSideEffectProcessor).not.toHaveBeenCalled();
  });

  it("returns a safe failure when the transition is not persisted", async () => {
    const { adminClient, from, rpc, upsert } = createAdminClient();
    rpc.mockResolvedValueOnce({
      data: [{ applied: false, payment_status: "pending", order_status: "pending" }],
      error: null,
    });
    const ensureSettlementSideEffectsQueued = vi.fn(async () => true);
    const triggerWebhookSideEffectProcessor = vi.fn();
    const handler = createConfirmMidtransPaymentHandler({
      getAuthenticatedUserId: vi.fn(async () => "user-1"),
      getAdminClient: vi.fn(() => adminClient as never),
      getOrderById: vi.fn(async () => createOrder()),
      resolveRuntimeConfig: vi.fn(async () => ({
        serverKey: "server-key",
        isProduction: false,
        source: "active" as const,
        serverKeyVersionId: "server-key-version-id",
        serverKeyVersionNumber: 1,
        isProductionVersionId: "is-production-version-id",
        isProductionVersionNumber: 1,
      })),
      verifyTransaction: vi.fn(async () => createVerifiedStatus()),
      ensureSettlementSideEffectsQueued,
      triggerWebhookSideEffectProcessor,
      logError: vi.fn(),
    });

    const response = await handler(createRequest());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Transition was not persisted" });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith("payments");
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(ensureSettlementSideEffectsQueued).not.toHaveBeenCalled();
    expect(triggerWebhookSideEffectProcessor).not.toHaveBeenCalled();
  });

  it("rejects a verified non-IDR currency before transition, payment upsert, or side effects", async () => {
    const {
      handler,
      from,
      rpc,
      upsert,
      ensureSettlementSideEffectsQueued,
      triggerWebhookSideEffectProcessor,
    } = createHandler({
      verifiedStatus: createVerifiedStatus({ currency: "USD" }),
    });

    const response = await handler(createRequest());
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload).toEqual({
      error: "Currency mismatch",
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
    expect(ensureSettlementSideEffectsQueued).not.toHaveBeenCalled();
    expect(triggerWebhookSideEffectProcessor).not.toHaveBeenCalled();
  });


  it("redacts unexpected payment confirmation errors from caller responses", async () => {
    const logError = vi.fn();
    const handler = createConfirmMidtransPaymentHandler({
      getAuthenticatedUserId: vi.fn(async () => "user-1"),
      getAdminClient: vi.fn(() => createAdminClient().adminClient as never),
      getOrderById: vi.fn(async () => {
        throw new Error("relation payments leaked stack at public.apply_midtrans_webhook_transition");
      }),
      logError,
    });

    const response = await handler(createRequest());
    const payload = await response.json();
    const payloadText = JSON.stringify(payload);

    expect(response.status).toBe(500);
    expect(payload).toEqual({ error: "Payment confirmation failed" });
    expect(payloadText).not.toContain("payments");
    expect(payloadText).not.toContain("apply_midtrans_webhook_transition");
    expect(payloadText).not.toContain("stack");
    const loggedText = JSON.stringify(logError.mock.calls);
    expect(loggedText).toContain("payment_confirmation_failed");
    expect(loggedText).not.toContain("relation payments");
    expect(loggedText).not.toContain("apply_midtrans_webhook_transition");
    expect(loggedText).not.toContain("stack");
  });

  it("applies one transition, upserts payment, and triggers side effects for valid IDR settlement", async () => {
    const {
      handler,
      from,
      rpc,
      upsert,
      ensureSettlementSideEffectsQueued,
      triggerWebhookSideEffectProcessor,
    } = createHandler();

    const response = await handler(createRequest());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      confirmed: true,
      payment_status: "settlement",
      order_status: "processing",
      applied: true,
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("apply_midtrans_webhook_transition", expect.objectContaining({
      p_provider: "midtrans-manual-confirm",
      p_order_id: "order-1",
      p_next_payment_status: "settlement",
      p_next_order_status: "processing",
    }));
    expect(from).toHaveBeenCalledWith("payments");
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(ensureSettlementSideEffectsQueued).toHaveBeenCalledTimes(1);
    expect(ensureSettlementSideEffectsQueued).toHaveBeenCalledWith(expect.anything(), "order-1", "settlement", {
      transitionApplied: true,
    });
    expect(triggerWebhookSideEffectProcessor).toHaveBeenCalledTimes(1);
    expect(triggerWebhookSideEffectProcessor).toHaveBeenCalledWith("order-1");
  });
});
