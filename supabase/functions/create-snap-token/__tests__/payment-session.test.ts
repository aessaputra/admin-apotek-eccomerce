import { describe, expect, it, vi } from "vitest";

import {
  bindMidtransPaymentConfigVersions,
  persistPaymentSession,
} from "../payment-session.ts";
import type { Order } from "../../_shared/types.ts";

const SECRET_SENTINEL = "TEST_SENTINEL_MIDTRANS_SECRET_DO_NOT_STORE";

type PaymentMutation = {
  type: "insert" | "update";
  payload: Record<string, unknown>;
};

function createOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: "order-1",
    user_id: "user-1",
    status: "pending",
    payment_status: "pending",
    total_amount: 100_000,
    shipping_cost: 10_000,
    checkout_idempotency_key: "checkout-1",
    payment_type: null,
    expired_at: "2026-05-19T00:00:00.000Z",
    order_items: [],
    ...overrides,
  };
}

function createPaymentsClient(options: {
  existingPayment?: { id: string } | null;
  writtenPaymentId: string;
  lookupError?: { message: string } | null;
  writeError?: { message: string } | null;
  rpcError?: { message: string } | null;
}) {
  const mutations: PaymentMutation[] = [];

  const lookupQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn(async () => ({
      data: options.existingPayment ?? null,
      error: options.lookupError ?? null,
    })),
  };
  lookupQuery.select.mockReturnValue(lookupQuery);
  lookupQuery.eq.mockReturnValue(lookupQuery);
  lookupQuery.order.mockReturnValue(lookupQuery);
  lookupQuery.limit.mockReturnValue(lookupQuery);

  const writeQuery = {
    eq: vi.fn(),
    select: vi.fn(),
    single: vi.fn(async () => ({
      data: options.writeError ? null : { id: options.writtenPaymentId },
      error: options.writeError ?? null,
    })),
  };
  writeQuery.eq.mockReturnValue(writeQuery);
  writeQuery.select.mockReturnValue(writeQuery);

  const paymentsTable = {
    select: vi.fn(() => lookupQuery),
    update: vi.fn((payload: Record<string, unknown>) => {
      mutations.push({ type: "update", payload });
      return writeQuery;
    }),
    insert: vi.fn((payload: Record<string, unknown>) => {
      mutations.push({ type: "insert", payload });
      return writeQuery;
    }),
  };

  const adminClient = {
    from: vi.fn((tableName: string) => {
      expect(tableName).toBe("payments");
      return paymentsTable;
    }),
    rpc: vi.fn(async () => ({ data: [], error: options.rpcError ?? null })),
  };

  return { adminClient, mutations, paymentsTable, lookupQuery, writeQuery };
}

describe("create-snap-token payment session persistence", () => {
  it("binds the exact selected Midtrans config metadata when a new Snap token is stored", async () => {
    const { adminClient, mutations } = createPaymentsClient({
      existingPayment: null,
      writtenPaymentId: "payment-new",
    });

    await persistPaymentSession(adminClient, createOrder(), {
      midtransOrderId: "MIDTRANS-NEW",
      snapToken: "snap-token-placeholder",
      redirectUrl: "https://midtrans.test/snap-token-placeholder",
      snapTokenCreatedAt: "2026-05-18T00:00:00.000Z",
      grossAmount: 110_000,
      bindingSource: "snap_token_created",
      selectedConfig: {
        serverKeyVersionId: "00000000-0000-4000-8000-000000000101",
        serverKeyVersionNumber: 7,
        isProductionVersionId: "00000000-0000-4000-8000-000000000202",
        isProductionVersionNumber: 3,
        isProduction: true,
      },
    });

    expect(mutations).toHaveLength(1);
    expect(mutations[0]).toMatchObject({
      type: "insert",
      payload: {
        midtrans_order_id: "MIDTRANS-NEW",
        snap_token: "snap-token-placeholder",
        redirect_url: "https://midtrans.test/snap-token-placeholder",
        gross_amount: 110_000,
      },
    });
    expect(JSON.stringify(mutations)).not.toContain(SECRET_SENTINEL);
    expect(adminClient.rpc).toHaveBeenCalledWith(
      "bind_midtrans_payment_config_versions",
      {
        p_payment_id: "payment-new",
        p_midtrans_order_id: "MIDTRANS-NEW",
        p_binding_source: "snap_token_created",
        p_server_key_version_id: "00000000-0000-4000-8000-000000000101",
        p_server_key_version_number: 7,
        p_is_production_version_id: "00000000-0000-4000-8000-000000000202",
        p_is_production_version_number: 3,
        p_is_production: true,
      },
    );
    expect(JSON.stringify(adminClient.rpc.mock.calls)).not.toContain(SECRET_SENTINEL);
    expect(JSON.stringify(adminClient.rpc.mock.calls)).not.toMatch(/server[_-]?key["']?\s*:/i);
  });

  it("keeps reused Snap tokens on their existing config binding instead of passing active secrets", async () => {
    const { adminClient } = createPaymentsClient({
      existingPayment: { id: "payment-existing" },
      writtenPaymentId: "payment-existing",
    });

    await bindMidtransPaymentConfigVersions(adminClient, {
      paymentId: "payment-existing",
      midtransOrderId: "MIDTRANS-EXISTING",
      bindingSource: "snap_token_reuse",
    });

    expect(adminClient.rpc).toHaveBeenCalledWith(
      "bind_midtrans_payment_config_versions",
      {
        p_payment_id: "payment-existing",
        p_midtrans_order_id: "MIDTRANS-EXISTING",
        p_binding_source: "snap_token_reuse",
      },
    );
    expect(JSON.stringify(adminClient.rpc.mock.calls)).not.toContain(SECRET_SENTINEL);
    expect(JSON.stringify(adminClient.rpc.mock.calls)).not.toMatch(/server[_-]?key/i);
  });

  it("copies source binding metadata when a reused Snap token is persisted to another payment", async () => {
    const { adminClient, mutations } = createPaymentsClient({
      existingPayment: null,
      writtenPaymentId: "payment-target-after-rotation",
    });

    await persistPaymentSession(adminClient, createOrder({ id: "order-target" }), {
      midtransOrderId: "MIDTRANS-TARGET",
      snapToken: "source-snap-token-placeholder",
      redirectUrl: "https://midtrans.test/source-snap-token-placeholder",
      snapTokenCreatedAt: "2026-05-18T00:00:00.000Z",
      bindingSource: "snap_token_reuse",
      sourcePaymentId: "payment-source-before-rotation",
    });

    expect(mutations).toHaveLength(1);
    expect(mutations[0]).toMatchObject({
      type: "insert",
      payload: {
        midtrans_order_id: "MIDTRANS-TARGET",
        snap_token: "source-snap-token-placeholder",
      },
    });
    expect(adminClient.rpc).toHaveBeenCalledWith(
      "bind_midtrans_payment_config_versions",
      {
        p_payment_id: "payment-target-after-rotation",
        p_midtrans_order_id: "MIDTRANS-TARGET",
        p_binding_source: "snap_token_reuse",
        p_source_payment_id: "payment-source-before-rotation",
      },
    );
    expect(JSON.stringify(adminClient.rpc.mock.calls)).not.toContain(SECRET_SENTINEL);
  });
});
