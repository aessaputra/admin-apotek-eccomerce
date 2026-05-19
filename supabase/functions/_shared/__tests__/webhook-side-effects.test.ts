import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchOrderShippingAddress } from "../biteship-order-helpers.ts";
import {
  createBiteshipOrder,
  ensureBiteshipOrderConfigSnapshot,
  readBiteshipOrderConfigSnapshot,
  type BiteshipOrderConfigSnapshot,
} from "../biteship.ts";
import { getOrderAggregateById } from "../order-aggregate.ts";
import {
  ensureSettlementSideEffectsQueued,
  processWebhookSideEffectTask,
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
  readBiteshipOrderConfigSnapshot: vi.fn(),
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
  readonly finalTaskUpdates: unknown[] = [];
  readonly completedTaskDeletes: QueryRecord[] = [];
  orderItemRows: OrderItemProvenanceRow[] = [];
  cartItemRows: CartItemOwnershipRow[] = [];
  cartDeleteError: QueryError = null;
  private readonly task: SideEffectTask;

  constructor(task = createTask()) {
    this.task = task;
  }

  from(table: string): MockQueryBuilder {
    return new MockQueryBuilder(this, table);
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
    vi.mocked(readBiteshipOrderConfigSnapshot).mockResolvedValue(completeSnapshot);
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
    vi.stubGlobal("Deno", {
      env: {
        get: vi.fn((key: string) => key === "BITESHIP_API_KEY" ? "placeholder-biteship-key" : undefined),
      },
    });
    vi.mocked(readBiteshipOrderConfigSnapshot).mockRejectedValue(
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

  it("passes the stored snapshot into Biteship creation and shipment persistence", async () => {
    vi.stubGlobal("Deno", {
      env: {
        get: vi.fn((key: string) => key === "BITESHIP_API_KEY" ? "placeholder-biteship-key" : undefined),
      },
    });
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
      "placeholder-biteship-key",
      completeSnapshot,
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
    const adminClient = new MockAdminClient();
    adminClient.orderItemRows = [{ source_cart_item_id: "cart-selected-a" }];
    adminClient.cartItemRows = [
      { id: "cart-selected-a", carts: { user_id: "user-1" } },
    ];
    adminClient.cartDeleteError = { message: "database timeout" };

    const result = await processWebhookSideEffectTask(adminClient, orderId);

    expect(result.processed).toBe(true);
    expect(result.needsRetry).toBe(true);
    expect(result.message).toContain("database timeout");
    expect(adminClient.finalTaskUpdates[0]).toMatchObject({
      needs_cart_cleanup: true,
      last_error_code: "cart_cleanup_failed",
      failed_permanently_at: null,
    });
  });
});
