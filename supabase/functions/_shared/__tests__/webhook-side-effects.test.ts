import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchOrderShippingAddress } from "../biteship-order-helpers.ts";
import {
  createBiteshipOrder,
  ensureBiteshipOrderConfigSnapshot,
  persistBiteshipShipment,
  ensureBiteshipOrderConfigSnapshot,
  resolveBiteshipApiKeyFromRuntimeConfig,
  type BiteshipOrderConfigSnapshot,
} from "../biteship.ts";
import { getOrderAggregateById } from "../order-aggregate.ts";
import {
  DEFAULT_PROCESSOR_BATCH_SIZE,
  WEBHOOK_BITESHIP_CALL_TIMEOUT_MS,
  WEBHOOK_BITESHIP_MAX_ATTEMPTS,
  WEBHOOK_BITESHIP_RETRY_DELAY_MS,
  WEBHOOK_BITESHIP_WORST_CASE_BATCH_MS,
  WEBHOOK_BITESHIP_WORST_CASE_SINGLE_TASK_MS,
  WEBHOOK_SIDE_EFFECTS_BATCH_BUDGET_MS,
  WEBHOOK_SIDE_EFFECTS_EDGE_RUNTIME_RISK_MS,
  ensureSettlementSideEffectsQueued,
  processWebhookSideEffectTask,
  triggerWebhookSideEffectProcessor,
  type SideEffectTask,
} from "../webhook-side-effects.ts";

vi.mock("../biteship-order-helpers.ts", () => ({
  fetchOrderShippingAddress: vi.fn(),
}));

vi.mock("../biteship.ts", () => ({
  createBiteshipOrder: vi.fn(),
  ensureBiteshipOrderConfigSnapshot: vi.fn(),
  getStandardBiteshipShipmentOriginAreaIdFromSnapshot: vi.fn(() => "SNAPSHOT-AREA-ID"),
  getStandardBiteshipShipmentOriginAreaId: vi.fn(),
  getStoreSettings: vi.fn(),
  isBiteshipConfigSnapshotError: vi.fn(() => false),
  persistBiteshipShipment: vi.fn(),
  resolveBiteshipApiKeyFromRuntimeConfig: vi.fn(async (adminClient: {
    rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: QueryError }>;
  }) => {
    const { data, error } = await adminClient.rpc(
      "get_runtime_integration_config_versions",
      {
        p_key_names: ["biteship.api_key"],
        p_version_numbers: {},
        p_include_grace: false,
      },
    );
    if (error || !Array.isArray(data) || data.length === 0) {
      throw new Error("Biteship runtime config unavailable");
    }

    return String((data[0] as { runtime_value?: unknown }).runtime_value ?? "");
  }),
}));

vi.mock("../order-aggregate.ts", () => ({
  getOrderAggregateById: vi.fn(),
}));

type QueryError = { message: string } | null;
type QueryAction = "select" | "update" | "delete" | "upsert";

type OrderItemProvenanceRow = {
  source_cart_item_id: string | null;
};

type CartItemOwnershipRow = {
  id: string;
  carts: { user_id: string | null } | null;
};

type QueryRecord = {
  table: string;
  action: QueryAction;
  columns: string | null;
  filters: Array<{ column: string; value: unknown }>;
  inFilters: Array<{ column: string; values: unknown[] }>;
  payload: unknown;
};

const orderId = "order-selected-cleanup";
const leaseOwner = "lease-selected-cleanup";

const completeSnapshot: BiteshipOrderConfigSnapshot = {
  id: "snapshot-1",
  order_id: orderId,
  shipment_id: null,
  provider: "biteship",
  origin_area_id: "SNAPSHOT-AREA-ID",
  origin_postal_code: "54321",
  origin_latitude: -6.311111,
  origin_longitude: 106.911111,
  courier_codes: ["jne"],
  courier_service: "reg",
  shipper_name: "Snapshot Sender",
  shipper_phone: "0899999999",
  shipper_email: "snapshot@example.com",
  shipper_address: "Jl. Snapshot No. 9",
  shipper_organization: "Snapshot Pharmacy",
  config_version_ids: {
    "biteship.origin_postal_code": {
      version_id: "version-origin-postal",
      version_number: 4,
    },
    "biteship.origin_area_id": {
      version_id: "version-origin-area",
      version_number: 5,
    },
    "biteship.origin_latitude": {
      version_id: "version-origin-latitude",
      version_number: 6,
    },
    "biteship.origin_longitude": {
      version_id: "version-origin-longitude",
      version_number: 7,
    },
    "biteship.enabled_couriers": {
      version_id: "version-enabled-couriers",
      version_number: 2,
    },
    "shop.shipper_name": {
      version_id: "version-shipper-name",
      version_number: 3,
    },
    "shop.shipper_phone": {
      version_id: "version-shipper-phone",
      version_number: 3,
    },
    "shop.shipper_email": {
      version_id: "version-shipper-email",
      version_number: 3,
    },
    "shop.address": {
      version_id: "version-shop-address",
      version_number: 3,
    },
    "shop.organization": {
      version_id: "version-shop-organization",
      version_number: 3,
    },
  },
  snapshot_source: "webhook_side_effects",
  created_by: null,
  created_at: "2026-05-18T00:00:00.000Z",
};

function createTask(overrides: Partial<SideEffectTask> = {}): SideEffectTask {
  return {
    needs_cart_cleanup: true,
    needs_stock: false,
    needs_biteship: false,
    retry_count: 0,
    updated_at: "2026-04-29T00:00:00.000Z",
    last_error: null,
    lease_owner: null,
    lease_until: null,
    next_retry_at: null,
    last_attempted_at: null,
    last_error_code: null,
    failed_permanently_at: null,
    pending_biteship_order_id: null,
    pending_tracking_id: null,
    pending_waybill_number: null,
    ...overrides,
  };
}

class MockQueryBuilder {
  private action: QueryAction | null = null;
  private columns: string | null = null;
  private payload: unknown = null;
  private filters: Array<{ column: string; value: unknown }> = [];
  private inFilters: Array<{ column: string; values: unknown[] }> = [];

  constructor(
    private readonly client: MockAdminClient,
    private readonly table: string,
  ) {}

  select(columns: string): MockQueryBuilder {
    this.columns = columns;
    this.action ??= "select";
    return this;
  }

  update(payload: unknown): MockQueryBuilder {
    this.payload = payload;
    this.action = "update";
    return this;
  }

  delete(): MockQueryBuilder {
    this.action = "delete";
    return this;
  }

  upsert(payload: unknown): MockQueryBuilder {
    this.payload = payload;
    this.action = "upsert";
    return this;
  }

  eq(column: string, value: unknown): MockQueryBuilder {
    this.filters.push({ column, value });
    return this;
  }

  in(column: string, values: unknown[]): MockQueryBuilder {
    this.inFilters.push({ column, values });
    return this;
  }

  maybeSingle(): Promise<{ data: unknown; error: QueryError }> {
    return this.client.execute(this.record(), true);
  }

  then<TResult1 = { data: unknown; error: QueryError }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: QueryError }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.client.execute(this.record(), false).then(onfulfilled, onrejected);
  }

  private record(): QueryRecord {
    return {
      table: this.table,
      action: this.action ?? "select",
      columns: this.columns,
      filters: [...this.filters],
      inFilters: [...this.inFilters],
      payload: this.payload,
    };
  }
}

class MockAdminClient {
  readonly queries: QueryRecord[] = [];
  readonly rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  readonly finalTaskUpdates: unknown[] = [];
  readonly completedTaskDeletes: QueryRecord[] = [];
  orderItemRows: OrderItemProvenanceRow[] = [];
  cartItemRows: CartItemOwnershipRow[] = [];
  cartDeleteError: QueryError = null;
  pendingBiteshipUpdateError: QueryError = null;
  stockDeductionError: QueryError = null;
  biteshipApiKey = "runtime-biteship-key-sentinel";
  private readonly task: SideEffectTask | null;

  constructor(task: SideEffectTask | null = createTask()) {
    this.task = task;
  }

  from(table: string): MockQueryBuilder {
    return new MockQueryBuilder(this, table);
  }

  async rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: QueryError }> {
    this.rpcCalls.push({ name, args });

    if (name === "apply_order_item_stock_deduction") {
      return { data: null, error: this.stockDeductionError };
    }

    if (name === "get_runtime_integration_config_versions") {
      const keyNames = args.p_key_names as string[];
      if (keyNames.includes("biteship.api_key") && this.biteshipApiKey) {
        return {
          data: [{
            key_name: "biteship.api_key",
            value_kind: "secret",
            is_secret: true,
            is_required: true,
            is_runtime_required: true,
            version_id: "version-biteship-api-key",
            version_number: 2,
            status: "active",
            runtime_value: this.biteshipApiKey,
            masked_value: "runt********************inel",
            value_fingerprint: "fingerprint",
            updated_at: "2026-05-19T00:00:00.000Z",
          }],
          error: null,
        };
      }

      return { data: [], error: null };
    }

    return { data: null, error: null };
  }

  execute(record: QueryRecord, maybeSingle: boolean): Promise<{ data: unknown; error: QueryError }> {
    this.queries.push(record);

    if (record.table === "webhook_side_effect_tasks" && record.action === "select" && maybeSingle) {
      return Promise.resolve({ data: this.task, error: null });
    }

    if (record.table === "webhook_side_effect_tasks" && record.action === "update" && maybeSingle) {
      return Promise.resolve({ data: { order_id: orderId, lease_owner: leaseOwner }, error: null });
    }

    if (record.table === "webhook_side_effect_tasks" && record.action === "update") {
      if (
        record.payload &&
        typeof record.payload === "object" &&
        "pending_biteship_order_id" in record.payload &&
        !("needs_cart_cleanup" in record.payload)
      ) {
        return Promise.resolve({ data: null, error: this.pendingBiteshipUpdateError });
      }

      if (record.payload && typeof record.payload === "object" && "needs_cart_cleanup" in record.payload) {
        this.finalTaskUpdates.push(record.payload);
      }

      return Promise.resolve({ data: null, error: null });
    }

    if (record.table === "webhook_side_effect_tasks" && record.action === "upsert") {
      if (record.payload && typeof record.payload === "object" && "needs_cart_cleanup" in record.payload) {
        this.finalTaskUpdates.push(record.payload);
      }

      return Promise.resolve({ data: null, error: null });
    }

    if (record.table === "webhook_side_effect_tasks" && record.action === "delete") {
      this.completedTaskDeletes.push(record);
      return Promise.resolve({ data: null, error: null });
    }

    if (record.table === "order_items" && record.action === "select") {
      return Promise.resolve({ data: this.orderItemRows, error: null });
    }

    if (record.table === "cart_items" && record.action === "select") {
      return Promise.resolve({ data: this.cartItemRows, error: null });
    }

    if (record.table === "cart_items" && record.action === "delete") {
      return Promise.resolve({ data: null, error: this.cartDeleteError });
    }

    return Promise.resolve({ data: null, error: null });
  }

  get selectedCartItemDeleteIds(): unknown[] {
    const cartDelete = this.queries.find(
      (query) => query.table === "cart_items" && query.action === "delete",
    );

    return cartDelete?.inFilters.find((filter) => filter.column === "id")?.values ?? [];
  }

  get selectedCartItemOwnershipIds(): unknown[] {
    const cartSelect = this.queries.find(
      (query) => query.table === "cart_items" && query.action === "select",
    );

    return cartSelect?.inFilters.find((filter) => filter.column === "id")?.values ?? [];
  }
}


describe("triggerWebhookSideEffectProcessor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("redacts non-OK processor response bodies", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchMock = vi.fn(async () =>
      new Response("processor-response-secret-sentinel table policy stack", { status: 503 })
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("Deno", {
      env: {
        get: vi.fn((key: string) => {
          if (key === "SUPABASE_URL") {
            return "https://example.supabase.co";
          }

          if (key === "SUPABASE_SERVICE_ROLE_KEY") {
            return "service-role-sentinel";
          }

          return undefined;
        }),
      },
    });

    triggerWebhookSideEffectProcessor("order-processor-redaction");
    await new Promise((resolve) => setTimeout(resolve, 0));

    const logOutput = JSON.stringify(consoleError.mock.calls);
    expect(logOutput).toContain("webhook_side_effect_processor_trigger_failed");
    expect(logOutput).toContain("503");
    expect(logOutput).not.toContain("processor-response-secret-sentinel");
    expect(logOutput).not.toContain("table policy");
    expect(logOutput).not.toContain("service-role-sentinel");
    consoleError.mockRestore();
  });

  it("redacts processor trigger fetch errors", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchMock = vi.fn(async () => {
      throw new Error("processor-fetch-secret-sentinel stack table policy");
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("Deno", {
      env: {
        get: vi.fn((key: string) => {
          if (key === "SUPABASE_URL") {
            return "https://example.supabase.co";
          }

          if (key === "SUPABASE_SERVICE_ROLE_KEY") {
            return "service-role-sentinel";
          }

          return undefined;
        }),
      },
    });

    triggerWebhookSideEffectProcessor("order-processor-redaction");
    await new Promise((resolve) => setTimeout(resolve, 0));

    const logOutput = JSON.stringify(consoleError.mock.calls);
    expect(logOutput).toContain("webhook_side_effect_processor_trigger_error");
    expect(logOutput).not.toContain("processor-fetch-secret-sentinel");
    expect(logOutput).not.toContain("table policy");
    expect(logOutput).not.toContain("stack");
    expect(logOutput).not.toContain("service-role-sentinel");
    consoleError.mockRestore();
  });
});

describe("processWebhookSideEffectTask cart cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("Deno", {
      env: {
        get: vi.fn(() => undefined),
      },
    });

    vi.mocked(getOrderAggregateById).mockResolvedValue({
      id: orderId,
      user_id: "user-1",
      status: "processing",
      payment_status: "settlement",
      total_amount: 100_000,
      order_items: [],
    });
    vi.mocked(fetchOrderShippingAddress).mockResolvedValue(null);
    vi.mocked(ensureBiteshipOrderConfigSnapshot).mockResolvedValue(completeSnapshot);
    vi.mocked(ensureBiteshipOrderConfigSnapshot).mockResolvedValue(completeSnapshot);
  });

  it("queues initial settlement side effects only after an applied transition", async () => {
    const adminClient = new MockAdminClient(null);
    vi.mocked(getOrderAggregateById).mockResolvedValue({
      id: orderId,
      user_id: "user-1",
      status: "awaiting_shipment",
      payment_status: "settlement",
      total_amount: 100_000,
      courier_code: "jne",
      courier_service: "reg",
      biteship_order_id: null,
      order_items: [],
    });

    const shouldRunFulfillment = await ensureSettlementSideEffectsQueued(
      adminClient,
      orderId,
      "settlement",
      { transitionApplied: true },
    );

    expect(shouldRunFulfillment).toBe(true);
    expect(adminClient.finalTaskUpdates).toHaveLength(1);
    expect(adminClient.finalTaskUpdates[0]).toMatchObject({
      needs_cart_cleanup: true,
      needs_stock: true,
      needs_biteship: true,
      last_error: null,
    });
  });

  it("does not recreate settlement side effects for a duplicate no-op after completion", async () => {
    const adminClient = new MockAdminClient(null);
    vi.mocked(getOrderAggregateById).mockResolvedValue({
      id: orderId,
      user_id: "user-1",
      status: "processing",
      payment_status: "settlement",
      total_amount: 100_000,
      order_items: [],
    });

    const shouldRunFulfillment = await ensureSettlementSideEffectsQueued(
      adminClient,
      orderId,
      "settlement",
      { transitionApplied: false },
    );

    expect(shouldRunFulfillment).toBe(false);
    expect(adminClient.finalTaskUpdates).toHaveLength(0);
    expect(ensureBiteshipOrderConfigSnapshot).not.toHaveBeenCalled();
  });

  it("resumes an existing incomplete no-op task without re-adding finished stock or shipment work", async () => {
    const adminClient = new MockAdminClient(createTask({
      needs_cart_cleanup: false,
      needs_stock: false,
      needs_biteship: true,
      last_error: "Biteship request timeout",
      next_retry_at: "2026-05-24T10:00:00.000Z",
      pending_biteship_order_id: "biteship-pending-1",
      pending_tracking_id: "tracking-pending-1",
      pending_waybill_number: "waybill-pending-1",
    }));
    vi.mocked(getOrderAggregateById).mockResolvedValue({
      id: orderId,
      user_id: "user-1",
      status: "awaiting_shipment",
      payment_status: "settlement",
      total_amount: 100_000,
      courier_code: "jne",
      courier_service: "reg",
      biteship_order_id: null,
      order_items: [],
    });

    const shouldRunFulfillment = await ensureSettlementSideEffectsQueued(
      adminClient,
      orderId,
      "settlement",
      { transitionApplied: false },
    );

    expect(shouldRunFulfillment).toBe(true);
    expect(adminClient.finalTaskUpdates).toHaveLength(0);
    expect(ensureBiteshipOrderConfigSnapshot).not.toHaveBeenCalled();
  });

  it("does not queue settlement side effects for capture challenge payment state", async () => {
    const adminClient = new MockAdminClient(null);
    vi.mocked(getOrderAggregateById).mockResolvedValue({
      id: orderId,
      user_id: "user-1",
      status: "pending",
      payment_status: "pending",
      total_amount: 100_000,
      order_items: [],
    });

    const shouldRunFulfillment = await ensureSettlementSideEffectsQueued(
      adminClient,
      orderId,
      "pending",
      { transitionApplied: true },
    );

    expect(shouldRunFulfillment).toBe(false);
    expect(adminClient.finalTaskUpdates).toHaveLength(0);
  });

  it("creates a Biteship config snapshot before queueing settlement fulfillment", async () => {
    const adminClient = new MockAdminClient(createTask({
      needs_cart_cleanup: false,
      needs_stock: false,
      needs_biteship: false,
    }));
    vi.mocked(getOrderAggregateById).mockResolvedValue({
      id: orderId,
      user_id: "user-1",
      status: "awaiting_shipment",
      payment_status: "settlement",
      total_amount: 100_000,
      courier_code: "jne",
      courier_service: "reg",
      biteship_order_id: null,
      order_items: [],
    });

    const shouldRunFulfillment = await ensureSettlementSideEffectsQueued(
      adminClient,
      orderId,
      "settlement",
    );

    expect(shouldRunFulfillment).toBe(true);
    expect(ensureBiteshipOrderConfigSnapshot).toHaveBeenCalledWith(
      adminClient,
      expect.objectContaining({ id: orderId, courier_code: "jne" }),
    );
    expect(adminClient.finalTaskUpdates[0]).toMatchObject({
      needs_biteship: true,
      last_error: null,
    });
  });

  it("blocks Biteship creation retryably when the required snapshot is missing", async () => {
    vi.mocked(ensureBiteshipOrderConfigSnapshot).mockRejectedValue(
      new Error("Biteship config snapshot missing for order order-selected-cleanup"),
    );
    const adminClient = new MockAdminClient(createTask({
      needs_cart_cleanup: false,
      needs_stock: false,
      needs_biteship: true,
    }));
    vi.mocked(getOrderAggregateById).mockResolvedValue({
      id: orderId,
      user_id: "user-1",
      status: "awaiting_shipment",
      payment_status: "settlement",
      total_amount: 100_000,
      courier_code: "jne",
      courier_service: "reg",
      biteship_order_id: null,
      order_items: [],
    });

    const result = await processWebhookSideEffectTask(adminClient, orderId);

    expect(result).toMatchObject({
      processed: true,
      needsRetry: true,
    });
    expect(result.message).toContain("Biteship config snapshot missing");
    expect(createBiteshipOrder).not.toHaveBeenCalled();
    expect(adminClient.finalTaskUpdates[0]).toMatchObject({
      needs_biteship: true,
      last_error_code: "biteship_snapshot_missing",
      failed_permanently_at: null,
    });
  });

  it("passes the runtime API key and stored snapshot into Biteship creation and shipment persistence", async () => {
    vi.mocked(createBiteshipOrder).mockResolvedValue({
      success: true,
      id: "biteship-order-1",
      status: "confirmed",
      courier: {
        tracking_id: "tracking-1",
        waybill_id: "waybill-1",
        company: "jne",
        type: "reg",
      },
    });
    const adminClient = new MockAdminClient(createTask({
      needs_cart_cleanup: false,
      needs_stock: false,
      needs_biteship: true,
    }));
    vi.mocked(getOrderAggregateById).mockResolvedValue({
      id: orderId,
      user_id: "user-1",
      status: "awaiting_shipment",
      payment_status: "settlement",
      total_amount: 100_000,
      courier_code: "jne",
      courier_service: "reg",
      biteship_order_id: null,
      order_items: [],
    });

    const result = await processWebhookSideEffectTask(adminClient, orderId);

    expect(result).toEqual({
      processed: true,
      needsRetry: false,
      message: "Fulfillment side effects processed",
    });
    expect(createBiteshipOrder).toHaveBeenCalledWith(
      expect.objectContaining({ id: orderId }),
      "runtime-biteship-key-sentinel",
      completeSnapshot,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(createBiteshipOrder).toHaveBeenCalledTimes(1);
    expect(resolveBiteshipApiKeyFromRuntimeConfig).toHaveBeenCalledWith(
      adminClient,
    );
    expect(adminClient.rpcCalls).toContainEqual({
      name: "get_runtime_integration_config_versions",
      args: {
        p_key_names: ["biteship.api_key"],
        p_version_numbers: {},
        p_include_grace: false,
      },
    });
    expect(JSON.stringify(adminClient.finalTaskUpdates)).not.toContain(
      "runtime-biteship-key-sentinel",
    );
  });

  it("keeps Biteship retry budgets below processor and Edge runtime headroom", () => {
    expect(WEBHOOK_BITESHIP_MAX_ATTEMPTS).toBe(2);
    expect(WEBHOOK_BITESHIP_CALL_TIMEOUT_MS).toBeLessThan(10_000);
    expect(WEBHOOK_BITESHIP_WORST_CASE_SINGLE_TASK_MS).toBeLessThan(
      WEBHOOK_SIDE_EFFECTS_BATCH_BUDGET_MS / DEFAULT_PROCESSOR_BATCH_SIZE,
    );
    expect(WEBHOOK_BITESHIP_WORST_CASE_BATCH_MS).toBeLessThan(
      WEBHOOK_SIDE_EFFECTS_BATCH_BUDGET_MS,
    );
    expect(WEBHOOK_BITESHIP_WORST_CASE_BATCH_MS).toBeLessThan(
      WEBHOOK_SIDE_EFFECTS_EDGE_RUNTIME_RISK_MS,
    );
  });

  it("retries transient Biteship provider failures within the configured budget", async () => {
    vi.useFakeTimers();
    vi.mocked(createBiteshipOrder)
      .mockRejectedValueOnce(new Error("temporary Biteship outage"))
      .mockResolvedValueOnce({
        success: true,
        id: "biteship-order-after-retry",
        status: "confirmed",
        courier: {
          tracking_id: "tracking-after-retry",
          waybill_id: "waybill-after-retry",
          company: "jne",
          type: "reg",
        },
      });
    const adminClient = new MockAdminClient(createTask({
      needs_cart_cleanup: false,
      needs_stock: false,
      needs_biteship: true,
    }));
    vi.mocked(getOrderAggregateById).mockResolvedValue({
      id: orderId,
      user_id: "user-1",
      status: "awaiting_shipment",
      payment_status: "settlement",
      total_amount: 100_000,
      courier_code: "jne",
      courier_service: "reg",
      biteship_order_id: null,
      order_items: [],
    });

    try {
      const resultPromise = processWebhookSideEffectTask(adminClient, orderId);
      await vi.advanceTimersByTimeAsync(WEBHOOK_BITESHIP_RETRY_DELAY_MS);
      const result = await resultPromise;

      expect(result).toEqual({
        processed: true,
        needsRetry: false,
        message: "Fulfillment side effects processed",
      });
      expect(createBiteshipOrder).toHaveBeenCalledTimes(2);
      expect(adminClient.finalTaskUpdates[0]).toMatchObject({
        needs_biteship: false,
        last_error: null,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not retry non-retryable Biteship validation failures", async () => {
    vi.mocked(createBiteshipOrder).mockRejectedValue(
      new Error("Missing product weight for Item 1 in order order-selected-cleanup"),
    );
    const adminClient = new MockAdminClient(createTask({
      needs_cart_cleanup: false,
      needs_stock: false,
      needs_biteship: true,
    }));
    vi.mocked(getOrderAggregateById).mockResolvedValue({
      id: orderId,
      user_id: "user-1",
      status: "awaiting_shipment",
      payment_status: "settlement",
      total_amount: 100_000,
      courier_code: "jne",
      courier_service: "reg",
      biteship_order_id: null,
      order_items: [],
    });

    const result = await processWebhookSideEffectTask(adminClient, orderId);

    expect(result).toMatchObject({
      processed: true,
      needsRetry: false,
      message: "biteship_permanent_validation_failed",
    });
    expect(createBiteshipOrder).toHaveBeenCalledTimes(1);
    expect(adminClient.finalTaskUpdates[0]).toMatchObject({
      needs_biteship: true,
      last_error: "biteship_permanent_validation_failed",
      last_error_code: "permanent_validation_failure",
    });
    expect(adminClient.finalTaskUpdates[0]).toHaveProperty("failed_permanently_at");
  });

  it("fails slow Biteship providers safely and records retry state", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-25T08:00:00.000Z"));
    vi.mocked(createBiteshipOrder).mockImplementation(() => new Promise(() => undefined));
    const adminClient = new MockAdminClient(createTask({
      needs_cart_cleanup: false,
      needs_stock: false,
      needs_biteship: true,
    }));
    vi.mocked(getOrderAggregateById).mockResolvedValue({
      id: orderId,
      user_id: "user-1",
      status: "awaiting_shipment",
      payment_status: "settlement",
      total_amount: 100_000,
      courier_code: "jne",
      courier_service: "reg",
      biteship_order_id: null,
      order_items: [],
    });

    try {
      const resultPromise = processWebhookSideEffectTask(adminClient, orderId);
      await vi.advanceTimersByTimeAsync(WEBHOOK_BITESHIP_WORST_CASE_SINGLE_TASK_MS + 1);
      const result = await resultPromise;

      expect(result).toMatchObject({
        processed: true,
        needsRetry: true,
        message: "biteship_order_create_failed",
      });
      expect(createBiteshipOrder).toHaveBeenCalledTimes(WEBHOOK_BITESHIP_MAX_ATTEMPTS);
      expect(adminClient.finalTaskUpdates[0]).toMatchObject({
        needs_biteship: true,
        last_error: "biteship_order_create_failed",
        last_error_code: "transient_failure",
        failed_permanently_at: null,
      });
      expect((adminClient.finalTaskUpdates[0] as { next_retry_at?: string }).next_retry_at)
        .toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("redacts Biteship provider failures from worker results, persisted task errors, and logs", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(createBiteshipOrder).mockRejectedValue(
      new Error("Buyer Private 0811999000 provider-secret-sentinel order APT-provider-order-secret"),
    );
    const adminClient = new MockAdminClient(createTask({
      needs_cart_cleanup: false,
      needs_stock: false,
      needs_biteship: true,
    }));
    vi.mocked(getOrderAggregateById).mockResolvedValue({
      id: orderId,
      user_id: "user-1",
      status: "awaiting_shipment",
      payment_status: "settlement",
      total_amount: 100_000,
      courier_code: "jne",
      courier_service: "reg",
      biteship_order_id: null,
      order_items: [],
    });

    const result = await processWebhookSideEffectTask(adminClient, orderId);

    expect(result).toMatchObject({
      processed: true,
      needsRetry: true,
      message: "biteship_order_create_failed",
    });
    expect(adminClient.finalTaskUpdates[0]).toMatchObject({
      needs_biteship: true,
      last_error: "biteship_order_create_failed",
    });
    const combinedOutput = JSON.stringify({
      result,
      taskUpdates: adminClient.finalTaskUpdates,
      logs: consoleError.mock.calls,
    });
    expect(combinedOutput).not.toContain("Buyer Private");
    expect(combinedOutput).not.toContain("0811999000");
    expect(combinedOutput).not.toContain("provider-secret-sentinel");
    expect(combinedOutput).not.toContain("APT-provider-order-secret");
    consoleError.mockRestore();
  });

  it("redacts stock RPC errors from worker results, persisted task errors, and logs", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const adminClient = new MockAdminClient(createTask({
      needs_cart_cleanup: false,
      needs_stock: true,
      needs_biteship: false,
    }));
    adminClient.stockDeductionError = {
      message: "permission denied for schema public using cart_items apply_order_item_stock_deduction secret-rpc-sentinel",
    };
    vi.mocked(getOrderAggregateById).mockResolvedValue({
      id: orderId,
      user_id: "user-1",
      status: "awaiting_shipment",
      payment_status: "settlement",
      total_amount: 100_000,
      order_items: [{ product_id: "product-1", quantity: 2 }],
    });

    const result = await processWebhookSideEffectTask(adminClient, orderId);

    expect(result).toMatchObject({
      processed: true,
      needsRetry: true,
      message: "stock_deduction_failed",
    });
    expect(adminClient.finalTaskUpdates[0]).toMatchObject({
      needs_stock: true,
      last_error: "stock_deduction_failed",
      last_error_code: "stock_deduction_failed",
    });
    const combinedOutput = JSON.stringify({
      result,
      taskUpdates: adminClient.finalTaskUpdates,
      logs: consoleError.mock.calls,
    });
    expect(combinedOutput).not.toContain("permission denied");
    expect(combinedOutput).not.toContain("schema public");
    expect(combinedOutput).not.toContain("cart_items");
    expect(combinedOutput).not.toContain("apply_order_item_stock_deduction");
    expect(combinedOutput).not.toContain("secret-rpc-sentinel");
    consoleError.mockRestore();
  });

  it("redacts pending Biteship shipment persistence failures and keeps pending result retryable", async () => {
    vi.mocked(persistBiteshipShipment).mockRejectedValue(
      new Error("raw pending shipment secret-db-sentinel relation shipments stack details"),
    );
    const adminClient = new MockAdminClient(createTask({
      needs_cart_cleanup: false,
      needs_stock: false,
      needs_biteship: true,
      pending_biteship_order_id: "biteship-pending-1",
      pending_tracking_id: "tracking-pending-1",
      pending_waybill_number: "waybill-pending-1",
    }));
    vi.mocked(getOrderAggregateById).mockResolvedValue({
      id: orderId,
      user_id: "user-1",
      status: "awaiting_shipment",
      payment_status: "settlement",
      total_amount: 100_000,
      courier_code: "jne",
      courier_service: "reg",
      biteship_order_id: null,
      order_items: [],
    });

    const result = await processWebhookSideEffectTask(adminClient, orderId);

    expect(result).toMatchObject({
      processed: true,
      needsRetry: true,
      message: "persist_pending_biteship_failed",
    });
    expect(adminClient.finalTaskUpdates[0]).toMatchObject({
      needs_biteship: true,
      last_error: "persist_pending_biteship_failed",
      last_error_code: "persist_pending_biteship_failed",
      pending_biteship_order_id: "biteship-pending-1",
      pending_tracking_id: "tracking-pending-1",
      pending_waybill_number: "waybill-pending-1",
    });
    const combinedOutput = JSON.stringify({ result, taskUpdates: adminClient.finalTaskUpdates });
    expect(combinedOutput).not.toContain("secret-db-sentinel");
    expect(combinedOutput).not.toContain("relation shipments");
    expect(combinedOutput).not.toContain("stack details");
  });

  it("redacts pending Biteship result save failures through the outer catch path", async () => {
    vi.mocked(createBiteshipOrder).mockResolvedValue({
      success: true,
      id: "biteship-order-raw-save",
      status: "confirmed",
      courier: {
        tracking_id: "tracking-raw-save",
        waybill_id: "waybill-raw-save",
        company: "jne",
        type: "reg",
      },
    });
    const adminClient = new MockAdminClient(createTask({
      needs_cart_cleanup: false,
      needs_stock: false,
      needs_biteship: true,
    }));
    adminClient.pendingBiteshipUpdateError = {
      message: "permission denied updating webhook_side_effect_tasks secret-pending-save-sentinel stack",
    };
    vi.mocked(getOrderAggregateById).mockResolvedValue({
      id: orderId,
      user_id: "user-1",
      status: "awaiting_shipment",
      payment_status: "settlement",
      total_amount: 100_000,
      courier_code: "jne",
      courier_service: "reg",
      biteship_order_id: null,
      order_items: [],
    });

    const result = await processWebhookSideEffectTask(adminClient, orderId);

    expect(result).toMatchObject({
      processed: false,
      needsRetry: true,
      message: "side_effect_processing_failed",
    });
    expect(adminClient.finalTaskUpdates[0]).toMatchObject({
      needs_biteship: true,
      last_error: "side_effect_processing_failed",
    });
    const combinedOutput = JSON.stringify({ result, taskUpdates: adminClient.finalTaskUpdates });
    expect(combinedOutput).not.toContain("secret-pending-save-sentinel");
    expect(combinedOutput).not.toContain("webhook_side_effect_tasks");
    expect(combinedOutput).not.toContain("permission denied");
  });

  it("redacts final Biteship shipment persistence failures and preserves retry state", async () => {
    vi.mocked(createBiteshipOrder).mockResolvedValue({
      success: true,
      id: "biteship-order-final-1",
      status: "confirmed",
      courier: {
        tracking_id: "tracking-final-1",
        waybill_id: "waybill-final-1",
        company: "jne",
        type: "reg",
      },
    });
    vi.mocked(persistBiteshipShipment).mockRejectedValue(
      new Error("raw final shipment secret-provider-sentinel relation shipments stack details"),
    );
    const adminClient = new MockAdminClient(createTask({
      needs_cart_cleanup: false,
      needs_stock: false,
      needs_biteship: true,
    }));
    vi.mocked(getOrderAggregateById).mockResolvedValue({
      id: orderId,
      user_id: "user-1",
      status: "awaiting_shipment",
      payment_status: "settlement",
      total_amount: 100_000,
      courier_code: "jne",
      courier_service: "reg",
      biteship_order_id: null,
      order_items: [],
    });

    const result = await processWebhookSideEffectTask(adminClient, orderId);

    expect(result).toMatchObject({
      processed: true,
      needsRetry: true,
      message: "persist_biteship_result_failed",
    });
    expect(adminClient.finalTaskUpdates[0]).toMatchObject({
      needs_biteship: true,
      last_error: "persist_biteship_result_failed",
      last_error_code: "persist_biteship_result_failed",
      pending_biteship_order_id: "biteship-order-final-1",
      pending_tracking_id: "tracking-final-1",
      pending_waybill_number: "waybill-final-1",
    });
    const combinedOutput = JSON.stringify({ result, taskUpdates: adminClient.finalTaskUpdates });
    expect(combinedOutput).not.toContain("secret-provider-sentinel");
    expect(combinedOutput).not.toContain("relation shipments");
    expect(combinedOutput).not.toContain("stack details");
  });

  it("redacts raw outer catch errors from worker results and persisted task errors", async () => {
    vi.mocked(getOrderAggregateById).mockRejectedValue(
      new Error("raw outer catch secret-rpc-sentinel stack details"),
    );
    const adminClient = new MockAdminClient(createTask({
      needs_cart_cleanup: false,
      needs_stock: false,
      needs_biteship: true,
    }));

    const result = await processWebhookSideEffectTask(adminClient, orderId);

    expect(result).toMatchObject({
      processed: false,
      needsRetry: true,
      message: "side_effect_processing_failed",
    });
    expect(adminClient.finalTaskUpdates[0]).toMatchObject({
      needs_biteship: true,
      last_error: "side_effect_processing_failed",
    });
    const combinedOutput = JSON.stringify({ result, taskUpdates: adminClient.finalTaskUpdates });
    expect(combinedOutput).not.toContain("secret-rpc-sentinel");
    expect(combinedOutput).not.toContain("stack details");
  });

  it("fails Biteship fulfillment closed when runtime API key config is missing", async () => {
    const adminClient = new MockAdminClient(createTask({
      needs_cart_cleanup: false,
      needs_stock: false,
      needs_biteship: true,
    }));
    adminClient.biteshipApiKey = "";
    vi.mocked(getOrderAggregateById).mockResolvedValue({
      id: orderId,
      user_id: "user-1",
      status: "awaiting_shipment",
      payment_status: "settlement",
      total_amount: 100_000,
      courier_code: "jne",
      courier_service: "reg",
      biteship_order_id: null,
      order_items: [],
    });

    const result = await processWebhookSideEffectTask(adminClient, orderId);

    expect(result).toMatchObject({
      processed: true,
      needsRetry: true,
      message: "Biteship runtime config unavailable",
    });
    expect(createBiteshipOrder).not.toHaveBeenCalled();
    expect(adminClient.finalTaskUpdates[0]).toMatchObject({
      needs_biteship: true,
      last_error: "Biteship runtime config unavailable",
      last_error_code: "biteship_config_unavailable",
      failed_permanently_at: null,
    });
    expect(JSON.stringify(adminClient.finalTaskUpdates)).not.toContain(
      "runtime-biteship-key-sentinel",
    );
  });

  it("deletes only selected order-linked cart item IDs and leaves unselected IDs untouched", async () => {
    const adminClient = new MockAdminClient();
    adminClient.orderItemRows = [
      { source_cart_item_id: "cart-selected-a" },
      { source_cart_item_id: "cart-selected-b" },
    ];
    adminClient.cartItemRows = [
      { id: "cart-selected-a", carts: { user_id: "user-1" } },
      { id: "cart-selected-b", carts: { user_id: "user-1" } },
    ];

    const result = await processWebhookSideEffectTask(adminClient, orderId);

    expect(result).toEqual({
      processed: true,
      needsRetry: false,
      message: "Fulfillment side effects processed",
    });
    expect(adminClient.selectedCartItemDeleteIds).toEqual([
      "cart-selected-a",
      "cart-selected-b",
    ]);
    expect(adminClient.selectedCartItemOwnershipIds).toEqual([
      "cart-selected-a",
      "cart-selected-b",
    ]);
    expect(adminClient.selectedCartItemDeleteIds).not.toContain("cart-unselected");
    expect(
      adminClient.queries.some(
        (query) =>
          query.table === "cart_items" &&
          query.action === "delete" &&
          query.filters.some((filter) => filter.column === "cart_id"),
      ),
    ).toBe(false);
    expect(adminClient.completedTaskDeletes).toHaveLength(1);
  });

  it("does not reintroduce full-cart cleanup when unselected cart items still exist", async () => {
    const adminClient = new MockAdminClient();
    adminClient.orderItemRows = [{ source_cart_item_id: "cart-selected-a" }];
    adminClient.cartItemRows = [
      { id: "cart-selected-a", carts: { user_id: "user-1" } },
      { id: "cart-unselected", carts: { user_id: "user-1" } },
    ];

    const result = await processWebhookSideEffectTask(adminClient, orderId);

    expect(result.needsRetry).toBe(false);
    expect(adminClient.selectedCartItemOwnershipIds).toEqual(["cart-selected-a"]);
    expect(adminClient.selectedCartItemDeleteIds).toEqual(["cart-selected-a"]);
    expect(adminClient.selectedCartItemDeleteIds).not.toContain("cart-unselected");
    expect(
      adminClient.queries.some(
        (query) =>
          query.table === "cart_items" &&
          query.action === "delete" &&
          query.inFilters.length === 0,
      ),
    ).toBe(false);
  });

  it("keeps selected cart cleanup idempotent when selected rows were already deleted", async () => {
    const adminClient = new MockAdminClient();
    adminClient.orderItemRows = [{ source_cart_item_id: "cart-selected-a" }];
    adminClient.cartItemRows = [];

    const result = await processWebhookSideEffectTask(adminClient, orderId);

    expect(result.processed).toBe(true);
    expect(result.needsRetry).toBe(false);
    expect(adminClient.selectedCartItemDeleteIds).toEqual(["cart-selected-a"]);
    expect(adminClient.completedTaskDeletes).toHaveLength(1);
    expect(adminClient.finalTaskUpdates).toHaveLength(0);
  });

  it("marks missing selected cart provenance as a permanent validation failure", async () => {
    const adminClient = new MockAdminClient();
    adminClient.orderItemRows = [
      { source_cart_item_id: null },
      { source_cart_item_id: "" },
    ];

    const result = await processWebhookSideEffectTask(adminClient, orderId);

    expect(result.processed).toBe(true);
    expect(result.needsRetry).toBe(false);
    expect(result.message).toContain("Missing selected cart item provenance");
    expect(adminClient.selectedCartItemDeleteIds).toEqual([]);
    expect(adminClient.completedTaskDeletes).toHaveLength(0);
    expect(adminClient.finalTaskUpdates).toHaveLength(1);
    expect(adminClient.finalTaskUpdates[0]).toMatchObject({
      needs_cart_cleanup: true,
      last_error_code: "permanent_validation_failure",
    });
    expect(adminClient.finalTaskUpdates[0]).toHaveProperty("failed_permanently_at");
  });

  it("treats mixed selected provenance as permanent and does not partially delete", async () => {
    const adminClient = new MockAdminClient();
    adminClient.orderItemRows = [
      { source_cart_item_id: "cart-selected-a" },
      { source_cart_item_id: null },
    ];

    const result = await processWebhookSideEffectTask(adminClient, orderId);

    expect(result.processed).toBe(true);
    expect(result.needsRetry).toBe(false);
    expect(result.message).toContain("Missing selected cart item provenance");
    expect(adminClient.selectedCartItemOwnershipIds).toEqual([]);
    expect(adminClient.selectedCartItemDeleteIds).toEqual([]);
    expect(adminClient.finalTaskUpdates[0]).toMatchObject({
      needs_cart_cleanup: true,
      last_error_code: "permanent_validation_failure",
    });
  });

  it("rejects selected provenance that points to another user's cart item", async () => {
    const adminClient = new MockAdminClient();
    adminClient.orderItemRows = [{ source_cart_item_id: "cart-selected-a" }];
    adminClient.cartItemRows = [
      { id: "cart-selected-a", carts: { user_id: "other-user" } },
    ];

    const result = await processWebhookSideEffectTask(adminClient, orderId);

    expect(result.processed).toBe(true);
    expect(result.needsRetry).toBe(false);
    expect(result.message).toContain("Invalid selected cart item provenance");
    expect(adminClient.selectedCartItemOwnershipIds).toEqual(["cart-selected-a"]);
    expect(adminClient.selectedCartItemDeleteIds).toEqual([]);
    expect(adminClient.finalTaskUpdates[0]).toMatchObject({
      needs_cart_cleanup: true,
      last_error_code: "permanent_validation_failure",
    });
  });

  it("keeps transient selected cart delete failures retryable", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const adminClient = new MockAdminClient();
    adminClient.orderItemRows = [{ source_cart_item_id: "cart-selected-a" }];
    adminClient.cartItemRows = [
      { id: "cart-selected-a", carts: { user_id: "user-1" } },
    ];
    adminClient.cartDeleteError = {
      message: "database timeout on cart_items permission denied schema public secret-cart-sentinel",
    };

    const result = await processWebhookSideEffectTask(adminClient, orderId);

    expect(result.processed).toBe(true);
    expect(result.needsRetry).toBe(true);
    expect(result.message).toBe("cart_cleanup_failed");
    expect(adminClient.finalTaskUpdates[0]).toMatchObject({
      needs_cart_cleanup: true,
      last_error: "cart_cleanup_failed",
      last_error_code: "cart_cleanup_failed",
      failed_permanently_at: null,
    });
    const combinedOutput = JSON.stringify({
      result,
      taskUpdates: adminClient.finalTaskUpdates,
      logs: consoleError.mock.calls,
    });
    expect(combinedOutput).not.toContain("database timeout");
    expect(combinedOutput).not.toContain("cart_items");
    expect(combinedOutput).not.toContain("permission denied");
    expect(combinedOutput).not.toContain("schema public");
    expect(combinedOutput).not.toContain("secret-cart-sentinel");
    consoleError.mockRestore();
  });

  it("redacts selected cart DB errors even when they contain permanent-pattern words", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const adminClient = new MockAdminClient();
    adminClient.orderItemRows = [{ source_cart_item_id: "cart-selected-a" }];
    adminClient.cartItemRows = [
      { id: "cart-selected-a", carts: { user_id: "user-1" } },
    ];
    adminClient.cartDeleteError = {
      message: "missing relation cart_items invalid policy required secret-cart-permanent-sentinel",
    };

    const result = await processWebhookSideEffectTask(adminClient, orderId);

    expect(result).toMatchObject({
      processed: true,
      needsRetry: true,
      message: "cart_cleanup_failed",
    });
    expect(adminClient.finalTaskUpdates[0]).toMatchObject({
      needs_cart_cleanup: true,
      last_error: "cart_cleanup_failed",
      last_error_code: "cart_cleanup_failed",
    });
    const combinedOutput = JSON.stringify({
      result,
      taskUpdates: adminClient.finalTaskUpdates,
      logs: consoleError.mock.calls,
    });
    expect(combinedOutput).not.toContain("secret-cart-permanent-sentinel");
    expect(combinedOutput).not.toContain("cart_items");
    expect(combinedOutput).not.toContain("invalid policy");
    expect(combinedOutput).not.toContain("missing relation");
    consoleError.mockRestore();
  });
});
