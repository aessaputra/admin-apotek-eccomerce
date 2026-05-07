import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPushHandler,
  type PushAdminClient,
  type PushEnvironment,
  type PushQueryBuilder,
  type PushTableClient,
} from "../handler.ts";

type QueryError = { message: string };
type QueryResult<T> = { data: T; error: QueryError | null };
type MaybeSingleResult<T> = { data: T | null; error: QueryError | null };
type QueryFilter = { column: string; operator: string; value: unknown };
type UpdateRecord = {
  table: string;
  values: Record<string, unknown>;
  filters: QueryFilter[];
};
type UpsertRecord = {
  table: string;
  values: Record<string, unknown> | Array<Record<string, unknown>>;
};

type ProfilePushTokenFixture = {
  id: string;
  expo_push_token: string | null;
  device_id: string | null;
  platform: string | null;
};

type PendingDeliveryFixture = {
  notification_id: string;
  user_id: string;
  expo_push_token: string;
  ticket_id: string | null;
  attempt_count: number | null;
};

function createEnvMock(values: Record<string, string | undefined>) {
  const get = vi.fn((key: string) => values[key]);

  return {
    get,
  } satisfies PushEnvironment & { get: ReturnType<typeof vi.fn> };
}

class MockQueryBuilder<T> implements PushQueryBuilder<T> {
  readonly filters: QueryFilter[] = [];

  constructor(
    private readonly result: () => QueryResult<T>,
    private readonly maybeSingleResult: () => MaybeSingleResult<unknown> = () => ({
      data: null,
      error: null,
    })
  ) {}

  eq(column: string, value: unknown): PushQueryBuilder<T> {
    this.filters.push({ column, operator: "eq", value });
    return this;
  }

  is(column: string, value: unknown): PushQueryBuilder<T> {
    this.filters.push({ column, operator: "is", value });
    return this;
  }

  not(column: string, operator: string, value: unknown): PushQueryBuilder<T> {
    this.filters.push({ column, operator: `not.${operator}`, value });
    return this;
  }

  lte(column: string, value: unknown): PushQueryBuilder<T> {
    this.filters.push({ column, operator: "lte", value });
    return this;
  }

  or(filters: string): PushQueryBuilder<T> {
    this.filters.push({ column: "or", operator: "or", value: filters });
    return this;
  }

  order(): PushQueryBuilder<T> {
    return this;
  }

  limit(): PushQueryBuilder<T> {
    return this;
  }

  async maybeSingle<Row = unknown>(): Promise<MaybeSingleResult<Row>> {
    const result = this.maybeSingleResult();
    return {
      data: result.data as Row | null,
      error: result.error,
    };
  }

  then<TResult1 = QueryResult<T>, TResult2 = never>(
    onfulfilled?:
      | ((value: QueryResult<T>) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result()).then(onfulfilled, onrejected);
  }
}

function createPushClientMock(options?: {
  tokenRows?: ProfilePushTokenFixture[];
  tokenError?: string | null;
  profileToken?: string | null;
  profileError?: string | null;
  pendingDeliveries?: PendingDeliveryFixture[];
}) {
  const updates: UpdateRecord[] = [];
  const upserts: UpsertRecord[] = [];
  const selects: Array<{ table: string; columns: string }> = [];
  const selectQueries: Array<{ table: string; filters: QueryFilter[] }> = [];

  const tableClient = (table: string): PushTableClient => ({
    select: <Row = unknown>(columns: string) => {
      selects.push({ table, columns });

      if (table === "profile_push_tokens") {
        const builder = new MockQueryBuilder<Row>(() => ({
          data: (options?.tokenRows ?? []) as Row,
          error: options?.tokenError ? { message: options.tokenError } : null,
        }));
        selectQueries.push({ table, filters: builder.filters });
        return builder;
      }

      if (table === "notification_push_deliveries") {
        const builder = new MockQueryBuilder<Row>(() => ({
          data: (options?.pendingDeliveries ?? []) as Row,
          error: null,
        }));
        selectQueries.push({ table, filters: builder.filters });
        return builder;
      }

      const builder = new MockQueryBuilder<Row>(
        () => ({ data: null as Row, error: null }),
        () => ({
          data: { expo_push_token: options?.profileToken ?? null },
          error: options?.profileError
            ? { message: options.profileError }
            : null,
        })
      );
      selectQueries.push({ table, filters: builder.filters });
      return builder;
    },
    update: (values: Record<string, unknown>) => {
      const builder = new MockQueryBuilder<unknown>(() => ({
        data: null,
        error: null,
      }));
      const originalThen = builder.then.bind(builder);

      builder.then = (onfulfilled, onrejected) => {
        updates.push({ table, values, filters: [...builder.filters] });
        return originalThen(onfulfilled, onrejected);
      };

      return builder;
    },
    insert: async (
      values: Record<string, unknown> | Array<Record<string, unknown>>
    ) => {
      upserts.push({ table, values });
      return { error: null };
    },
    upsert: async (
      values: Record<string, unknown> | Array<Record<string, unknown>>
    ) => {
      upserts.push({ table, values });
      return { error: null };
    },
  });

  const client: PushAdminClient = {
    from: vi.fn(tableClient),
  };

  return { client, selects, selectQueries, updates, upserts };
}

function createNotification(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: "notif-1",
    user_id: "user-1",
    type: "order_created",
    title: "New order",
    body: "Order #1234",
    cta_route: "/orders/show/1234",
    data: { audience: "customer_app" },
    priority: "high",
    source_event_key: "order:1234",
    created_at: "2026-04-29T00:00:00.000Z",
    ...overrides,
  };
}

function createWebhookRequest(record = createNotification()) {
  return new Request("https://example.test/functions/v1/push", {
    method: "POST",
    headers: {
      Authorization: "Bearer service-role",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "INSERT",
      table: "notifications",
      schema: "public",
      record,
      old_record: null,
    }),
  });
}

describe("createPushHandler", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("skips admin dashboard notifications before profile lookup or Expo access", async () => {
    const env = createEnvMock({
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
      SUPABASE_URL: "https://demo.supabase.co",
      EXPO_ACCESS_TOKEN: "expo-secret",
    });
    const createClientFn = vi.fn();
    const fetchFn = vi.fn();

    const handler = createPushHandler({ createClientFn, env, fetchFn });

    const response = await handler(
      createWebhookRequest(
        createNotification({ data: { audience: "admin_dashboard" } })
      )
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      delivered: false,
      reason: "admin_dashboard_only",
    });
    expect(createClientFn).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(env.get).toHaveBeenCalledWith("SUPABASE_SERVICE_ROLE_KEY");
    expect(env.get).not.toHaveBeenCalledWith("EXPO_ACCESS_TOKEN");
    expect(env.get).not.toHaveBeenCalledWith("SUPABASE_URL");
  });

  it("delivers one notification to all active profile push tokens and records tickets", async () => {
    const env = createEnvMock({
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
      SUPABASE_URL: "https://demo.supabase.co",
      EXPO_ACCESS_TOKEN: "expo-secret",
    });
    const { client, selects, upserts } = createPushClientMock({
      tokenRows: [
        {
          id: "token-row-1",
          expo_push_token: "ExpoPushToken[token-one]",
          device_id: "ios-device",
          platform: "ios",
        },
        {
          id: "token-row-2",
          expo_push_token: "ExpoPushToken[token-two]",
          device_id: "android-device",
          platform: "android",
        },
      ],
    });
    const createClientFn = vi.fn(() => client);
    const fetchFn = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              { status: "ok", id: "ticket-1" },
              { status: "ok", id: "ticket-2" },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
    );

    const handler = createPushHandler({ createClientFn, env, fetchFn });

    const response = await handler(createWebhookRequest());
    const payload = await response.json();
    const [, requestInit] = fetchFn.mock.calls[0] as unknown as [
      string,
      RequestInit
    ];
    const expoBody = JSON.parse(String(requestInit?.body));
    const deliveryRows = upserts.find(
      (record) => record.table === "notification_push_deliveries"
    )?.values;

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ delivered: true });
    expect(createClientFn).toHaveBeenCalledWith(
      "https://demo.supabase.co",
      "service-role"
    );
    expect(selects).toContainEqual({
      table: "profile_push_tokens",
      columns: "id, expo_push_token, device_id, platform",
    });
    expect(fetchFn).toHaveBeenCalledWith(
      "https://exp.host/--/api/v2/push/send",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer expo-secret",
        }),
      })
    );
    expect(expoBody).toHaveLength(2);
    expect(expoBody.map((message: { to: string }) => message.to)).toEqual([
      "ExpoPushToken[token-one]",
      "ExpoPushToken[token-two]",
    ]);
    expect(deliveryRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          expo_push_token: "ExpoPushToken[token-one]",
          ticket_id: "ticket-1",
          next_retry_at: expect.any(String),
        }),
        expect.objectContaining({
          expo_push_token: "ExpoPushToken[token-two]",
          ticket_id: "ticket-2",
          next_retry_at: expect.any(String),
        }),
      ])
    );
  });

  it("records malformed profile push tokens while still delivering to valid devices", async () => {
    const env = createEnvMock({
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
      SUPABASE_URL: "https://demo.supabase.co",
      EXPO_ACCESS_TOKEN: "expo-secret",
    });
    const { client, upserts } = createPushClientMock({
      tokenRows: [
        {
          id: "token-row-invalid",
          expo_push_token: "not-an-expo-token",
          device_id: "broken-device",
          platform: "ios",
        },
        {
          id: "token-row-valid",
          expo_push_token: "ExpoPushToken[token-valid]",
          device_id: "android-device",
          platform: "android",
        },
      ],
    });
    const createClientFn = vi.fn(() => client);
    const fetchFn = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ data: [{ status: "ok", id: "ticket-valid" }] }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
    );

    const handler = createPushHandler({ createClientFn, env, fetchFn });

    const response = await handler(createWebhookRequest());
    const payload = await response.json();
    const [, requestInit] = fetchFn.mock.calls[0] as unknown as [
      string,
      RequestInit
    ];
    const expoBody = JSON.parse(String(requestInit?.body));
    const deliveryUpserts = upserts.filter(
      (record) => record.table === "notification_push_deliveries"
    );

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ delivered: true });
    expect(expoBody).toEqual([
      expect.objectContaining({ to: "ExpoPushToken[token-valid]" }),
    ]);
    expect(deliveryUpserts).toHaveLength(2);
    expect(deliveryUpserts[0]?.values).toEqual([
      expect.objectContaining({
        expo_push_token: "not-an-expo-token",
        status: "error",
        error_code: "invalid_token_format",
        failed_at: expect.any(String),
      }),
    ]);
    expect(deliveryUpserts[1]?.values).toEqual([
      expect.objectContaining({
        expo_push_token: "ExpoPushToken[token-valid]",
        ticket_id: "ticket-valid",
      }),
    ]);
  });

  it("does not record deliveries when Expo returns top-level send errors", async () => {
    const env = createEnvMock({
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
      SUPABASE_URL: "https://demo.supabase.co",
      EXPO_ACCESS_TOKEN: "expo-secret",
    });
    const { client, upserts } = createPushClientMock({
      tokenRows: [
        {
          id: "token-row-1",
          expo_push_token: "ExpoPushToken[token-one]",
          device_id: "ios-device",
          platform: "ios",
        },
      ],
    });
    const createClientFn = vi.fn(() => client);
    const fetchFn = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ errors: [{ message: "Expo service unavailable" }] }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
    );

    const handler = createPushHandler({ createClientFn, env, fetchFn });

    const response = await handler(createWebhookRequest());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      delivered: false,
      reason: "expo_response_error",
    });
    expect(upserts).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ table: "notification_push_deliveries" }),
      ])
    );
  });

  it("records retryable Expo ticket errors as terminal send failures", async () => {
    const env = createEnvMock({
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
      SUPABASE_URL: "https://demo.supabase.co",
      EXPO_ACCESS_TOKEN: "expo-secret",
    });
    const { client, upserts } = createPushClientMock({
      tokenRows: [
        {
          id: "token-row-1",
          expo_push_token: "ExpoPushToken[token-one]",
          device_id: "ios-device",
          platform: "ios",
        },
      ],
    });
    const createClientFn = vi.fn(() => client);
    const fetchFn = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                status: "error",
                message: "Rate limit exceeded",
                details: { error: "MessageRateExceeded" },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
    );

    const handler = createPushHandler({ createClientFn, env, fetchFn });

    const response = await handler(createWebhookRequest());
    const payload = await response.json();
    const deliveryRows = upserts.find(
      (record) => record.table === "notification_push_deliveries"
    )?.values;

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      delivered: false,
      reason: "MessageRateExceeded",
    });
    expect(deliveryRows).toEqual([
      expect.objectContaining({
        status: "error",
        ticket_id: null,
        error_code: "MessageRateExceeded",
        next_retry_at: null,
        failed_at: expect.any(String),
      }),
    ]);
  });

  it("falls back to the legacy profile token only when no active device rows exist", async () => {
    const env = createEnvMock({
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
      SUPABASE_URL: "https://demo.supabase.co",
      EXPO_ACCESS_TOKEN: "expo-secret",
    });
    const { client, selects } = createPushClientMock({
      tokenRows: [],
      profileToken: "ExpoPushToken[legacy-token]",
    });
    const createClientFn = vi.fn(() => client);
    const fetchFn = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ data: { status: "ok", id: "legacy-ticket" } }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        )
    );

    const handler = createPushHandler({ createClientFn, env, fetchFn });

    const response = await handler(createWebhookRequest());
    const [, requestInit] = fetchFn.mock.calls[0] as unknown as [
      string,
      RequestInit
    ];
    const expoBody = JSON.parse(String(requestInit?.body));

    expect(response.status).toBe(200);
    expect(selects).toContainEqual({
      table: "profiles",
      columns: "expo_push_token",
    });
    expect(expoBody).toEqual([
      expect.objectContaining({ to: "ExpoPushToken[legacy-token]" }),
    ]);
  });

  it("preserves profile lookup failures for legacy fallback", async () => {
    const env = createEnvMock({
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
      SUPABASE_URL: "https://demo.supabase.co",
      EXPO_ACCESS_TOKEN: "expo-secret",
    });
    const { client } = createPushClientMock({
      tokenRows: [],
      profileError: "profile unavailable",
    });
    const createClientFn = vi.fn(() => client);
    const fetchFn = vi.fn();

    const handler = createPushHandler({ createClientFn, env, fetchFn });

    const response = await handler(createWebhookRequest());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      delivered: false,
      reason: "profile_lookup_failed",
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("revokes only the token row and matching legacy value for DeviceNotRegistered", async () => {
    const env = createEnvMock({
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
      SUPABASE_URL: "https://demo.supabase.co",
      EXPO_ACCESS_TOKEN: "expo-secret",
    });
    const { client, updates } = createPushClientMock({
      tokenRows: [
        {
          id: "token-row-1",
          expo_push_token: "ExpoPushToken[token-one]",
          device_id: "ios-device",
          platform: "ios",
        },
        {
          id: "token-row-2",
          expo_push_token: "ExpoPushToken[token-two]",
          device_id: "android-device",
          platform: "android",
        },
      ],
    });
    const createClientFn = vi.fn(() => client);
    const fetchFn = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              { status: "ok", id: "ticket-1" },
              {
                status: "error",
                message: "Device is not registered",
                details: { error: "DeviceNotRegistered" },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
    );

    const handler = createPushHandler({ createClientFn, env, fetchFn });

    const response = await handler(createWebhookRequest());
    const payload = await response.json();
    const tokenRevoke = updates.find(
      (record) => record.table === "profile_push_tokens"
    );
    const legacyCleanup = updates.find((record) => record.table === "profiles");

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      delivered: false,
      reason: "DeviceNotRegistered",
    });
    expect(tokenRevoke?.filters).toEqual(
      expect.arrayContaining([
        { column: "user_id", operator: "eq", value: "user-1" },
        {
          column: "expo_push_token",
          operator: "eq",
          value: "ExpoPushToken[token-two]",
        },
        { column: "revoked_at", operator: "is", value: null },
        { column: "id", operator: "eq", value: "token-row-2" },
      ])
    );
    expect(legacyCleanup?.filters).toEqual(
      expect.arrayContaining([
        { column: "id", operator: "eq", value: "user-1" },
        {
          column: "expo_push_token",
          operator: "eq",
          value: "ExpoPushToken[token-two]",
        },
      ])
    );
    expect(updates).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filters: expect.arrayContaining([
            {
              column: "expo_push_token",
              operator: "eq",
              value: "ExpoPushToken[token-one]",
            },
          ]),
        }),
      ])
    );
  });

  it("polls Expo receipts, updates deliveries, and revokes unregistered receipt tokens", async () => {
    const env = createEnvMock({
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
      SUPABASE_URL: "https://demo.supabase.co",
      EXPO_ACCESS_TOKEN: "expo-secret",
    });
    const { client, selectQueries, updates } = createPushClientMock({
      pendingDeliveries: [
        {
          notification_id: "notif-1",
          user_id: "user-1",
          expo_push_token: "ExpoPushToken[token-one]",
          ticket_id: "ticket-ok",
          attempt_count: 1,
        },
        {
          notification_id: "notif-1",
          user_id: "user-1",
          expo_push_token: "ExpoPushToken[token-two]",
          ticket_id: "ticket-bad",
          attempt_count: 1,
        },
      ],
    });
    const createClientFn = vi.fn(() => client);
    const fetchFn = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              "ticket-ok": { status: "ok" },
              "ticket-bad": {
                status: "error",
                message: "Device is not registered",
                details: { error: "DeviceNotRegistered" },
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
    );

    const handler = createPushHandler({ createClientFn, env, fetchFn });

    const response = await handler(
      new Request("https://example.test/functions/v1/push", {
        method: "POST",
        headers: {
          Authorization: "Bearer service-role",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "process_receipts", limit: 20 }),
      })
    );
    const payload = await response.json();
    const [, requestInit] = fetchFn.mock.calls[0] as unknown as [
      string,
      RequestInit
    ];
    const receiptBody = JSON.parse(String(requestInit?.body));
    const receiptSelect = selectQueries.find(
      (query) => query.table === "notification_push_deliveries"
    );

    expect(response.status).toBe(200);
    expect(payload).toEqual({ processed: true, receipts: 2 });
    expect(receiptSelect?.filters).toEqual(
      expect.arrayContaining([
        { column: "ticket_id", operator: "not.is", value: null },
        { column: "receipt_id", operator: "is", value: null },
        { column: "delivered_at", operator: "is", value: null },
        { column: "failed_at", operator: "is", value: null },
        expect.objectContaining({
          column: "or",
          operator: "or",
          value: expect.stringContaining(
            "next_retry_at.is.null,next_retry_at.lte."
          ),
        }),
      ])
    );
    expect(fetchFn).toHaveBeenCalledWith(
      "https://exp.host/--/api/v2/push/getReceipts",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer expo-secret",
        }),
      })
    );
    expect(receiptBody).toEqual({ ids: ["ticket-ok", "ticket-bad"] });
    expect(updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "notification_push_deliveries",
          values: expect.objectContaining({
            status: "delivered",
            receipt_id: "ticket-ok",
          }),
          filters: [
            { column: "ticket_id", operator: "eq", value: "ticket-ok" },
          ],
        }),
        expect.objectContaining({
          table: "notification_push_deliveries",
          values: expect.objectContaining({
            status: "error",
            receipt_id: "ticket-bad",
            error_code: "DeviceNotRegistered",
          }),
          filters: [
            { column: "ticket_id", operator: "eq", value: "ticket-bad" },
          ],
        }),
        expect.objectContaining({
          table: "profile_push_tokens",
          filters: expect.arrayContaining([
            { column: "user_id", operator: "eq", value: "user-1" },
            {
              column: "expo_push_token",
              operator: "eq",
              value: "ExpoPushToken[token-two]",
            },
          ]),
        }),
      ])
    );
  });

  it("does not update deliveries when Expo returns top-level receipt errors", async () => {
    const env = createEnvMock({
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
      SUPABASE_URL: "https://demo.supabase.co",
      EXPO_ACCESS_TOKEN: "expo-secret",
    });
    const { client, updates } = createPushClientMock({
      pendingDeliveries: [
        {
          notification_id: "notif-1",
          user_id: "user-1",
          expo_push_token: "ExpoPushToken[token-one]",
          ticket_id: "ticket-one",
          attempt_count: 1,
        },
      ],
    });
    const createClientFn = vi.fn(() => client);
    const fetchFn = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ errors: [{ message: "Expo receipt outage" }] }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
    );

    const handler = createPushHandler({ createClientFn, env, fetchFn });

    const response = await handler(
      new Request("https://example.test/functions/v1/push", {
        method: "POST",
        headers: {
          Authorization: "Bearer service-role",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "process_receipts" }),
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      processed: false,
      reason: "expo_receipt_response_error",
    });
    expect(updates).toHaveLength(0);
  });

  it("keeps retryable receipt errors eligible for the next receipt poll", async () => {
    const env = createEnvMock({
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
      SUPABASE_URL: "https://demo.supabase.co",
      EXPO_ACCESS_TOKEN: "expo-secret",
    });
    const { client, updates } = createPushClientMock({
      pendingDeliveries: [
        {
          notification_id: "notif-1",
          user_id: "user-1",
          expo_push_token: "ExpoPushToken[token-one]",
          ticket_id: "ticket-retry",
          attempt_count: 1,
        },
      ],
    });
    const createClientFn = vi.fn(() => client);
    const fetchFn = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              "ticket-retry": {
                status: "error",
                message: "Message rate exceeded",
                details: { error: "MessageRateExceeded" },
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
    );

    const handler = createPushHandler({ createClientFn, env, fetchFn });

    const response = await handler(
      new Request("https://example.test/functions/v1/push", {
        method: "POST",
        headers: {
          Authorization: "Bearer service-role",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "process_receipts" }),
      })
    );
    const payload = await response.json();
    const deliveryUpdate = updates.find(
      (record) => record.table === "notification_push_deliveries"
    );

    expect(response.status).toBe(200);
    expect(payload).toEqual({ processed: true, receipts: 1 });
    expect(deliveryUpdate?.values).toEqual(
      expect.objectContaining({
        status: "error",
        error_code: "MessageRateExceeded",
        error_message: "Message rate exceeded",
        attempt_count: 2,
        next_retry_at: expect.any(String),
        delivered_at: null,
        failed_at: null,
      })
    );
    expect(deliveryUpdate?.values).not.toHaveProperty("receipt_id");
  });
});
