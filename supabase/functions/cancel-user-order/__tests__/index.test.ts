import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCancelUserOrderHandler } from "../handler.ts";
import type { MidtransStatusResponse, Order } from "../../_shared/types.ts";

function createRequest(body: unknown = { order_id: "order-1" }, method = "POST") {
  return new Request("https://example.test/functions/v1/cancel-user-order", {
    method,
    headers: {
      Authorization: "Bearer user-token",
      "Content-Type": "application/json",
    },
    body: method === "POST" ? JSON.stringify(body) : undefined,
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
    midtrans_order_id: "MIDTRANS-CANCEL-ORDER",
    ...overrides,
  };
}

function createVerifiedStatus(overrides: Partial<MidtransStatusResponse> = {}): MidtransStatusResponse {
  return {
    order_id: "MIDTRANS-CANCEL-ORDER",
    transaction_id: "transaction-cancel",
    transaction_status: "cancel",
    fraud_status: "",
    status_code: "200",
    gross_amount: "150000.00",
    payment_type: "bank_transfer",
    ...overrides,
  };
}

function createAdminClient() {
  const transitionRpc = vi.fn(async () => ({
    data: [{ applied: true, payment_status: "cancel", order_status: "cancelled" }],
    error: null,
  }));
  const paymentsUpsert = vi.fn(async () => ({ error: null }));
  const existingPaymentMaybeSingle = vi.fn(async () => ({ data: null, error: null }));
  const from = vi.fn((tableName: string) => {
    if (tableName === "payments") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: () => ({
              order: () => ({
                limit: () => ({ maybeSingle: existingPaymentMaybeSingle }),
              }),
            }),
          })),
        })),
        upsert: paymentsUpsert,
      };
    }

    throw new Error(`Unexpected table: ${tableName}`);
  });

  return {
    adminClient: { from, rpc: transitionRpc },
    transitionRpc,
    paymentsUpsert,
    from,
  };
}

describe("cancel-user-order Midtrans currency validation", () => {
  let admin: ReturnType<typeof createAdminClient>;
  let getAuthenticatedUserId: ReturnType<typeof vi.fn>;
  let getOrderById: ReturnType<typeof vi.fn>;
  let verifyTransaction: ReturnType<typeof vi.fn>;
  let cancelTransaction: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    admin = createAdminClient();
    getAuthenticatedUserId = vi.fn(async () => "user-1");
    getOrderById = vi.fn(async () => createOrder());
    verifyTransaction = vi.fn(async () => createVerifiedStatus());
    cancelTransaction = vi.fn(async () => undefined);
  });


  it("rejects unauthenticated requests before loading orders", async () => {
    const handler = createCancelUserOrderHandler({
      getAuthenticatedUserId: vi.fn(async () => null) as never,
      getAdminClient: () => admin.adminClient as never,
      getOrderById: getOrderById as never,
    });

    const response = await handler(createRequest());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(getOrderById).not.toHaveBeenCalled();
  });

  it("rejects malformed request bodies before DB access", async () => {
    const handler = createCancelUserOrderHandler({
      getAuthenticatedUserId: getAuthenticatedUserId as never,
      getAdminClient: () => admin.adminClient as never,
      getOrderById: getOrderById as never,
    });

    const response = await handler(createRequest({ order_id: " " }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "order_id is required" });
    expect(getOrderById).not.toHaveBeenCalled();
  });

  it("rejects non-owner cancellation before mutations", async () => {
    getOrderById.mockResolvedValue(createOrder({ user_id: "other-user" }));
    const handler = createCancelUserOrderHandler({
      getAuthenticatedUserId: getAuthenticatedUserId as never,
      getAdminClient: () => admin.adminClient as never,
      getOrderById: getOrderById as never,
    });

    const response = await handler(createRequest());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
    expect(admin.transitionRpc).not.toHaveBeenCalled();
    expect(admin.paymentsUpsert).not.toHaveBeenCalled();
  });

  it("allows banned-user policy safe default by still cancelling an unpaid owned order", async () => {
    getOrderById.mockResolvedValue(createOrder({ midtrans_order_id: null }));
    const orderUpdate = vi.fn(() => ({
      eq: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
    }));
    const paymentUpdate = vi.fn(() => ({
      eq: vi.fn(() => ({ in: vi.fn(async () => ({ error: null })) })),
    }));
    const from = vi.fn((tableName: string) => {
      if (tableName === "orders") {
        return { update: orderUpdate };
      }
      if (tableName === "payments") {
        return { update: paymentUpdate };
      }
      throw new Error(`Unexpected table: ${tableName}`);
    });
    const handler = createCancelUserOrderHandler({
      getAuthenticatedUserId: getAuthenticatedUserId as never,
      getAdminClient: () => ({ from, rpc: admin.transitionRpc }) as never,
      getOrderById: getOrderById as never,
    });

    const response = await handler(createRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      cancelled: true,
      order_status: "cancelled",
      payment_status: "cancel",
      applied: true,
    });
    expect(orderUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: "cancelled" }));
    expect(paymentUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: "cancel" }));
  });

  it("returns provider config failure without transition or payment upsert", async () => {
    const handler = createCancelUserOrderHandler({
      getAuthenticatedUserId: getAuthenticatedUserId as never,
      getAdminClient: () => admin.adminClient as never,
      getOrderById: getOrderById as never,
      resolveRuntimeConfig: vi.fn(async () => {
        const { MidtransRuntimeConfigError } = await import("../../_shared/midtrans.ts");
        throw new MidtransRuntimeConfigError("missing");
      }) as never,
      verifyTransaction: verifyTransaction as never,
      cancelTransaction: cancelTransaction as never,
    });

    const response = await handler(createRequest());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Midtrans runtime config unavailable" });
    expect(verifyTransaction).not.toHaveBeenCalled();
    expect(admin.transitionRpc).not.toHaveBeenCalled();
    expect(admin.paymentsUpsert).not.toHaveBeenCalled();
  });

  it("rejects a terminal Midtrans cancellation without verified currency before transition or payment upsert", async () => {
    const handler = createCancelUserOrderHandler({
      getAuthenticatedUserId: getAuthenticatedUserId as never,
      getAdminClient: () => admin.adminClient as never,
      getOrderById: getOrderById as never,
      resolveRuntimeConfig: vi.fn(async () => ({
        serverKey: "server-key",
        isProduction: false,
        source: "active" as const,
        serverKeyVersionId: "server-key-version-id",
        serverKeyVersionNumber: 1,
        isProductionVersionId: "is-production-version-id",
        isProductionVersionNumber: 1,
      })),
      verifyTransaction: verifyTransaction as never,
      cancelTransaction: cancelTransaction as never,
    });

    const response = await handler(createRequest());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({ error: "Currency validation failed" });
    expect(admin.transitionRpc).not.toHaveBeenCalled();
    expect(admin.paymentsUpsert).not.toHaveBeenCalled();
    expect(cancelTransaction).not.toHaveBeenCalled();
  });

  it("rejects a cancellable Midtrans status with mismatched verified currency before provider cancel", async () => {
    verifyTransaction.mockResolvedValue(
      createVerifiedStatus({
        transaction_status: "pending",
        currency: "USD",
      }),
    );
    const handler = createCancelUserOrderHandler({
      getAuthenticatedUserId: getAuthenticatedUserId as never,
      getAdminClient: () => admin.adminClient as never,
      getOrderById: getOrderById as never,
      resolveRuntimeConfig: vi.fn(async () => ({
        serverKey: "server-key",
        isProduction: false,
        source: "active" as const,
        serverKeyVersionId: "server-key-version-id",
        serverKeyVersionNumber: 1,
        isProductionVersionId: "is-production-version-id",
        isProductionVersionNumber: 1,
      })),
      verifyTransaction: verifyTransaction as never,
      cancelTransaction: cancelTransaction as never,
    });

    const response = await handler(createRequest());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({ error: "Currency mismatch" });
    expect(cancelTransaction).not.toHaveBeenCalled();
    expect(admin.transitionRpc).not.toHaveBeenCalled();
    expect(admin.paymentsUpsert).not.toHaveBeenCalled();
  });

  it("redacts provider failure details from generic 500 responses and logs", async () => {
    const rawSentinel = "Midtrans cancel failed: provider secret sentinel";
    verifyTransaction.mockResolvedValue(
      createVerifiedStatus({
        transaction_status: "pending",
        currency: "IDR",
      }),
    );
    cancelTransaction.mockRejectedValue(new Error(rawSentinel));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const handler = createCancelUserOrderHandler({
      getAuthenticatedUserId: getAuthenticatedUserId as never,
      getAdminClient: () => admin.adminClient as never,
      getOrderById: getOrderById as never,
      resolveRuntimeConfig: vi.fn(async () => ({
        serverKey: "server-key",
        isProduction: false,
        source: "active" as const,
        serverKeyVersionId: "server-key-version-id",
        serverKeyVersionNumber: 1,
        isProductionVersionId: "is-production-version-id",
        isProductionVersionNumber: 1,
      })),
      verifyTransaction: verifyTransaction as never,
      cancelTransaction: cancelTransaction as never,
    });

    try {
      const response = await handler(createRequest());
      const body = await response.json();
      const serializedLogs = JSON.stringify(consoleError.mock.calls);

      expect(response.status).toBe(500);
      expect(body).toEqual({ error: "Order cancellation failed" });
      expect(JSON.stringify(body)).not.toContain(rawSentinel);
      expect(serializedLogs).not.toContain(rawSentinel);
    } finally {
      consoleError.mockRestore();
    }
  });
});
