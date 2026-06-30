import { beforeEach, describe, expect, it, vi } from "vitest";

vi.stubGlobal("Deno", {
  env: { get: vi.fn(() => undefined) },
  serve: vi.fn(),
});

const { createBiteshipWebhookHandler } = await import("../handler.ts");

type Handler = ReturnType<typeof createBiteshipWebhookHandler>;

// --- Mock helpers ---

interface ShipmentRow {
  order_id: string;
  biteship_order_id: string;
  biteship_tracking_id: string | null;
  waybill_number: string | null;
  waybill_source: string | null;
  status: string | null;
  latest_biteship_status: string | null;
}

interface OrderRow {
  id: string;
  user_id: string | null;
  status: string;
  payment_status: string;
}

interface MockAdminClientOptions {
  shipment?: ShipmentRow | null;
  shipmentError?: { message: string } | null;
  order?: OrderRow | null;
  orderError?: { message: string } | null;
}

function createMockAdminClient(options: MockAdminClientOptions = {}) {
  const updateCalls: Array<{ table: string; values: Record<string, unknown>; filters: Record<string, unknown> }> = [];
  const insertCalls: Array<{ table: string; values: Record<string, unknown> }> = [];

  const from = vi.fn((tableName: string) => {
    const filters: Record<string, unknown> = {};

    const chainMethods = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn((col: string, val: unknown) => {
        filters[col] = val;
        return chainMethods;
      }),
      maybeSingle: vi.fn(async () => {
        if (tableName === "shipments") {
          if (options.shipmentError) return { data: null, error: options.shipmentError };
          return { data: options.shipment ?? null, error: null };
        }
        return { data: null, error: null };
      }),
      single: vi.fn(async () => {
        if (tableName === "order_read_model") {
          if (options.orderError) return { data: null, error: options.orderError };
          return { data: options.order ?? null, error: null };
        }
        return { data: null, error: null };
      }),
      update: vi.fn((values: Record<string, unknown>) => {
        updateCalls.push({ table: tableName, values, filters: { ...filters } });
        return {
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn(async () => ({ data: { id: "order-1", status: values.status }, error: null })),
              }),
            }),
            select: vi.fn().mockReturnValue({
              single: vi.fn(async () => ({ data: { id: "order-1", status: values.status }, error: null })),
            }),
          }),
          select: vi.fn().mockReturnValue({
            single: vi.fn(async () => ({ data: { id: "order-1", status: values.status }, error: null })),
          }),
        };
      }),
      insert: vi.fn((values: Record<string, unknown>) => {
        insertCalls.push({ table: tableName, values });
        return Promise.resolve({ error: null });
      }),
      upsert: vi.fn(() => Promise.resolve({ error: null })),
    };

    return chainMethods;
  });

  return { from, updateCalls, insertCalls };
}

function makeRequest(body: Record<string, unknown>, method = "POST", secret?: string): Request {
  const url = secret
    ? `https://test.supabase.co/functions/v1/biteship-webhook?secret=${secret}`
    : "https://test.supabase.co/functions/v1/biteship-webhook";

  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
}

function makeStatusPayload(overrides: Partial<{
  event: string;
  order_id: string;
  status: string;
  courier_tracking_id: string;
  courier_waybill_id: string;
  courier_company: string;
}> = {}): Record<string, unknown> {
  return {
    event: "order.status",
    order_id: "biteship-order-123",
    status: "delivered",
    courier_tracking_id: "TRK-001",
    courier_waybill_id: "WB-12345",
    courier_company: "jne",
    ...overrides,
  };
}

const DEFAULT_SHIPMENT: ShipmentRow = {
  order_id: "order-1",
  biteship_order_id: "biteship-order-123",
  biteship_tracking_id: "TRK-001",
  waybill_number: "WB-12345",
  waybill_source: "system",
  status: "shipped",
  latest_biteship_status: "picked",
};

const DEFAULT_ORDER: OrderRow = {
  id: "order-1",
  user_id: "user-1",
  status: "shipped",
  payment_status: "settlement",
};

// --- Tests ---

describe("biteship-webhook handler", () => {
  let handler: Handler;
  let mockClient: ReturnType<typeof createMockAdminClient>;

  beforeEach(() => {
    mockClient = createMockAdminClient({
      shipment: DEFAULT_SHIPMENT,
      order: DEFAULT_ORDER,
    });
    handler = createBiteshipWebhookHandler({
      getAdminClient: () => mockClient,
    });
  });

  describe("HTTP method validation", () => {
    it("returns 200 for OPTIONS (CORS preflight)", async () => {
      const req = makeRequest({}, "OPTIONS");
      const resp = await handler(req);
      expect(resp.status).toBe(200);
    });

    it("returns 405 for GET requests", async () => {
      const req = new Request("https://test.supabase.co/functions/v1/biteship-webhook", {
        method: "GET",
      });
      const resp = await handler(req);
      expect(resp.status).toBe(405);
    });
  });

  describe("secret validation", () => {
    it("returns 401 when secret is configured but missing from request", async () => {
      handler = createBiteshipWebhookHandler({
        getAdminClient: () => mockClient,
        getWebhookSecret: () => "my-secret",
      });
      const req = makeRequest(makeStatusPayload());
      const resp = await handler(req);
      expect(resp.status).toBe(401);
    });

    it("returns 401 when secret is configured but wrong", async () => {
      handler = createBiteshipWebhookHandler({
        getAdminClient: () => mockClient,
        getWebhookSecret: () => "my-secret",
      });
      const req = makeRequest(makeStatusPayload(), "POST", "wrong-secret");
      const resp = await handler(req);
      expect(resp.status).toBe(401);
    });

    it("passes when secret matches", async () => {
      handler = createBiteshipWebhookHandler({
        getAdminClient: () => mockClient,
        getWebhookSecret: () => "my-secret",
      });
      const req = makeRequest(makeStatusPayload(), "POST", "my-secret");
      const resp = await handler(req);
      expect(resp.status).toBe(200);
    });

    it("allows requests when no secret is configured", async () => {
      handler = createBiteshipWebhookHandler({
        getAdminClient: () => mockClient,
        getWebhookSecret: () => null,
      });
      const req = makeRequest(makeStatusPayload());
      const resp = await handler(req);
      expect(resp.status).toBe(200);
    });
  });

  describe("payload validation", () => {
    it("returns 400 for invalid JSON", async () => {
      const req = new Request("https://test.supabase.co/functions/v1/biteship-webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      });
      const resp = await handler(req);
      expect(resp.status).toBe(400);
    });

    it("returns 400 when event is missing", async () => {
      const req = makeRequest({ order_id: "abc" });
      const resp = await handler(req);
      expect(resp.status).toBe(400);
    });

    it("returns 400 when order_id is missing", async () => {
      const req = makeRequest({ event: "order.status" });
      const resp = await handler(req);
      expect(resp.status).toBe(400);
    });
  });

  describe("order.price event", () => {
    it("acknowledges price updates without DB mutations", async () => {
      const req = makeRequest({
        event: "order.price",
        order_id: "biteship-order-123",
        order_price: 50000,
      });
      const resp = await handler(req);
      expect(resp.status).toBe(200);
      const body = await resp.json();
      expect(body.message).toBe("Price update acknowledged");
    });
  });

  describe("order.waybill_id event", () => {
    it("updates waybill number and tracking ID on shipment", async () => {
      mockClient = createMockAdminClient({
        shipment: { ...DEFAULT_SHIPMENT, waybill_number: null, biteship_tracking_id: null },
        order: DEFAULT_ORDER,
      });
      handler = createBiteshipWebhookHandler({ getAdminClient: () => mockClient });

      const req = makeRequest({
        event: "order.waybill_id",
        order_id: "biteship-order-123",
        courier_waybill_id: "WB-99999",
        courier_tracking_id: "TRK-NEW",
      });
      const resp = await handler(req);
      expect(resp.status).toBe(200);
      const body = await resp.json();
      expect(body.message).toBe("Waybill updated");
    });

    it("ignores waybill event with no new data", async () => {
      const req = makeRequest({
        event: "order.waybill_id",
        order_id: "biteship-order-123",
      });
      const resp = await handler(req);
      expect(resp.status).toBe(200);
      const body = await resp.json();
      expect(body.message).toBe("No waybill or tracking data in payload");
    });
  });

  describe("order.status event", () => {
    it("advances order status from shipped to delivered", async () => {
      const req = makeRequest(makeStatusPayload({ status: "delivered" }));
      const resp = await handler(req);
      expect(resp.status).toBe(200);
      const body = await resp.json();
      expect(body.data.new_status).toBe("delivered");
      expect(body.data.status_changed).toBe(true);
    });

    it("advances order status from shipped to in_transit (dropping_off)", async () => {
      const req = makeRequest(makeStatusPayload({ status: "dropping_off" }));
      const resp = await handler(req);
      expect(resp.status).toBe(200);
      const body = await resp.json();
      expect(body.data.new_status).toBe("in_transit");
    });

    it("returns idempotent response when status matches latest", async () => {
      mockClient = createMockAdminClient({
        shipment: { ...DEFAULT_SHIPMENT, latest_biteship_status: "delivered" },
        order: DEFAULT_ORDER,
      });
      handler = createBiteshipWebhookHandler({ getAdminClient: () => mockClient });

      const req = makeRequest(makeStatusPayload({ status: "delivered" }));
      const resp = await handler(req);
      expect(resp.status).toBe(200);
      const body = await resp.json();
      expect(body.message).toBe("Status already up to date (idempotent)");
    });

    it("skips status change for terminal order", async () => {
      mockClient = createMockAdminClient({
        shipment: DEFAULT_SHIPMENT,
        order: { ...DEFAULT_ORDER, status: "delivered" },
      });
      handler = createBiteshipWebhookHandler({ getAdminClient: () => mockClient });

      const req = makeRequest(makeStatusPayload({ status: "delivered" }));
      const resp = await handler(req);
      expect(resp.status).toBe(200);
      const body = await resp.json();
      expect(body.message).toBe("Order already in terminal status");
    });

    it("stores status but doesn't advance when payment not settled", async () => {
      mockClient = createMockAdminClient({
        shipment: DEFAULT_SHIPMENT,
        order: { ...DEFAULT_ORDER, payment_status: "pending" },
      });
      handler = createBiteshipWebhookHandler({ getAdminClient: () => mockClient });

      const req = makeRequest(makeStatusPayload({ status: "delivered" }));
      const resp = await handler(req);
      expect(resp.status).toBe(200);
      const body = await resp.json();
      expect(body.message).toBe("Payment not settled, status stored for later sync");
    });

    it("prevents backward status transition", async () => {
      mockClient = createMockAdminClient({
        shipment: DEFAULT_SHIPMENT,
        order: { ...DEFAULT_ORDER, status: "in_transit" },
      });
      handler = createBiteshipWebhookHandler({ getAdminClient: () => mockClient });

      // confirmed maps to awaiting_shipment which is backward from in_transit
      const req = makeRequest(makeStatusPayload({ status: "confirmed" }));
      const resp = await handler(req);
      expect(resp.status).toBe(200);
      const body = await resp.json();
      expect(body.message).toBe("Status not advanced (forward-only rule)");
    });

    it("returns 400 when status field is missing", async () => {
      const req = makeRequest({ event: "order.status", order_id: "biteship-order-123" });
      const resp = await handler(req);
      expect(resp.status).toBe(400);
    });

    it("returns 200/ignored when no matching shipment found", async () => {
      mockClient = createMockAdminClient({ shipment: null, order: DEFAULT_ORDER });
      handler = createBiteshipWebhookHandler({ getAdminClient: () => mockClient });

      const req = makeRequest(makeStatusPayload());
      const resp = await handler(req);
      expect(resp.status).toBe(200);
      const body = await resp.json();
      expect(body.status).toBe("ignored");
    });

    it("handles exception statuses (on_hold) without changing order status", async () => {
      mockClient = createMockAdminClient({
        shipment: DEFAULT_SHIPMENT,
        order: { ...DEFAULT_ORDER, status: "in_transit" },
      });
      handler = createBiteshipWebhookHandler({ getAdminClient: () => mockClient });

      const req = makeRequest(makeStatusPayload({ status: "on_hold" }));
      const resp = await handler(req);
      expect(resp.status).toBe(200);
      const body = await resp.json();
      // on_hold resolves to current status (in_transit) — no change
      expect(body.data.status_changed).toBe(false);
    });
  });

  describe("unknown events", () => {
    it("returns ignored for unknown event types", async () => {
      const req = makeRequest({
        event: "order.unknown",
        order_id: "biteship-order-123",
      });
      const resp = await handler(req);
      expect(resp.status).toBe(200);
      const body = await resp.json();
      expect(body.status).toBe("ignored");
    });
  });
});
