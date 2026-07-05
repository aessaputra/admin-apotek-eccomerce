import { beforeEach, describe, expect, it, vi } from "vitest";

const midtransMocks = vi.hoisted(() => ({
  resolveMidtransTransactionRuntimeConfig: vi.fn(async () => ({
    serverKey: "server-key",
    isProduction: false,
    source: "active" as const,
    serverKeyVersionId: "server-key-version-id",
    serverKeyVersionNumber: 1,
    isProductionVersionId: "is-production-version-id",
    isProductionVersionNumber: 1,
  })),
  verifyMidtransTransaction: vi.fn(),
  cancelMidtransTransaction: vi.fn(async () => undefined),
}));

const biteshipMocks = vi.hoisted(() => ({
  resolveBiteshipApiKeyFromRuntimeConfig: vi.fn(async () => "test-biteship-key"),
  cancelBiteshipOrder: vi.fn(async () => undefined),
}));

vi.mock("../../_shared/midtrans.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../_shared/midtrans.ts")>();
  return {
    ...actual,
    resolveMidtransTransactionRuntimeConfig:
      midtransMocks.resolveMidtransTransactionRuntimeConfig,
    verifyMidtransTransaction: midtransMocks.verifyMidtransTransaction,
    cancelMidtransTransaction: midtransMocks.cancelMidtransTransaction,
  };
});

vi.mock("../../_shared/biteship.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../_shared/biteship.ts")>();
  return {
    ...actual,
    resolveBiteshipApiKeyFromRuntimeConfig: biteshipMocks.resolveBiteshipApiKeyFromRuntimeConfig,
    cancelBiteshipOrder: biteshipMocks.cancelBiteshipOrder,
  };
});

vi.stubGlobal("Deno", {
  env: { get: vi.fn(() => undefined) },
});

const { createOrderManagerHandler } = await import("../handler.ts");

function createAbortError(): DOMException {
  return new DOMException("Biteship request aborted", "AbortError");
}

function createRequest(body: unknown = {
  action: "transition_status",
  orderId: "order-1",
  payload: { to: "cancelled" },
}) {
  return new Request("https://example.test/functions/v1/order-manager", {
    method: "POST",
    headers: {
      Authorization: "Bearer admin-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function pickSelectedColumns<Row extends Record<string, unknown>>(
  row: Row,
  selectedColumns: string,
): Partial<Row> {
  return Object.fromEntries(
    selectedColumns
      .split(",")
      .map((column) => column.trim())
      .filter(Boolean)
      .map((column) => [column, row[column]]),
  ) as Partial<Row>;
}

function createAdminClient(orderOverrides: Record<string, unknown> = {}) {
  const ordersUpdate = vi.fn(() => ({
    eq: () => ({
      eq: () => ({
        select: () => ({
          single: async () => ({
            data: { id: "order-1", status: "cancelled", updated_at: "2026-05-24T00:00:00.000Z" },
            error: null,
          }),
        }),
      }),
    }),
  }));
  const paymentsUpdate = vi.fn(() => ({
    eq: async () => ({ error: null }),
  }));
  const activityInsert = vi.fn(async () => ({ error: null }));
  const shipmentMaybeSingle = vi.fn(async () => ({ data: null, error: null }));
  const shipmentUpsert = vi.fn(async () => ({ error: null }));
  const notificationInsert = vi.fn(async () => ({ error: null }));
  const sideEffectTaskMaybeSingle = vi.fn(async () => ({ data: null, error: null }));
  const sideEffectTaskEq = vi.fn(() => ({ maybeSingle: sideEffectTaskMaybeSingle }));
  const sideEffectTaskSelect = vi.fn(() => ({ eq: sideEffectTaskEq }));
  const sideEffectTaskUpsert = vi.fn(async () => ({ error: null }));
  const stockDeductionRows: Array<{ product_id: string }> = orderOverrides.stockDeductionRows as Array<{ product_id: string }> ?? [];
  const stockDeductionSelect = vi.fn(() => ({
    eq: vi.fn(() => ({ data: stockDeductionRows, error: null })),
  }));
  const orderRow = {
    id: "order-1",
    user_id: "user-1",
    status: "processing",
    payment_status: "pending",
    midtrans_order_id: "MIDTRANS-MANAGER-ORDER",
    waybill_number: null,
    waybill_source: null,
    biteship_order_id: null,
    biteship_tracking_id: null,
    ...orderOverrides,
  };
  const orderSingle = vi.fn(async (selectedColumns: string) => ({
    data: pickSelectedColumns(orderRow, selectedColumns),
    error: null,
  }));
  const orderReadModelSelect = vi.fn((selectedColumns: string) => ({
    eq: vi.fn(() => ({ single: () => orderSingle(selectedColumns) })),
  }));

  const from = vi.fn((tableName: string) => {
    if (tableName === "order_read_model") {
      return {
        select: orderReadModelSelect,
      };
    }

    if (tableName === "shipments") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle: shipmentMaybeSingle })),
        })),
        upsert: shipmentUpsert,
      };
    }

    if (tableName === "orders") {
      return { update: ordersUpdate };
    }

    if (tableName === "payments") {
      return { 
        update: paymentsUpdate,
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(async () => ({ data: { currency: orderOverrides.currency ?? "IDR" }, error: null }))
          }))
        }))
      };
    }

    if (tableName === "order_activities") {
      return { insert: activityInsert };
    }

    if (tableName === "notifications") {
      return { insert: notificationInsert };
    }

    if (tableName === "webhook_side_effect_tasks") {
      return {
        select: sideEffectTaskSelect,
        upsert: sideEffectTaskUpsert,
      };
    }

    if (tableName === "order_item_stock_deductions") {
      return {
        select: stockDeductionSelect,
      };
    }

    throw new Error(`Unexpected table: ${tableName}`);
  });

  const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
    if (name === "get_runtime_integration_config_versions") {
      const keyNames = (args?.p_key_names ?? []) as string[];
      return {
        data: keyNames.includes("biteship.api_key")
          ? [{
            key_name: "biteship.api_key",
            value_kind: "secret",
            is_secret: true,
            is_required: true,
            is_runtime_required: true,
            version_id: "version-biteship-api-key",
            version_number: 1,
            status: "active",
            runtime_value: "runtime-biteship-key-sentinel",
            masked_value: "runt********************inel",
            value_fingerprint: "fingerprint",
            updated_at: "2026-05-25T00:00:00.000Z",
          }]
          : [],
        error: null,
      };
    }

    if (name === "reverse_order_item_stock_deduction") {
      return { data: null, error: null };
    }

    return { data: null, error: null };
  });

  return {
    adminClient: { from, rpc },
    orderSingle,
    ordersUpdate,
    paymentsUpdate,
    activityInsert,
    shipmentUpsert,
    notificationInsert,
    sideEffectTaskMaybeSingle,
    sideEffectTaskEq,
    sideEffectTaskSelect,
    sideEffectTaskUpsert,
    from,
    orderReadModelSelect,
    rpc,
    stockDeductionSelect,
  };
}

describe("order-manager Midtrans cancellation currency validation", () => {
  beforeEach(() => {
    midtransMocks.resolveMidtransTransactionRuntimeConfig.mockClear();
    midtransMocks.verifyMidtransTransaction.mockReset();
    midtransMocks.verifyMidtransTransaction.mockResolvedValue({
      order_id: "MIDTRANS-MANAGER-ORDER",
      transaction_id: "transaction-cancel",
      transaction_status: "cancel",
      fraud_status: "",
      status_code: "200",
      gross_amount: "150000.00",
      payment_type: "bank_transfer",
      currency: " ",
    });
    midtransMocks.cancelMidtransTransaction.mockClear();
  });


  it("rejects non-admin requests before DB access", async () => {
    const admin = createAdminClient();
    const handler = createOrderManagerHandler({
      requireAdmin: vi.fn(async () => {
        throw new Error("Forbidden: Admin role required");
      }),
      getAdminClient: () => admin.adminClient as never,
    });

    const response = await handler(createRequest());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden: Admin role required" });
    expect(admin.orderReadModelSelect).not.toHaveBeenCalled();
  });

  it("rejects malformed transition requests before loading orders", async () => {
    const admin = createAdminClient();
    const handler = createOrderManagerHandler({
      requireAdmin: vi.fn(async () => ({ userId: "admin-user" })),
      getAdminClient: () => admin.adminClient as never,
    });

    const response = await handler(createRequest({ action: "transition_status" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "action and orderId are required" });
    expect(admin.orderReadModelSelect).not.toHaveBeenCalled();
  });

  it("returns order not found for order read DB failures", async () => {
    const admin = createAdminClient();
    admin.orderSingle.mockResolvedValueOnce(({ data: null, error: { message: "read failed" } } as unknown) as Awaited<ReturnType<typeof admin.orderSingle>>);
    const handler = createOrderManagerHandler({
      requireAdmin: vi.fn(async () => ({ userId: "admin-user" })),
      getAdminClient: () => admin.adminClient as never,
    });

    const response = await handler(createRequest());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Order not found" });
    expect(admin.ordersUpdate).not.toHaveBeenCalled();
  });

  it("transitions a valid settled order to awaiting shipment and queues fulfillment side effects", async () => {
    const admin = createAdminClient({
      status: "processing",
      payment_status: "settlement",
      biteship_order_id: null,
    });
    const consoleErrorSpy = vi.spyOn(console, "error");
    const handler = createOrderManagerHandler({
      requireAdmin: vi.fn(async () => ({ userId: "admin-user" })),
      getAdminClient: () => admin.adminClient as never,
    });

    const response = await handler(createRequest({
      action: "transition_status",
      orderId: "order-1",
      payload: { to: "awaiting_shipment" },
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      success: true,
      data: { id: "order-1", status: "cancelled", updated_at: "2026-05-24T00:00:00.000Z" },
    });
    expect(admin.ordersUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: "awaiting_shipment" }));
    expect(admin.activityInsert).toHaveBeenCalledWith(expect.objectContaining({
      order_id: "order-1",
      action: "status_update",
      actor_id: "admin-user",
    }));
    expect(admin.shipmentUpsert).toHaveBeenCalledWith(expect.objectContaining({
      order_id: "order-1",
      status: "awaiting_shipment",
    }), { onConflict: "order_id" });
    expect(admin.notificationInsert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: "user-1",
      type: "order_awaiting_shipment",
    }));
    expect(admin.from).toHaveBeenCalledWith("webhook_side_effect_tasks");
    expect(admin.sideEffectTaskSelect).toHaveBeenCalledWith(expect.stringContaining("needs_biteship"));
    expect(admin.sideEffectTaskEq).toHaveBeenCalledWith("order_id", "order-1");
    expect(admin.sideEffectTaskMaybeSingle).toHaveBeenCalledTimes(2);
    expect(admin.sideEffectTaskUpsert).toHaveBeenCalledWith(expect.objectContaining({
      order_id: "order-1",
      needs_cart_cleanup: false,
      needs_stock: false,
      needs_biteship: true,
    }), { onConflict: "order_id" });
    expect(consoleErrorSpy.mock.calls.some((call) => String(call[0]).includes("Failed to enqueue biteship side effect"))).toBe(false);
    consoleErrorSpy.mockRestore();
  });

  it("retries transient Biteship tracking failures before mutating shipment state", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "temporary" }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: "picked",
        waybill: "WAYBILL-1",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: "picked",
        waybill: "WAYBILL-1",
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const admin = createAdminClient({
      status: "awaiting_shipment",
      payment_status: "settlement",
      biteship_order_id: "biteship-order-1",
      biteship_tracking_id: "tracking-1",
    });
    const handler = createOrderManagerHandler({
      requireAdmin: vi.fn(async () => ({ userId: "admin-user" })),
      getAdminClient: () => admin.adminClient as never,
    });

    const response = await handler(createRequest({
      action: "sync_tracking",
      orderId: "order-1",
    }));

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(admin.ordersUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: "shipped" }));
    expect(admin.shipmentUpsert).toHaveBeenCalledWith(expect.objectContaining({
      order_id: "order-1",
      status: "shipped",
      biteship_tracking_id: "tracking-1",
      waybill_number: "WAYBILL-1",
    }), { onConflict: "order_id" });
  });

  it("returns a stable retryable timeout when Biteship tracking aborts", async () => {
    const fetchMock = vi.fn(async () => {
      throw createAbortError();
    });
    vi.stubGlobal("fetch", fetchMock);
    const admin = createAdminClient({
      status: "awaiting_shipment",
      payment_status: "settlement",
      biteship_order_id: "biteship-order-1",
      biteship_tracking_id: "tracking-1",
    });
    const handler = createOrderManagerHandler({
      requireAdmin: vi.fn(async () => ({ userId: "admin-user" })),
      getAdminClient: () => admin.adminClient as never,
    });

    const response = await handler(createRequest({
      action: "sync_tracking",
      orderId: "order-1",
    }));
    const body = await response.json();

    expect(response.status).toBe(504);
    expect(body).toEqual({
      error: "BITESHIP_TRACKING_SYNC_TIMEOUT",
      message: "Biteship tracking sync timed out.",
      retryable: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(admin.ordersUpdate).not.toHaveBeenCalled();
    expect(admin.shipmentUpsert).not.toHaveBeenCalled();
  });

  it("does not retry non-retryable Biteship tracking validation failures", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: "provider validation secret-sentinel" }), { status: 422 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const admin = createAdminClient({
      status: "awaiting_shipment",
      payment_status: "settlement",
      biteship_order_id: "biteship-order-1",
      biteship_tracking_id: "tracking-1",
    });
    const handler = createOrderManagerHandler({
      requireAdmin: vi.fn(async () => ({ userId: "admin-user" })),
      getAdminClient: () => admin.adminClient as never,
    });

    const response = await handler(createRequest({
      action: "sync_tracking",
      orderId: "order-1",
    }));
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body).toEqual({
      error: "BITESHIP_TRACKING_SYNC_REJECTED",
      message: "Biteship tracking sync was rejected by the provider.",
      retryable: false,
    });
    expect(JSON.stringify(body)).not.toContain("secret-sentinel");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(admin.ordersUpdate).not.toHaveBeenCalled();
    expect(admin.shipmentUpsert).not.toHaveBeenCalled();
  });

  it("rejects Midtrans-backed cancellation with blank verified currency before order or payment mutation", async () => {
    const admin = createAdminClient();
    const handler = createOrderManagerHandler({
      requireAdmin: vi.fn(async () => ({ userId: "admin-user" })),
      getAdminClient: () => admin.adminClient as never,
    });

    const response = await handler(createRequest());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({ error: "Currency validation failed" });
    expect(admin.ordersUpdate).not.toHaveBeenCalled();
    expect(admin.paymentsUpdate).not.toHaveBeenCalled();
    expect(admin.activityInsert).not.toHaveBeenCalled();
    expect(midtransMocks.cancelMidtransTransaction).not.toHaveBeenCalled();
  });

  it("rejects cancellable Midtrans status with missing verified currency before provider cancel", async () => {
    midtransMocks.verifyMidtransTransaction.mockResolvedValue({
      order_id: "MIDTRANS-MANAGER-ORDER",
      transaction_id: "transaction-pending",
      transaction_status: "pending",
      fraud_status: "",
      status_code: "201",
      gross_amount: "150000.00",
      payment_type: "bank_transfer",
    });
    const admin = createAdminClient();
    const handler = createOrderManagerHandler({
      requireAdmin: vi.fn(async () => ({ userId: "admin-user" })),
      getAdminClient: () => admin.adminClient as never,
    });

    const response = await handler(createRequest());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({ error: "Currency validation failed" });
    expect(midtransMocks.cancelMidtransTransaction).not.toHaveBeenCalled();
    expect(admin.ordersUpdate).not.toHaveBeenCalled();
    expect(admin.paymentsUpdate).not.toHaveBeenCalled();
    expect(admin.activityInsert).not.toHaveBeenCalled();
  });

  it("uses stored non-IDR order currency when validating cancelled Midtrans status", async () => {
    midtransMocks.verifyMidtransTransaction.mockResolvedValue({
      order_id: "MIDTRANS-MANAGER-ORDER",
      transaction_id: "transaction-cancel",
      transaction_status: "cancel",
      fraud_status: "",
      status_code: "200",
      gross_amount: "150000.00",
      payment_type: "bank_transfer",
      currency: "IDR",
    });
    const admin = createAdminClient({ currency: "USD" });
    const handler = createOrderManagerHandler({
      requireAdmin: vi.fn(async () => ({ userId: "admin-user" })),
      getAdminClient: () => admin.adminClient as never,
    });

    const response = await handler(createRequest());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({ error: "Currency mismatch" });
    expect(admin.ordersUpdate).not.toHaveBeenCalled();
    expect(admin.paymentsUpdate).not.toHaveBeenCalled();
    expect(admin.activityInsert).not.toHaveBeenCalled();
  });
});

describe("order-manager stock restoration on cancellation", () => {
  beforeEach(() => {
    midtransMocks.resolveMidtransTransactionRuntimeConfig.mockClear();
    midtransMocks.verifyMidtransTransaction.mockReset();
    midtransMocks.verifyMidtransTransaction.mockResolvedValue({
      order_id: "MIDTRANS-MANAGER-ORDER",
      transaction_id: "transaction-cancel",
      transaction_status: "cancel",
      fraud_status: "",
      status_code: "200",
      gross_amount: "150000.00",
      payment_type: "bank_transfer",
      currency: "IDR",
    });
    midtransMocks.cancelMidtransTransaction.mockClear();
  });

  it("calls reverse_order_item_stock_deduction for each deducted product on cancel", async () => {
    const admin = createAdminClient({
      status: "processing",
      payment_status: "pending",
      stockDeductionRows: [
        { product_id: "product-a" },
        { product_id: "product-b" },
      ],
    });
    const handler = createOrderManagerHandler({
      requireAdmin: vi.fn(async () => ({ userId: "admin-user" })),
      getAdminClient: () => admin.adminClient as never,
    });

    const response = await handler(createRequest());

    expect(response.status).toBe(200);
    expect(admin.from).toHaveBeenCalledWith("order_item_stock_deductions");
    expect(admin.rpc).toHaveBeenCalledWith(
      "reverse_order_item_stock_deduction",
      { p_order_id: "order-1", p_product_id: "product-a" },
    );
    expect(admin.rpc).toHaveBeenCalledWith(
      "reverse_order_item_stock_deduction",
      { p_order_id: "order-1", p_product_id: "product-b" },
    );
  });

  it("skips stock restoration when no deduction records exist", async () => {
    const admin = createAdminClient({
      status: "pending",
      payment_status: "pending",
      stockDeductionRows: [],
    });
    const handler = createOrderManagerHandler({
      requireAdmin: vi.fn(async () => ({ userId: "admin-user" })),
      getAdminClient: () => admin.adminClient as never,
    });

    const response = await handler(createRequest());

    expect(response.status).toBe(200);
    expect(admin.rpc).not.toHaveBeenCalledWith(
      "reverse_order_item_stock_deduction",
      expect.anything(),
    );
  });

  it("does not fail the cancel response when stock restoration errors", async () => {
    const admin = createAdminClient({
      status: "processing",
      payment_status: "pending",
      stockDeductionRows: [{ product_id: "product-fail" }],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (admin.rpc as ReturnType<typeof vi.fn>).mockImplementation(async (name: string) => {
      if (name === "reverse_order_item_stock_deduction") {
        return { data: null, error: { message: "restoration failed" } };
      }
      if (name === "get_runtime_integration_config_versions") {
        return { data: [], error: null };
      }
      return { data: null, error: null };
    });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = createOrderManagerHandler({
      requireAdmin: vi.fn(async () => ({ userId: "admin-user" })),
      getAdminClient: () => admin.adminClient as never,
    });

    const response = await handler(createRequest());

    expect(response.status).toBe(200);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[order-manager] Stock restoration failed for product:",
      expect.objectContaining({ code: "stock_restoration_failed" }),
    );
    consoleErrorSpy.mockRestore();
  });
});
