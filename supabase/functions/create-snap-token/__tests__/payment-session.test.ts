import { describe, expect, it, vi } from "vitest";

import {
  bindMidtransPaymentConfigVersions,
  PaymentSessionError,
  persistPaymentSession,
} from "../payment-session.ts";
import type { Order } from "../../_shared/types.ts";

const SECRET_SENTINEL = "TEST_SENTINEL_MIDTRANS_SECRET_DO_NOT_STORE";

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
  rpcError?: { message: string } | null;
}) {
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

  const paymentsTable = {
    select: vi.fn(() => lookupQuery),
  };

  const adminClient = {
    from: vi.fn((tableName: string) => {
      expect(tableName).toBe("payments");
      return paymentsTable;
    }),
    rpc: vi.fn(async (name: string, args?: Record<string, unknown>) => {
      if (name === "persist_midtrans_payment_session") {
        return {
          data: options.rpcError
            ? null
            : [{
              id: options.writtenPaymentId,
              midtrans_order_id: args?.p_midtrans_order_id,
              snap_token: args?.p_snap_token,
              redirect_url: args?.p_redirect_url,
              snap_token_created_at: args?.p_snap_token_created_at,
            }],
          error: options.rpcError ?? null,
        };
      }

      return { data: [], error: options.rpcError ?? null };
    }),
  };

  return { adminClient, paymentsTable, lookupQuery };
}

describe("create-snap-token payment session persistence", () => {
  it("binds the exact selected Midtrans config metadata when a new Snap token is stored", async () => {
    const { adminClient } = createPaymentsClient({
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

    expect(adminClient.from).not.toHaveBeenCalled();
    expect(adminClient.rpc).toHaveBeenCalledWith(
      "persist_midtrans_payment_session",
      {
        p_order_id: "order-1",
        p_user_id: "user-1",
        p_checkout_idempotency_key: "checkout-1",
        p_midtrans_order_id: "MIDTRANS-NEW",
        p_status: "pending",
        p_payment_type: null,
        p_gross_amount: 110_000,
        p_expiry_time: "2026-05-19T00:00:00.000Z",
        p_snap_token: "snap-token-placeholder",
        p_redirect_url: "https://midtrans.test/snap-token-placeholder",
        p_snap_token_created_at: "2026-05-18T00:00:00.000Z",
        p_binding_source: "snap_token_created",
        p_source_payment_id: null,
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
      sourcePaymentId: "payment-existing",
    });

    expect(adminClient.rpc).toHaveBeenCalledWith(
      "bind_midtrans_payment_config_versions",
      {
        p_payment_id: "payment-existing",
        p_midtrans_order_id: "MIDTRANS-EXISTING",
        p_binding_source: "snap_token_reuse",
        p_source_payment_id: "payment-existing",
      },
    );
    expect(JSON.stringify(adminClient.rpc.mock.calls)).not.toContain(SECRET_SENTINEL);
    expect(JSON.stringify(adminClient.rpc.mock.calls)).not.toMatch(/server[_-]?key/i);
  });

  it("copies source binding metadata when a reused Snap token is persisted to another payment", async () => {
    const { adminClient } = createPaymentsClient({
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

    expect(adminClient.from).not.toHaveBeenCalled();
    expect(adminClient.rpc).toHaveBeenCalledWith(
      "persist_midtrans_payment_session",
      {
        p_order_id: "order-target",
        p_user_id: "user-1",
        p_checkout_idempotency_key: "checkout-1",
        p_midtrans_order_id: "MIDTRANS-TARGET",
        p_status: "pending",
        p_payment_type: null,
        p_gross_amount: 110_000,
        p_expiry_time: "2026-05-19T00:00:00.000Z",
        p_snap_token: "source-snap-token-placeholder",
        p_redirect_url: "https://midtrans.test/source-snap-token-placeholder",
        p_snap_token_created_at: "2026-05-18T00:00:00.000Z",
        p_binding_source: "snap_token_reuse",
        p_source_payment_id: "payment-source-before-rotation",
        p_server_key_version_id: null,
        p_server_key_version_number: null,
        p_is_production_version_id: null,
        p_is_production_version_number: null,
        p_is_production: null,
      },
    );
    expect(JSON.stringify(adminClient.rpc.mock.calls)).not.toContain(SECRET_SENTINEL);
  });

  it("rejects reused Snap token persistence without source payment metadata", async () => {
    const { adminClient } = createPaymentsClient({
      existingPayment: null,
      writtenPaymentId: "payment-reuse-unbound",
    });

    await expect(
      persistPaymentSession(adminClient, createOrder(), {
        midtransOrderId: "MIDTRANS-REUSE-UNBOUND",
        snapToken: "source-snap-token-placeholder",
        redirectUrl: "https://midtrans.test/source-snap-token-placeholder",
        snapTokenCreatedAt: "2026-05-18T00:00:00.000Z",
        bindingSource: "snap_token_reuse",
      } as Parameters<typeof persistPaymentSession>[2]),
    ).rejects.toMatchObject({
      status: 500,
      message: "Reused Midtrans Snap sessions require source payment metadata",
    } satisfies Partial<PaymentSessionError>);

    expect(adminClient.from).not.toHaveBeenCalled();
    expect(adminClient.rpc).not.toHaveBeenCalled();
  });

  it("rejects Midtrans session writes without an explicit config binding", async () => {
    const { adminClient } = createPaymentsClient({
      existingPayment: null,
      writtenPaymentId: "payment-unbound",
    });

    await expect(
      persistPaymentSession(adminClient, createOrder(), {
        midtransOrderId: "MIDTRANS-UNBOUND",
      } as Parameters<typeof persistPaymentSession>[2]),
    ).rejects.toMatchObject({
      status: 500,
      message: "Midtrans payment sessions require config binding metadata",
    } satisfies Partial<PaymentSessionError>);

    expect(adminClient.from).not.toHaveBeenCalled();
    expect(adminClient.rpc).not.toHaveBeenCalled();
  });

});
