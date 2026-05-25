import { describe, expect, it, vi } from "vitest";
import { createReconcilePendingMidtransPaymentsHandler } from "../handler.ts";
import type { MidtransStatusResponse, Order } from "../../_shared/types.ts";

function createRequest(limit: unknown = 1, headers: Record<string, string> = { Authorization: "Bearer service-role-key" }) {
  return new Request("https://example.test/functions/v1/reconcile-pending-midtrans-payments", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify({ limit }),
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
    snap_token: "snap-token",
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

  return { adminClient: { from, rpc }, from, rpc, upsert };
}

function createHandler(options?: {
  orders?: Order[];
  verifiedStatus?: MidtransStatusResponse;
  queueSideEffects?: boolean;
}) {
  const { adminClient, from, rpc, upsert } = createAdminClient();
  const getAdminClient = vi.fn(() => adminClient as never);
  const reconcileMidtransOrphans = vi.fn(async () => undefined);
  const listPendingOrders = vi.fn(async () => options?.orders ?? [createOrder()]);
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
    handler: createReconcilePendingMidtransPaymentsHandler({
      getServiceRoleKey: () => "service-role-key",
      getAdminClient,
      reconcileMidtransOrphans,
      listPendingOrders,
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

describe("reconcile-pending-midtrans-payments handler currency validation", () => {

  it("rejects missing service-role bearer before DB access", async () => {
    const { adminClient, from, rpc } = createAdminClient();
    const handler = createReconcilePendingMidtransPaymentsHandler({
      getServiceRoleKey: () => "service-role-key",
      getAdminClient: vi.fn(() => adminClient as never),
    });

    const response = await handler(createRequest(1, {}));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("uses the default limit for malformed limit payloads and returns an empty happy path", async () => {
    const { adminClient } = createAdminClient();
    const listPendingOrders = vi.fn(async () => []);
    const handler = createReconcilePendingMidtransPaymentsHandler({
      getServiceRoleKey: () => "service-role-key",
      getAdminClient: vi.fn(() => adminClient as never),
      reconcileMidtransOrphans: vi.fn(async () => undefined),
      listPendingOrders,
    });

    const response = await handler(createRequest("not-a-number"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      processed_count: 0,
      reconciled_count: 0,
      results: [],
    });
    expect(listPendingOrders).toHaveBeenCalledWith(adminClient, 10);
  });

  it("records a safe transition failure without payment upsert or side effects", async () => {
    const { adminClient, rpc, upsert } = createAdminClient();
    const transitionFailure = { data: null, error: { message: "transition failed" } } as unknown as Awaited<ReturnType<typeof rpc>>;
    rpc.mockResolvedValueOnce(transitionFailure);
    const ensureSettlementSideEffectsQueued = vi.fn(async () => true);
    const triggerWebhookSideEffectProcessor = vi.fn();
    const logError = vi.fn();
    const handler = createReconcilePendingMidtransPaymentsHandler({
      getServiceRoleKey: () => "service-role-key",
      getAdminClient: vi.fn(() => adminClient as never),
      reconcileMidtransOrphans: vi.fn(async () => undefined),
      listPendingOrders: vi.fn(async () => [createOrder()]),
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
      logError,
    });

    const response = await handler(createRequest());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      processed_count: 1,
      reconciled_count: 0,
      results: [{
        orderId: "order-1",
        reconciled: false,
        message: "Payment reconciliation failed",
      }],
    });
    expect(upsert).not.toHaveBeenCalled();
    expect(ensureSettlementSideEffectsQueued).not.toHaveBeenCalled();
    expect(triggerWebhookSideEffectProcessor).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith("pending_order_reconciliation_failed");
  });

  it("records a safe failure for a verified non-IDR currency without transition, payment upsert, or side effects", async () => {
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

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      processed_count: 1,
      reconciled_count: 0,
      results: [{
        orderId: "order-1",
        reconciled: false,
        message: "Currency mismatch",
      }],
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
    expect(ensureSettlementSideEffectsQueued).not.toHaveBeenCalled();
    expect(triggerWebhookSideEffectProcessor).not.toHaveBeenCalled();
  });

  it("records a safe failure for a missing verified currency without transition, payment upsert, or side effects", async () => {
    const {
      handler,
      from,
      rpc,
      upsert,
      ensureSettlementSideEffectsQueued,
      triggerWebhookSideEffectProcessor,
    } = createHandler({
      verifiedStatus: createVerifiedStatus({ currency: "" }),
    });

    const response = await handler(createRequest());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      processed_count: 1,
      reconciled_count: 0,
      results: [{
        orderId: "order-1",
        reconciled: false,
        message: "Currency validation failed",
      }],
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
    expect(ensureSettlementSideEffectsQueued).not.toHaveBeenCalled();
    expect(triggerWebhookSideEffectProcessor).not.toHaveBeenCalled();
  });

  it("records a safe failure for an absent verified currency without transition, payment upsert, or side effects", async () => {
    const {
      handler,
      from,
      rpc,
      upsert,
      ensureSettlementSideEffectsQueued,
      triggerWebhookSideEffectProcessor,
    } = createHandler({
      verifiedStatus: createVerifiedStatus({ currency: undefined }),
    });

    const response = await handler(createRequest());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      processed_count: 1,
      reconciled_count: 0,
      results: [{
        orderId: "order-1",
        reconciled: false,
        message: "Currency validation failed",
      }],
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
    expect(ensureSettlementSideEffectsQueued).not.toHaveBeenCalled();
    expect(triggerWebhookSideEffectProcessor).not.toHaveBeenCalled();
  });


  it("redacts unexpected reconciliation handler errors from caller responses", async () => {
    const logError = vi.fn();
    const { adminClient } = createAdminClient();
    const handler = createReconcilePendingMidtransPaymentsHandler({
      getServiceRoleKey: () => "service-role-key",
      getAdminClient: vi.fn(() => adminClient as never),
      reconcileMidtransOrphans: vi.fn(async () => undefined),
      listPendingOrders: vi.fn(async () => {
        throw new Error("select from order_read_model failed: permission denied for schema public");
      }),
      logError,
    });

    const response = await handler(createRequest());
    const payload = await response.json();
    const payloadText = JSON.stringify(payload);

    expect(response.status).toBe(500);
    expect(payload).toEqual({ error: "Pending payment reconciliation failed" });
    expect(payloadText).not.toContain("order_read_model");
    expect(payloadText).not.toContain("permission denied");
    expect(payloadText).not.toContain("schema public");
    const loggedText = JSON.stringify(logError.mock.calls);
    expect(loggedText).toContain("pending_payment_reconciliation_failed");
    expect(loggedText).not.toContain("order_read_model");
    expect(loggedText).not.toContain("permission denied");
    expect(loggedText).not.toContain("schema public");
  });


  it("redacts per-order reconciliation errors from successful batch responses", async () => {
    const logError = vi.fn();
    const { adminClient } = createAdminClient();
    const handler = createReconcilePendingMidtransPaymentsHandler({
      getServiceRoleKey: () => "service-role-key",
      getAdminClient: vi.fn(() => adminClient as never),
      reconcileMidtransOrphans: vi.fn(async () => undefined),
      listPendingOrders: vi.fn(async () => [createOrder()]),
      resolveRuntimeConfig: vi.fn(async () => ({
        serverKey: "server-key",
        isProduction: false,
        source: "active" as const,
        serverKeyVersionId: "server-key-version-id",
        serverKeyVersionNumber: 1,
        isProductionVersionId: "is-production-version-id",
        isProductionVersionNumber: 1,
      })),
      verifyTransaction: vi.fn(async () => {
        throw new Error("select from payments failed: relation public.payments stack trace");
      }),
      logError,
    });

    const response = await handler(createRequest());
    const payload = await response.json();
    const payloadText = JSON.stringify(payload);

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      processed_count: 1,
      reconciled_count: 0,
      results: [{
        orderId: "order-1",
        reconciled: false,
        message: "Payment reconciliation failed",
      }],
    });
    expect(payloadText).not.toContain("public.payments");
    expect(payloadText).not.toContain("stack trace");
    const loggedText = JSON.stringify(logError.mock.calls);
    expect(loggedText).toContain("pending_order_reconciliation_failed");
    expect(loggedText).not.toContain("public.payments");
    expect(loggedText).not.toContain("stack trace");
  });


  it("redacts orphan reconciliation RPC errors from logs", async () => {
    const logOrphanError = vi.fn();
    const { adminClient, rpc } = createAdminClient();
    rpc.mockResolvedValueOnce(({
      data: null,
      error: { message: "reconcile_midtrans_orphan_notifications failed: permission denied for schema public" },
    } as unknown) as Awaited<ReturnType<typeof rpc>>);
    const handler = createReconcilePendingMidtransPaymentsHandler({
      getServiceRoleKey: () => "service-role-key",
      getAdminClient: vi.fn(() => adminClient as never),
      listPendingOrders: vi.fn(async () => []),
      logOrphanError,
    });

    const response = await handler(createRequest());
    const payload = await response.json();
    const loggedText = JSON.stringify(logOrphanError.mock.calls);

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      processed_count: 0,
      reconciled_count: 0,
      results: [],
    });
    expect(loggedText).toContain("midtrans_orphan_reconciliation_failed");
    expect(loggedText).not.toContain("reconcile_midtrans_orphan_notifications");
    expect(loggedText).not.toContain("permission denied");
    expect(loggedText).not.toContain("schema public");
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
      processed_count: 1,
      reconciled_count: 1,
      results: [{
        orderId: "order-1",
        reconciled: true,
        applied: true,
        paymentStatus: "settlement",
      }],
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("apply_midtrans_webhook_transition", expect.objectContaining({
      p_provider: "midtrans-reconcile",
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
