import { beforeEach, describe, expect, it, vi } from "vitest";
import { createConfirmOrderReceivedHandler } from "../handler.ts";

type OrderRow = {
  id: string;
  user_id: string | null;
  status: string;
  payment_status: string;
  delivered_at: string | null;
  complaint_window_expires_at: string | null;
  customer_completed_at: string | null;
};

type ProfileRow = {
  is_banned: boolean | null;
};

function createRequest(body: unknown = { order_id: "order-1" }, headers: Record<string, string> = {}) {
  return new Request("https://example.test/functions/v1/confirm-order-received", {
    method: "POST",
    headers: {
      Authorization: "Bearer user-token",
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function createOrder(overrides: Partial<OrderRow> = {}): OrderRow {
  return {
    id: "order-1",
    user_id: "user-1",
    status: "delivered",
    payment_status: "settlement",
    delivered_at: "2026-05-25T09:00:00.000Z",
    complaint_window_expires_at: "2026-05-28T09:00:00.000Z",
    customer_completed_at: null,
    ...overrides,
  };
}

function createAdminClient(options: {
  order?: OrderRow | null;
  orderError?: { message: string } | null;
  updatedOrder?: { id: string; status: string; customer_completed_at: string | null } | null;
  updateError?: { message: string } | null;
  existingOrder?: { id: string; status: string; customer_completed_at: string | null } | null;
  existingOrderError?: { message: string } | null;
  activityError?: { message: string } | null;
  notificationError?: { message?: string; code?: string } | null;
  profile?: ProfileRow | null;
  profileError?: { message: string } | null;
} = {}) {
  const profileSingle = vi.fn(async () => ({
    data: options.profile ?? { is_banned: false },
    error: options.profileError ?? null,
  }));
  const profilesSelect = vi.fn(() => ({
    eq: vi.fn(() => ({ single: profileSingle })),
  }));
  const maybeSingleOrder = vi.fn(async () => ({ data: options.order ?? createOrder(), error: options.orderError ?? null }));
  const maybeSingleUpdated = vi.fn(async () => ({
    data: options.updatedOrder === undefined
      ? { id: "order-1", status: "delivered", customer_completed_at: "2026-05-25T10:00:00.000Z" }
      : options.updatedOrder,
    error: options.updateError ?? null,
  }));
  const maybeSingleExisting = vi.fn(async () => ({
    data: options.existingOrder ?? { id: "order-1", status: "delivered", customer_completed_at: "2026-05-25T10:01:00.000Z" },
    error: options.existingOrderError ?? null,
  }));
  const ordersSelect = vi.fn(() => ({
    eq: vi.fn(() => ({ maybeSingle: maybeSingleExisting })),
  }));
  const ordersUpdate = vi.fn(() => ({
    eq: vi.fn(() => ({
      is: vi.fn(() => ({
        select: vi.fn(() => ({ maybeSingle: maybeSingleUpdated })),
      })),
    })),
  }));
  const activityInsert = vi.fn(async () => ({ error: options.activityError ?? null }));
  const notificationInsert = vi.fn(async () => ({ error: options.notificationError ?? null }));
  const from = vi.fn((tableName: string) => {
    if (tableName === "order_read_model") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle: maybeSingleOrder })),
        })),
      };
    }
    if (tableName === "profiles") {
      return { select: profilesSelect };
    }
    if (tableName === "orders") {
      return { select: ordersSelect, update: ordersUpdate };
    }
    if (tableName === "order_activities") {
      return { insert: activityInsert };
    }
    if (tableName === "notifications") {
      return { insert: notificationInsert };
    }
    throw new Error(`Unexpected table: ${tableName}`);
  });

  return {
    adminClient: { from },
    from,
    ordersUpdate,
    ordersSelect,
    activityInsert,
    notificationInsert,
    profileSingle,
    profilesSelect,
  };
}

function createHandler(options: Parameters<typeof createAdminClient>[0] & { userId?: string | null } = {}) {
  const admin = createAdminClient(options);
  const getAuthenticatedUserId = vi.fn(async () => options.userId === undefined ? "user-1" : options.userId);
  const logError = vi.fn();
  const handler = createConfirmOrderReceivedHandler({
    getAuthenticatedUserId,
    getAdminClient: () => admin.adminClient as never,
    now: () => "2026-05-25T10:00:00.000Z",
    logError,
  });

  return { handler, admin, getAuthenticatedUserId, logError };
}

describe("confirm-order-received handler", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects missing authenticated user", async () => {
    const { handler, admin } = createHandler({ userId: null });

    const response = await handler(createRequest());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(admin.from).not.toHaveBeenCalled();
  });

  it("rejects malformed input without mutating order state", async () => {
    const { handler, admin } = createHandler();

    const response = await handler(createRequest({ order_id: " " }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "order_id is required" });
    expect(admin.from).not.toHaveBeenCalled();
  });

  it("does not expose another customer's order", async () => {
    const { handler, admin } = createHandler({ order: createOrder({ user_id: "other-user" }) });

    const response = await handler(createRequest());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Order not found" });
    expect(admin.ordersUpdate).not.toHaveBeenCalled();
  });

  it("rejects delivered orders that are not settled", async () => {
    const { handler, admin } = createHandler({ order: createOrder({ payment_status: "pending" }) });

    const response = await handler(createRequest());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Only paid orders can be confirmed" });
    expect(admin.ordersUpdate).not.toHaveBeenCalled();
  });

  it("rejects non-delivered orders before completion mutation", async () => {
    const { handler, admin } = createHandler({ order: createOrder({ status: "shipped" }) });

    const response = await handler(createRequest());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Only delivered orders can be confirmed" });
    expect(admin.ordersUpdate).not.toHaveBeenCalled();
  });

  it("blocks banned customers before completion mutation and ignores user-editable request metadata", async () => {
    const { handler, admin } = createHandler({ profile: { is_banned: true } });

    const response = await handler(createRequest({
      order_id: "order-1",
      user_metadata: { is_banned: false },
      raw_user_meta_data: { is_banned: false },
    }));
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toEqual({ error: "Customer account is not allowed to confirm received orders" });
    expect(admin.profileSingle).toHaveBeenCalledTimes(1);
    expect(admin.ordersUpdate).not.toHaveBeenCalled();
    expect(admin.activityInsert).not.toHaveBeenCalled();
    expect(admin.notificationInsert).not.toHaveBeenCalled();
  });

  it("marks a delivered settled order as customer completed and writes activity plus notification", async () => {
    const { handler, admin } = createHandler();

    const response = await handler(createRequest());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      success: true,
      data: {
        order_id: "order-1",
        status: "delivered",
        customer_completion_stage: "completed",
        customer_completed_at: "2026-05-25T10:00:00.000Z",
      },
    });
    expect(admin.ordersUpdate).toHaveBeenCalledWith(expect.objectContaining({
      customer_completed_at: "2026-05-25T10:00:00.000Z",
      customer_completed_by: "user-1",
      customer_completion_source: "customer",
    }));
    expect(admin.activityInsert).toHaveBeenCalledWith(expect.objectContaining({
      order_id: "order-1",
      action: "customer_completed",
      actor_id: "user-1",
      actor_type: "customer",
    }));
    expect(admin.notificationInsert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: "user-1",
      type: "order_completed",
      source_event_key: "order_completed:order-1",
    }));
  });

  it("keeps already-completed orders idempotent without updating orders again", async () => {
    const completedAt = "2026-05-25T08:00:00.000Z";
    const { handler, admin } = createHandler({
      order: createOrder({ customer_completed_at: completedAt }),
    });

    const response = await handler(createRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: {
        order_id: "order-1",
        status: "delivered",
        customer_completion_stage: "completed",
        customer_completed_at: completedAt,
      },
    });
    expect(admin.ordersUpdate).not.toHaveBeenCalled();
    expect(admin.activityInsert).not.toHaveBeenCalled();
    expect(admin.notificationInsert).toHaveBeenCalledTimes(1);
  });

  it("returns a safe failure for order read database errors", async () => {
    const { handler, admin, logError } = createHandler({
      order: null,
      orderError: { message: "permission denied for table order_read_model" },
    });

    const response = await handler(createRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Internal server error" });
    expect(admin.ordersUpdate).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith("confirm_order_received_failed");
  });

  it("continues when activity logging fails but notification succeeds", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { handler, admin } = createHandler({ activityError: { message: "activity insert failed" } });

    const response = await handler(createRequest());

    expect(response.status).toBe(200);
    expect(admin.activityInsert).toHaveBeenCalledTimes(1);
    expect(admin.notificationInsert).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("returns a safe failure when durable notification insert fails", async () => {
    const { handler, logError } = createHandler({
      notificationError: { message: "permission denied for notifications" },
    });

    const response = await handler(createRequest());
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({ error: "Internal server error" });
    expect(JSON.stringify(payload)).not.toContain("notifications");
    expect(logError).toHaveBeenCalledWith("confirm_order_received_failed");
  });
});
