import { describe, expect, it, vi } from "vitest";

import {
  createBanCustomerHandler,
  type BanCustomerAdminClient,
  type BanCustomerAuthClient,
} from "../handler.ts";

function createRequest(body: Record<string, unknown>, authorization = "Bearer admin-token") {
  return new Request("https://example.test/functions/v1/ban-customer", {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function createOptionsRequest() {
  return new Request("https://example.test/functions/v1/ban-customer", {
    method: "OPTIONS",
  });
}

function createAuthClient(userId = "admin-1"): BanCustomerAuthClient {
  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: userId } }, error: null })),
    },
  };
}

function createAdminClient(options?: {
  callerRole?: string | null;
  targetRole?: string | null;
  targetLookupError?: boolean;
  authAdminError?: boolean;
  profileUpdateError?: boolean;
}) {
  const updateUserById = vi.fn(async () => ({
    error: options?.authAdminError ? { message: "raw auth failure" } : null,
  }));
  const updateEq = vi.fn(async () => ({
    error: options?.profileUpdateError ? { message: "raw profile failure" } : null,
  }));
  const update = vi.fn(() => ({ eq: updateEq }));
  const single = vi.fn(async () => {
    const callIndex = single.mock.calls.length;

    if (callIndex === 1) {
      return { data: { role: options?.callerRole ?? "admin" }, error: null };
    }

    return {
      data: options?.targetLookupError ? null : { role: options?.targetRole ?? "customer" },
      error: options?.targetLookupError ? { message: "missing profile" } : null,
    };
  });
  const profileSelectQuery = {
    eq: vi.fn(),
    single,
  };
  profileSelectQuery.eq.mockReturnValue(profileSelectQuery);
  const select = vi.fn(() => profileSelectQuery);

  const client: BanCustomerAdminClient = {
    auth: {
      admin: {
        updateUserById,
      },
    },
    from: vi.fn(() => ({ select, update })),
  };

  return { client, updateUserById, update, updateEq };
}

function createHandler(options?: {
  authClient?: BanCustomerAuthClient;
  adminClient?: BanCustomerAdminClient;
}) {
  const authClient = options?.authClient ?? createAuthClient();
  const adminMock = createAdminClient();
  const adminClient = options?.adminClient ?? adminMock.client;
  const logError = vi.fn();

  return {
    handler: createBanCustomerHandler({
      getAuthClient: () => authClient,
      getAdminClient: () => adminClient,
      logError,
    }),
    adminMock,
    logError,
  };
}

describe("createBanCustomerHandler", () => {
  it("handles CORS preflight", async () => {
    const { handler } = createHandler();

    const response = await handler(createOptionsRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("requires an admin bearer token", async () => {
    const authClient: BanCustomerAuthClient = {
      auth: {
        getUser: vi.fn(async () => ({ data: { user: null }, error: { message: "expired" } })),
      },
    };
    const { handler } = createHandler({ authClient });

    const response = await handler(createRequest({ userId: "user-1", action: "ban" }));

    await expect(response.json()).resolves.toEqual({ error: "Invalid or expired token" });
    expect(response.status).toBe(401);
  });

  it("rejects non-admin callers", async () => {
    const adminMock = createAdminClient({ callerRole: "customer" });
    const { handler } = createHandler({ adminClient: adminMock.client });

    const response = await handler(createRequest({ userId: "user-1", action: "ban" }));

    await expect(response.json()).resolves.toEqual({ error: "Only admin can ban/unban customers" });
    expect(response.status).toBe(403);
  });

  it("prevents self-ban and admin target bans", async () => {
    const selfBanHandler = createHandler();
    const selfBanResponse = await selfBanHandler.handler(createRequest({ userId: "admin-1", action: "ban" }));

    await expect(selfBanResponse.json()).resolves.toEqual({ error: "Cannot ban yourself" });
    expect(selfBanResponse.status).toBe(400);

    const adminTargetMock = createAdminClient({ targetRole: "admin" });
    const adminTargetHandler = createHandler({ adminClient: adminTargetMock.client });
    const adminTargetResponse = await adminTargetHandler.handler(createRequest({ userId: "admin-2", action: "ban" }));

    await expect(adminTargetResponse.json()).resolves.toEqual({ error: "Cannot ban admin users" });
    expect(adminTargetResponse.status).toBe(400);
  });

  it("updates Auth and profile ban state without leaking raw backend errors", async () => {
    const adminMock = createAdminClient({ authAdminError: true });
    const { handler, logError } = createHandler({ adminClient: adminMock.client });

    const response = await handler(createRequest({ userId: "user-1", action: "ban" }));

    await expect(response.json()).resolves.toEqual({ error: "Failed to update customer ban state" });
    expect(response.status).toBe(500);
    expect(logError).toHaveBeenCalledWith(
      "[ban-customer] Failed to update Auth ban state",
      { message: "raw auth failure" },
    );
  });

  it("bans and unbans customers through the service-role client", async () => {
    const banAdminMock = createAdminClient();
    const banHandler = createHandler({ adminClient: banAdminMock.client });

    const banResponse = await banHandler.handler(createRequest({ userId: "user-1", action: "ban" }));

    await expect(banResponse.json()).resolves.toEqual({ success: true });
    expect(banAdminMock.updateUserById).toHaveBeenCalledWith("user-1", { ban_duration: "100y" });
    expect(banAdminMock.update).toHaveBeenCalledWith({ is_banned: true });

    const unbanAdminMock = createAdminClient();
    const unbanHandler = createHandler({ adminClient: unbanAdminMock.client });

    const unbanResponse = await unbanHandler.handler(createRequest({ userId: "user-1", action: "unban" }));

    await expect(unbanResponse.json()).resolves.toEqual({ success: true });
    expect(unbanAdminMock.updateUserById).toHaveBeenCalledWith("user-1", { ban_duration: "none" });
    expect(unbanAdminMock.update).toHaveBeenCalledWith({ is_banned: false });
  });
});
