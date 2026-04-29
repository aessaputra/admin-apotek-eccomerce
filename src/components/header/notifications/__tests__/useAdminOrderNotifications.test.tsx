import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAdminOrderNotifications } from "../useAdminOrderNotifications";
import type { NotificationRow } from "../types";

type QueryResult = {
  data?: NotificationRow[] | null;
  error?: Error | null;
  count?: number | null;
};

type QueryBuilder = PromiseLike<QueryResult> & {
  eq: ReturnType<typeof vi.fn>;
  is: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  update?: ReturnType<typeof vi.fn>;
  operations: string[];
};

const mocks = vi.hoisted(() => {
  const open = vi.fn();
  const translate = vi.fn((_key: string, _params?: Record<string, unknown>, fallback?: string) => fallback ?? _key);
  const from = vi.fn();
  const removeChannel = vi.fn();
  const channel = vi.fn();
  const latestResult = { data: [] as NotificationRow[], error: null as Error | null };
  const countResult = { count: 0 as number | null, error: null as Error | null };
  const updateResult = { data: null, error: null as Error | null };
  const builders: QueryBuilder[] = [];
  const channels: Array<{
    topic: string;
    on: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
    insertCallback?: (payload: { new: NotificationRow }) => void;
    statusCallback?: (status: string) => void;
  }> = [];

  const createBuilder = (result: QueryResult): QueryBuilder => {
    const builder = {
      operations: [] as string[],
      eq: vi.fn((column: string, value: unknown) => {
        builder.operations.push(`eq:${column}:${String(value)}`);
        return builder;
      }),
      is: vi.fn((column: string, value: unknown) => {
        builder.operations.push(`is:${column}:${String(value)}`);
        return builder;
      }),
      order: vi.fn((column: string, options: { ascending: boolean }) => {
        builder.operations.push(`order:${column}:${String(options.ascending)}`);
        return builder;
      }),
      limit: vi.fn((limit: number) => {
        builder.operations.push(`limit:${limit}`);
        return builder;
      }),
      then: (resolve?: (value: QueryResult) => unknown, reject?: (reason: unknown) => unknown) => (
        Promise.resolve(result).then(resolve, reject)
      ),
    } as QueryBuilder;

    builders.push(builder);
    return builder;
  };

  const reset = () => {
    open.mockReset();
    translate.mockClear();
    from.mockReset();
    removeChannel.mockReset();
    channel.mockReset();
    builders.length = 0;
    channels.length = 0;
    latestResult.data = [];
    latestResult.error = null;
    countResult.count = 0;
    countResult.error = null;
    updateResult.error = null;

    from.mockImplementation((table: string) => ({
      select: vi.fn((columns: string, options?: { count?: string; head?: boolean }) => {
        const result = options?.head ? countResult : latestResult;
        const builder = createBuilder(result);
        builder.operations.push(`from:${table}`);
        builder.operations.push(`select:${columns}`);
        if (options?.count) builder.operations.push(`count:${options.count}`);
        if (options?.head) builder.operations.push("head:true");
        return builder;
      }),
      update: vi.fn((values: Record<string, unknown>) => {
        const builder = createBuilder(updateResult);
        builder.update = vi.fn(() => builder);
        builder.operations.push(`from:${table}`);
        builder.operations.push(`update:${Object.keys(values).join(",")}`);
        return builder;
      }),
    }));

    channel.mockImplementation((topic: string) => {
      const createdChannel = {
        topic,
        on: vi.fn((_event: string, _config: Record<string, unknown>, callback: (payload: { new: NotificationRow }) => void) => {
          createdChannel.insertCallback = callback;
          return createdChannel;
        }),
        subscribe: vi.fn((callback: (status: string) => void) => {
          createdChannel.statusCallback = callback;
          return createdChannel;
        }),
        insertCallback: undefined as ((payload: { new: NotificationRow }) => void) | undefined,
        statusCallback: undefined as ((status: string) => void) | undefined,
      };
      channels.push(createdChannel);
      return createdChannel;
    });
  };

  return {
    builders,
    channel,
    channels,
    countResult,
    from,
    latestResult,
    open,
    removeChannel,
    reset,
    translate,
    updateResult,
  };
});

vi.mock("@refinedev/core", () => ({
  useNotification: () => ({ open: mocks.open }),
  useTranslation: () => ({ translate: mocks.translate }),
}));

vi.mock("../../../../providers/supabase-client", () => ({
  supabaseClient: {
    from: mocks.from,
    channel: mocks.channel,
    removeChannel: mocks.removeChannel,
  },
}));

const createRow = (overrides: Partial<NotificationRow> = {}): NotificationRow => ({
  id: "notification-1",
  user_id: "user-1",
  type: "new_order",
  title: "New order received",
  body: "Alice placed an order",
  cta_route: "/orders/show/order-1",
  data: {
    audience: "admin_dashboard",
    orderId: "order-1",
    customerName: "Alice",
    orderStatus: "pending",
    paymentStatus: "settlement",
    createdAt: "2026-04-29T10:00:00.000Z",
    route: "/orders/show/order-1",
  },
  priority: "normal",
  source_event_key: "admin:new-order:order-1",
  read_at: null,
  created_at: "2026-04-29T10:00:00.000Z",
  ...overrides,
});

describe("useAdminOrderNotifications", () => {
  beforeEach(() => {
    mocks.reset();
  });

  it("does not query or subscribe without a user id", () => {
    const { result } = renderHook(() => useAdminOrderNotifications({}));

    expect(result.current.notifications).toEqual([]);
    expect(result.current.unreadCount).toBe(0);
    expect(result.current.loading).toBe(false);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.channel).not.toHaveBeenCalled();
  });

  it("loads latest notifications and exact unread count for the current user", async () => {
    mocks.latestResult.data = [createRow()];
    mocks.countResult.count = 3;

    const { result } = renderHook(() => useAdminOrderNotifications({ userId: "user-1" }));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.notifications).toEqual([
      expect.objectContaining({
        id: "notification-1",
        userId: "user-1",
        orderId: "order-1",
        route: "/orders/show/order-1",
        customerName: "Alice",
      }),
    ]);
    expect(result.current.unreadCount).toBe(3);
    expect(mocks.builders[0].operations).toEqual(expect.arrayContaining([
      "from:notifications",
      "eq:user_id:user-1",
      "eq:type:new_order",
      "eq:data->>audience:admin_dashboard",
      "order:created_at:false",
      "limit:10",
    ]));
    expect(mocks.builders[1].operations).toEqual(expect.arrayContaining([
      "select:id",
      "count:exact",
      "head:true",
      "eq:user_id:user-1",
      "eq:type:new_order",
      "eq:data->>audience:admin_dashboard",
      "is:read_at:null",
    ]));
  });

  it("ignores non-admin-dashboard initial rows even when they contain order routes", async () => {
    mocks.latestResult.data = [
      createRow({ id: "notification-1" }),
      createRow({
        id: "wrong-type",
        type: "marketing",
        cta_route: "/orders/show/order-marketing",
        data: {
          audience: "admin_dashboard",
          orderId: "order-marketing",
          route: "/orders/show/order-marketing",
        },
        source_event_key: "marketing:order-marketing",
      }),
      createRow({
        id: "missing-audience",
        cta_route: "/orders/show/order-missing-audience",
        data: {
          orderId: "order-missing-audience",
          route: "/orders/show/order-missing-audience",
        },
        source_event_key: "admin:new-order:missing-audience",
      }),
      createRow({
        id: "customer-audience",
        cta_route: "/orders/show/order-customer",
        data: {
          audience: "customer_app",
          orderId: "order-customer",
          route: "/orders/show/order-customer",
        },
        source_event_key: "admin:new-order:customer-audience",
      }),
    ];
    mocks.countResult.count = 1;

    const { result } = renderHook(() => useAdminOrderNotifications({ userId: "user-1" }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.notifications).toHaveLength(1);
    expect(result.current.notifications[0].id).toBe("notification-1");
    expect(result.current.unreadCount).toBe(1);
  });

  it("adds one realtime notification", async () => {
    mocks.latestResult.data = [];
    mocks.countResult.count = 0;

    const { result } = renderHook(() => useAdminOrderNotifications({ userId: "user-1" }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      mocks.channels[0].insertCallback?.({
        new: createRow({
          id: "notification-2",
          cta_route: "/not-orders/order-2",
          data: {
            audience: "admin_dashboard",
            orderId: "order-2",
            customerName: "Bob",
            orderStatus: "pending",
            paymentStatus: "pending",
          },
          source_event_key: "admin:new-order:order-2",
          created_at: "2026-04-29T10:01:00.000Z",
        }),
      });
    });

    expect(result.current.notifications).toHaveLength(1);
    expect(result.current.notifications[0]).toEqual(expect.objectContaining({
      id: "notification-2",
      orderId: "order-2",
      route: "/orders/show/order-2",
    }));
    expect(result.current.unreadCount).toBe(1);
    expect(mocks.channel).toHaveBeenCalledWith("admin-order-notifications-user-1");
    expect(mocks.channels[0].on).toHaveBeenCalledWith(
      "postgres_changes",
      expect.objectContaining({
        event: "INSERT",
        schema: "public",
        table: "notifications",
        filter: "user_id=eq.user-1",
      }),
      expect.any(Function),
    );
  });

  it("ignores unrelated same-user realtime rows without changing unread count", async () => {
    mocks.latestResult.data = [];
    mocks.countResult.count = 0;

    const { result } = renderHook(() => useAdminOrderNotifications({ userId: "user-1" }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      mocks.channels[0].insertCallback?.({
        new: createRow({
          id: "wrong-type-realtime",
          type: "promotion",
          cta_route: "/orders/show/order-promo",
          data: {
            audience: "admin_dashboard",
            orderId: "order-promo",
            route: "/orders/show/order-promo",
          },
          source_event_key: "promotion:order-promo",
        }),
      });
      mocks.channels[0].insertCallback?.({
        new: createRow({
          id: "missing-audience-realtime",
          cta_route: "/orders/show/order-missing-audience",
          data: {
            orderId: "order-missing-audience",
            route: "/orders/show/order-missing-audience",
          },
          source_event_key: "admin:new-order:missing-audience-realtime",
        }),
      });
      mocks.channels[0].insertCallback?.({
        new: createRow({
          id: "customer-audience-realtime",
          cta_route: "/orders/show/order-customer",
          data: {
            audience: "customer_app",
            orderId: "order-customer",
            route: "/orders/show/order-customer",
          },
          source_event_key: "admin:new-order:customer-audience-realtime",
        }),
      });
    });

    expect(result.current.notifications).toEqual([]);
    expect(result.current.unreadCount).toBe(0);
  });

  it("dedupes by source_event_key", async () => {
    mocks.latestResult.data = [createRow({ id: "notification-1" })];
    mocks.countResult.count = 1;

    const { result } = renderHook(() => useAdminOrderNotifications({ userId: "user-1" }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.unreadCount).toBe(1);

    act(() => {
      mocks.channels[0].insertCallback?.({
        new: createRow({
          id: "notification-duplicate",
          source_event_key: "admin:new-order:order-1",
          created_at: "2026-04-29T10:02:00.000Z",
        }),
      });
    });

    expect(result.current.notifications).toHaveLength(1);
    expect(result.current.notifications[0].id).toBe("notification-1");
    expect(result.current.unreadCount).toBe(1);
  });

  it("falls back to id for dedupe when source event key is absent", async () => {
    mocks.latestResult.data = [createRow({ id: "same-id", source_event_key: null })];
    mocks.countResult.count = 1;

    const { result } = renderHook(() => useAdminOrderNotifications({ userId: "user-1" }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.unreadCount).toBe(1);

    act(() => {
      mocks.channels[0].insertCallback?.({
        new: createRow({
          id: "same-id",
          source_event_key: null,
          created_at: "2026-04-29T10:02:00.000Z",
        }),
      });
    });

    expect(result.current.notifications).toHaveLength(1);
    expect(result.current.notifications[0].id).toBe("same-id");
    expect(result.current.unreadCount).toBe(1);
  });

  it("removes the realtime channel on cleanup", async () => {
    const { unmount } = renderHook(() => useAdminOrderNotifications({ userId: "user-1" }));
    await waitFor(() => expect(mocks.channels).toHaveLength(1));

    unmount();

    expect(mocks.removeChannel).toHaveBeenCalledWith(mocks.channels[0]);
  });

  it("marks a notification read idempotently before returning the route", async () => {
    mocks.latestResult.data = [createRow()];
    mocks.countResult.count = 1;

    const { result } = renderHook(() => useAdminOrderNotifications({ userId: "user-1" }));
    await waitFor(() => expect(result.current.notifications).toHaveLength(1));

    let route = "";
    await act(async () => {
      route = await result.current.markAsReadAndOpen(result.current.notifications[0]);
    });

    expect(route).toBe("/orders/show/order-1");
    expect(result.current.notifications[0].readAt).toEqual(expect.any(String));
    expect(result.current.unreadCount).toBe(0);
    expect(mocks.builders[2].operations).toEqual(expect.arrayContaining([
      "from:notifications",
      "update:read_at",
      "eq:id:notification-1",
      "eq:user_id:user-1",
      "is:read_at:null",
    ]));
  });

  it("does not decrement unread count twice when read/open receives the same stale object", async () => {
    mocks.latestResult.data = [
      createRow({ id: "notification-1", source_event_key: "admin:new-order:order-1" }),
      createRow({
        id: "notification-2",
        cta_route: "/orders/show/order-2",
        data: {
          audience: "admin_dashboard",
          orderId: "order-2",
          customerName: "Bob",
          orderStatus: "processing",
          paymentStatus: "settlement",
        },
        source_event_key: "admin:new-order:order-2",
        created_at: "2026-04-29T09:59:00.000Z",
      }),
    ];
    mocks.countResult.count = 2;

    const { result } = renderHook(() => useAdminOrderNotifications({ userId: "user-1" }));
    await waitFor(() => expect(result.current.notifications).toHaveLength(2));
    const staleNotification = result.current.notifications[0];

    await act(async () => {
      await result.current.markAsReadAndOpen(staleNotification);
      await result.current.markAsReadAndOpen(staleNotification);
    });

    expect(result.current.unreadCount).toBe(1);
    expect(result.current.notifications[0].readAt).toEqual(expect.any(String));
    expect(mocks.builders[2].operations).toEqual(expect.arrayContaining([
      "eq:id:notification-1",
      "eq:user_id:user-1",
      "is:read_at:null",
    ]));
    expect(mocks.builders[3].operations).toEqual(expect.arrayContaining([
      "eq:id:notification-1",
      "eq:user_id:user-1",
      "is:read_at:null",
    ]));
  });

  it("ignores malformed rows without an order id", async () => {
    mocks.latestResult.data = [createRow({ data: { customerName: "No order" }, cta_route: "/orders" })];

    const { result } = renderHook(() => useAdminOrderNotifications({ userId: "user-1" }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.notifications).toEqual([]);

    act(() => {
      mocks.channels[0].insertCallback?.({
        new: createRow({ id: "bad-realtime", data: {}, cta_route: "/orders" }),
      });
    });

    expect(result.current.notifications).toEqual([]);
  });

  it("opens one localized notification for query or subscription failures", async () => {
    mocks.latestResult.error = new Error("query failed");

    renderHook(() => useAdminOrderNotifications({ userId: "user-1" }));
    await waitFor(() => expect(mocks.open).toHaveBeenCalledTimes(1));

    act(() => {
      mocks.channels[0].statusCallback?.("CHANNEL_ERROR");
    });

    expect(mocks.open).toHaveBeenCalledTimes(1);
    expect(mocks.open).toHaveBeenCalledWith(expect.objectContaining({
      type: "error",
      message: "New order notifications could not be loaded. Please refresh the page.",
    }));
  });
});
