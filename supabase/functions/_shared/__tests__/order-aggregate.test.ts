import { describe, expect, it } from "vitest";

import { getOrderAggregateById } from "../order-aggregate.ts";

type QueryError = { message: string } | null;
type QueryResult = { data: unknown; error: QueryError };
type PaymentStatus = "pending" | "settlement" | "deny" | "expire";
type QueryOrder = { column: string; ascending: boolean };
type QueryRecord = {
  table: string;
  selectedColumns: string;
  filters: Array<{ column: string; value: unknown }>;
  orders: QueryOrder[];
  limit: number | null;
};

type OrderRow = {
  id: string;
  user_id: string;
  total_amount: number;
  status: string;
  payment_status?: PaymentStatus;
  shipping_cost: number;
  shipping_address_id: string;
  created_at: string;
  updated_at: string;
  order_items: unknown[];
  profiles: null;
  addresses: null;
};

type PaymentRow = {
  order_id: string;
  status: PaymentStatus;
  updated_at: string;
  created_at: string;
  payment_type?: string | null;
  gross_amount?: number | null;
  paid_at?: string | null;
  expiry_time?: string | null;
  checkout_idempotency_key?: string | null;
  midtrans_order_id?: string | null;
  midtrans_transaction_id?: string | null;
  snap_token?: string | null;
  redirect_url?: string | null;
  snap_token_created_at?: string | null;
};

type ShipmentRow = {
  order_id: string;
  updated_at: string;
  created_at: string;
};

const baseOrder: OrderRow = {
  id: "order-1",
  user_id: "user-1",
  total_amount: 100000,
  status: "pending",
  shipping_cost: 10000,
  shipping_address_id: "address-1",
  created_at: "2026-05-20T00:00:00.000Z",
  updated_at: "2026-05-20T00:00:00.000Z",
  order_items: [],
  profiles: null,
  addresses: null,
};

class MockQueryBuilder {
  private readonly filters: Array<{ column: string; value: unknown }> = [];
  private readonly orders: QueryOrder[] = [];
  private rowLimit: number | null = null;
  private selectedColumns = "";

  constructor(
    private readonly client: MockAdminClient,
    private readonly table: string,
  ) {}

  select(columns: string): MockQueryBuilder {
    this.selectedColumns = columns;
    return this;
  }

  eq(column: string, value: unknown): MockQueryBuilder {
    this.filters.push({ column, value });
    return this;
  }

  order(column: string, options: { ascending: boolean }): MockQueryBuilder {
    this.orders.push({ column, ascending: options.ascending });
    return this;
  }

  limit(value: number): MockQueryBuilder {
    this.rowLimit = value;
    return this;
  }

  maybeSingle(): Promise<QueryResult> {
    return this.client.execute({
      table: this.table,
      selectedColumns: this.selectedColumns,
      filters: [...this.filters],
      orders: [...this.orders],
      limit: this.rowLimit,
    });
  }
}

class MockAdminClient {
  readonly queries: QueryRecord[] = [];

  constructor(
    private readonly order: OrderRow | null,
    private readonly payments: PaymentRow[] = [],
    private readonly shipments: ShipmentRow[] = [],
  ) {}

  from(table: string): MockQueryBuilder {
    return new MockQueryBuilder(this, table);
  }

  async execute(query: QueryRecord): Promise<QueryResult> {
    this.queries.push(query);

    if (query.table === "orders") {
      return { data: this.order, error: null };
    }

    if (query.table === "payments") {
      const orderId = getFilterValue(query, "order_id");
      const rows = this.payments.filter((payment) => payment.order_id === orderId);
      return { data: latestByQueryOrdering(rows, query) ?? null, error: null };
    }

    if (query.table === "shipments") {
      const orderId = getFilterValue(query, "order_id");
      const rows = this.shipments.filter((shipment) => shipment.order_id === orderId);
      return { data: latestByQueryOrdering(rows, query) ?? null, error: null };
    }

    return { data: null, error: { message: `Unexpected table ${query.table}` } };
  }
}

function getFilterValue(query: QueryRecord, column: string): unknown {
  return query.filters.find((filter) => filter.column === column)?.value;
}

function latestByQueryOrdering<Row extends { updated_at: string; created_at: string }>(
  rows: Row[],
  query: QueryRecord,
): Row | null {
  expect(query.orders).toEqual([
    { column: "updated_at", ascending: false },
    { column: "created_at", ascending: false },
  ]);
  expect(query.limit).toBe(1);

  return [...rows].sort((left, right) => {
    const updatedComparison = right.updated_at.localeCompare(left.updated_at);
    if (updatedComparison !== 0) {
      return updatedComparison;
    }

    return right.created_at.localeCompare(left.created_at);
  })[0] ?? null;
}

function createPayment(overrides: Partial<PaymentRow> = {}): PaymentRow {
  return {
    order_id: "order-1",
    status: "pending",
    updated_at: "2026-05-20T00:00:00.000Z",
    created_at: "2026-05-20T00:00:00.000Z",
    payment_type: "bank_transfer",
    gross_amount: 100000,
    paid_at: null,
    expiry_time: null,
    checkout_idempotency_key: null,
    midtrans_order_id: null,
    midtrans_transaction_id: null,
    snap_token: null,
    redirect_url: null,
    snap_token_created_at: null,
    ...overrides,
  };
}

async function getAggregatePaymentStatus(payments: PaymentRow[]) {
  const adminClient = new MockAdminClient(baseOrder, payments);

  const aggregate = await getOrderAggregateById(
    adminClient as never,
    baseOrder.id,
  );

  return { aggregate, adminClient };
}

describe("getOrderAggregateById payment precedence", () => {
  it("defaults payment_status to pending when an order has no payment rows", async () => {
    const { aggregate } = await getAggregatePaymentStatus([]);

    expect(aggregate?.payment_status).toBe("pending");
  });

  it("ignores stale orders.payment_status values from the base order row", async () => {
    const adminClient = new MockAdminClient(
      { ...baseOrder, payment_status: "settlement" },
      [createPayment({ status: "pending" })],
    );

    const aggregate = await getOrderAggregateById(
      adminClient as never,
      baseOrder.id,
    );

    expect(aggregate?.payment_status).toBe("pending");
    expect(adminClient.queries.find((query) => query.table === "orders")?.selectedColumns)
      .not.toContain("payment_status");
  });

  it("derives payment_status from a single pending payment", async () => {
    const { aggregate } = await getAggregatePaymentStatus([createPayment()]);

    expect(aggregate?.payment_status).toBe("pending");
  });

  it("derives payment_status from a single settled payment", async () => {
    const { aggregate } = await getAggregatePaymentStatus([
      createPayment({
        status: "settlement",
        paid_at: "2026-05-20T00:10:00.000Z",
      }),
    ]);

    expect(aggregate?.payment_status).toBe("settlement");
    expect(aggregate?.paid_at).toBe("2026-05-20T00:10:00.000Z");
  });

  it("matches order_read_model by using updated_at desc, created_at desc for multiple payment attempts", async () => {
    const { aggregate, adminClient } = await getAggregatePaymentStatus([
      createPayment({
        status: "settlement",
        updated_at: "2026-05-20T00:10:00.000Z",
        created_at: "2026-05-20T00:00:00.000Z",
      }),
      createPayment({
        status: "pending",
        updated_at: "2026-05-20T00:20:00.000Z",
        created_at: "2026-05-20T00:05:00.000Z",
      }),
    ]);

    expect(aggregate?.payment_status).toBe("pending");
    expect(adminClient.queries.find((query) => query.table === "payments")?.orders).toEqual([
      { column: "updated_at", ascending: false },
      { column: "created_at", ascending: false },
    ]);
  });

  it("documents cleanup does not change business precedence and keeps latest-payment semantics", async () => {
    const { aggregate } = await getAggregatePaymentStatus([
      createPayment({
        status: "settlement",
        updated_at: "2026-05-20T00:10:00.000Z",
        created_at: "2026-05-20T00:10:00.000Z",
      }),
      createPayment({
        status: "expire",
        updated_at: "2026-05-20T00:10:00.000Z",
        created_at: "2026-05-20T00:15:00.000Z",
      }),
    ]);

    expect(aggregate?.payment_status).toBe("expire");
  });
});
