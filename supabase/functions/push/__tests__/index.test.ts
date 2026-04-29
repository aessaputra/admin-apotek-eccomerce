import { describe, expect, it, vi } from "vitest";
import { createPushHandler, type PushAdminClient, type PushEnvironment } from "../handler.ts";

function createEnvMock(values: Record<string, string | undefined>) {
  const get = vi.fn((key: string) => values[key]);

  return {
    get,
  } satisfies PushEnvironment & { get: ReturnType<typeof vi.fn> };
}

function createPushClientMock(options?: {
  profileToken?: string | null;
  profileError?: string | null;
}) {
  const selectSpy = vi.fn();
  const eqSpy = vi.fn();
  const maybeSingle = vi.fn(async () => {
    if (options?.profileError) {
      return { data: null, error: { message: options.profileError } };
    }

    return {
      data: { expo_push_token: options?.profileToken ?? null },
      error: null,
    };
  });

  const client: PushAdminClient = {
    from: vi.fn(() => ({
      select: selectSpy.mockImplementation(() => ({
        eq: eqSpy.mockImplementation(() => ({
          maybeSingle,
        })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(async () => ({ error: null })),
      })),
    })),
  };

  return { client, selectSpy, eqSpy, maybeSingle };
}

describe("createPushHandler", () => {
  it("skips admin dashboard notifications before profile lookup or Expo access", async () => {
    const env = createEnvMock({
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
      SUPABASE_URL: "https://demo.supabase.co",
      EXPO_ACCESS_TOKEN: "expo-secret",
    });
    const createClientFn = vi.fn();
    const fetchFn = vi.fn();

    const handler = createPushHandler({
      createClientFn,
      env,
      fetchFn,
    });

    const response = await handler(
      new Request("https://example.test/functions/v1/push", {
        method: "POST",
        headers: {
          Authorization: "Bearer service-role",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "INSERT",
          table: "notifications",
          schema: "public",
          record: {
            id: "notif-1",
            user_id: "user-1",
            type: "order_created",
            title: "New order",
            body: "Order #1234",
            cta_route: "/orders/show/1234",
            data: { audience: "admin_dashboard" },
            priority: "high",
            source_event_key: "order:1234",
            created_at: "2026-04-29T00:00:00.000Z",
          },
          old_record: null,
        }),
      }),
    );

    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ delivered: false, reason: "admin_dashboard_only" });
    expect(createClientFn).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(env.get).toHaveBeenCalledWith("SUPABASE_SERVICE_ROLE_KEY");
    expect(env.get).not.toHaveBeenCalledWith("EXPO_ACCESS_TOKEN");
    expect(env.get).not.toHaveBeenCalledWith("SUPABASE_URL");
  });

  it("delivers supported notifications through Expo", async () => {
    const env = createEnvMock({
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
      SUPABASE_URL: "https://demo.supabase.co",
      EXPO_ACCESS_TOKEN: "expo-secret",
    });
    const { client, selectSpy, eqSpy, maybeSingle } = createPushClientMock({
      profileToken: "ExpoPushToken[abc123]",
    });
    const createClientFn = vi.fn(() => client);
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ data: { status: "ok", id: "ticket-1" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const handler = createPushHandler({
      createClientFn,
      env,
      fetchFn,
    });

    const response = await handler(
      new Request("https://example.test/functions/v1/push", {
        method: "POST",
        headers: {
          Authorization: "Bearer service-role",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "INSERT",
          table: "notifications",
          schema: "public",
          record: {
            id: "notif-2",
            user_id: "user-2",
            type: "order_created",
            title: "New order",
            body: "Order #5678",
            cta_route: "/orders/show/5678",
            data: { audience: "customer_app" },
            priority: "normal",
            source_event_key: "order:5678",
            created_at: "2026-04-29T00:00:00.000Z",
          },
          old_record: null,
        }),
      }),
    );

    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ delivered: true, tickets: [{ status: "ok", id: "ticket-1" }] });
    expect(createClientFn).toHaveBeenCalledWith("https://demo.supabase.co", "service-role");
    expect(selectSpy).toHaveBeenCalledWith("expo_push_token");
    expect(eqSpy).toHaveBeenCalledWith("id", "user-2");
    expect(maybeSingle).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith(
      "https://exp.host/--/api/v2/push/send",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer expo-secret",
        }),
      }),
    );
  });

  it("preserves profile lookup failures for non-admin notifications", async () => {
    const env = createEnvMock({
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
      SUPABASE_URL: "https://demo.supabase.co",
      EXPO_ACCESS_TOKEN: "expo-secret",
    });
    const { client, maybeSingle } = createPushClientMock({
      profileError: "profile unavailable",
    });
    const createClientFn = vi.fn(() => client);
    const fetchFn = vi.fn();

    const handler = createPushHandler({
      createClientFn,
      env,
      fetchFn,
    });

    const response = await handler(
      new Request("https://example.test/functions/v1/push", {
        method: "POST",
        headers: {
          Authorization: "Bearer service-role",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "INSERT",
          table: "notifications",
          schema: "public",
          record: {
            id: "notif-3",
            user_id: "user-3",
            type: "order_created",
            title: "New order",
            body: "Order #9012",
            cta_route: "/orders/show/9012",
            data: { audience: "customer_app" },
            priority: "low",
            source_event_key: "order:9012",
            created_at: "2026-04-29T00:00:00.000Z",
          },
          old_record: null,
        }),
      }),
    );

    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ delivered: false, reason: "profile_lookup_failed" });
    expect(createClientFn).toHaveBeenCalledWith("https://demo.supabase.co", "service-role");
    expect(maybeSingle).toHaveBeenCalledTimes(1);
    expect(env.get).not.toHaveBeenCalledWith("EXPO_ACCESS_TOKEN");
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
