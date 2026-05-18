import { describe, expect, it, vi } from "vitest";

import {
  createIntegrationConfigHandler,
  type IntegrationConfigAdminClient,
  type IntegrationConfigAuthClient,
} from "../handler.ts";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const PLACEHOLDER_SECRET = "TEST_SENTINEL_SECRET_DO_NOT_LEAK";

function createRequest(body: Record<string, unknown>, authorization = "Bearer admin-token") {
  return new Request("https://example.test/functions/v1/integration-config", {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
      "x-request-id": "request-1",
    },
    body: JSON.stringify(body),
  });
}

function createOptionsRequest() {
  return new Request("https://example.test/functions/v1/integration-config", {
    method: "OPTIONS",
  });
}

function createAuthClient(userId = ADMIN_ID): IntegrationConfigAuthClient {
  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: userId } }, error: null })),
    },
  };
}

function createAdminClient(options?: {
  callerRole?: string | null;
  callerLookupError?: boolean;
  rpcData?: unknown;
  rpcError?: { message?: string } | null;
}) {
  const single = vi.fn(async () => ({
    data: options?.callerLookupError ? null : { role: options?.callerRole ?? "admin" },
    error: options?.callerLookupError ? { message: "raw profile failure" } : null,
  }));
  const profileSelectQuery = {
    eq: vi.fn(),
    single,
  };
  profileSelectQuery.eq.mockReturnValue(profileSelectQuery);
  const select = vi.fn(() => profileSelectQuery);

  const rpc = vi.fn(async () => ({
    data: options?.rpcData ?? [],
    error: options?.rpcError ?? null,
  }));

  const client: IntegrationConfigAdminClient = {
    from: vi.fn(() => ({ select })),
    rpc,
  };

  return { client, rpc, select, single };
}

function createHandler(options?: {
  authClient?: IntegrationConfigAuthClient;
  adminClient?: IntegrationConfigAdminClient;
}) {
  const authClient = options?.authClient ?? createAuthClient();
  const adminMock = createAdminClient();
  const adminClient = options?.adminClient ?? adminMock.client;
  const logError = vi.fn();

  return {
    handler: createIntegrationConfigHandler({
      getAuthClient: () => authClient,
      getAdminClient: () => adminClient,
      logError,
    }),
    adminMock,
    logError,
  };
}

describe("createIntegrationConfigHandler", () => {
  it("handles CORS preflight", async () => {
    const { handler } = createHandler();

    const response = await handler(createOptionsRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("requires a valid bearer token", async () => {
    const authClient: IntegrationConfigAuthClient = {
      auth: {
        getUser: vi.fn(async () => ({ data: { user: null }, error: { message: "expired" } })),
      },
    };
    const { handler } = createHandler({ authClient });

    const missingResponse = await handler(createRequest({ action: "summary" }, ""));
    const invalidResponse = await handler(createRequest({ action: "summary" }));

    await expect(missingResponse.json()).resolves.toEqual({ error: "Missing or invalid Authorization header" });
    expect(missingResponse.status).toBe(401);
    await expect(invalidResponse.json()).resolves.toEqual({ error: "Invalid or expired token" });
    expect(invalidResponse.status).toBe(401);
  });

  it("rejects non-admin callers before any integration config RPC", async () => {
    const adminMock = createAdminClient({ callerRole: "customer" });
    const { handler } = createHandler({ adminClient: adminMock.client });

    const response = await handler(createRequest({ action: "summary" }));

    await expect(response.json()).resolves.toEqual({ error: "Only admin can manage integration config" });
    expect(response.status).toBe(403);
    expect(adminMock.rpc).not.toHaveBeenCalled();
  });

  it("lists masked config summary through the service-role summary wrapper", async () => {
    const summaryRow = {
      key_name: "midtrans.server_key",
      is_secret: true,
      masked_value: "sk-****1234",
      non_secret_value: null,
      version_number: 2,
      status: "active",
    };
    const adminMock = createAdminClient({ rpcData: [summaryRow] });
    const { handler } = createHandler({ adminClient: adminMock.client });

    const response = await handler(createRequest({ action: "summary", keys: ["midtrans.server_key"] }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ data: [summaryRow] });
    expect(adminMock.rpc).toHaveBeenCalledWith("list_integration_config_summary", {
      p_key_names: ["midtrans.server_key"],
    });
  });

  it("rotates a secret without echoing submitted plaintext", async () => {
    const rotateRow = {
      key_name: "midtrans.server_key",
      version_id: "version-1",
      version_number: 3,
      masked_value: "sk-****9999",
      value_fingerprint: "fingerprint",
      updated_at: "2026-05-18T00:00:00Z",
    };
    const adminMock = createAdminClient({ rpcData: [rotateRow] });
    const { handler } = createHandler({ adminClient: adminMock.client });

    const response = await handler(
      createRequest({
        action: "rotateSecret",
        key: "midtrans.server_key",
        secret: PLACEHOLDER_SECRET,
        reason: "scheduled rotation",
      }),
    );
    const responseBody = await response.text();

    expect(response.status).toBe(200);
    expect(responseBody).not.toContain(PLACEHOLDER_SECRET);
    expect(JSON.parse(responseBody)).toEqual({ data: rotateRow });
    expect(adminMock.rpc).toHaveBeenCalledWith("rotate_integration_config_secret", {
      p_key_name: "midtrans.server_key",
      p_secret_value: PLACEHOLDER_SECRET,
      p_actor_id: ADMIN_ID,
      p_reason: "scheduled rotation",
      p_source: "admin_gateway",
      p_request_id: "request-1",
    });
  });

  it("updates a non-secret value through the service-role update wrapper", async () => {
    const updateRow = {
      key_name: "biteship.origin_postal_code",
      version_id: "version-2",
      version_number: 4,
      updated_value: "12345",
      updated_at: "2026-05-18T00:00:00Z",
    };
    const adminMock = createAdminClient({ rpcData: [updateRow] });
    const { handler } = createHandler({ adminClient: adminMock.client });

    const response = await handler(
      createRequest({
        action: "updateValue",
        key: "biteship.origin_postal_code",
        value: "12345",
        reason: "warehouse moved",
      }),
    );

    await expect(response.json()).resolves.toEqual({ data: updateRow });
    expect(response.status).toBe(200);
    expect(adminMock.rpc).toHaveBeenCalledWith("update_integration_config_value", {
      p_key_name: "biteship.origin_postal_code",
      p_value: "12345",
      p_actor_id: ADMIN_ID,
      p_reason: "warehouse moved",
      p_source: "admin_gateway",
      p_request_id: "request-1",
    });
  });

  it("lists audit entries with an optional key and bounded limit", async () => {
    const auditRow = { id: "audit-1", key_name: "midtrans.server_key", action: "secret_rotated" };
    const adminMock = createAdminClient({ rpcData: [auditRow] });
    const { handler } = createHandler({ adminClient: adminMock.client });

    const response = await handler(createRequest({ action: "audit", key: "midtrans.server_key", limit: 25 }));

    await expect(response.json()).resolves.toEqual({ data: [auditRow] });
    expect(response.status).toBe(200);
    expect(adminMock.rpc).toHaveBeenCalledWith("list_integration_config_audit", {
      p_key_name: "midtrans.server_key",
      p_limit: 25,
    });
  });

  it.each([
    [{ action: "rotateSecret", key: "midtrans.server_key", secret: "", reason: "scheduled" }, "secret is required"],
    [{ action: "rotateSecret", key: "midtrans.server_key", secret: PLACEHOLDER_SECRET, reason: "" }, "reason is required"],
    [{ action: "updateValue", key: "biteship.origin_postal_code", value: undefined, reason: "warehouse moved" }, "value is required"],
    [{ action: "updateValue", key: "biteship.origin_postal_code", value: "12345", reason: "" }, "reason is required"],
    [{ action: "audit", limit: 0 }, "limit must be an integer between 1 and 500"],
    [{ action: "unknown" }, "Unsupported integration config action"],
  ])("validates payload %s", async (body, error) => {
    const { handler, adminMock } = createHandler();

    const response = await handler(createRequest(body));

    await expect(response.json()).resolves.toEqual({ error });
    expect(response.status).toBe(400);
    expect(adminMock.rpc).not.toHaveBeenCalled();
  });

  it("returns sanitized backend errors without leaking raw details or secret placeholders", async () => {
    const adminMock = createAdminClient({
      rpcError: { message: `database failed near ${PLACEHOLDER_SECRET}` },
    });
    const { handler, logError } = createHandler({ adminClient: adminMock.client });

    const response = await handler(
      createRequest({
        action: "rotateSecret",
        key: "midtrans.server_key",
        secret: PLACEHOLDER_SECRET,
        reason: "scheduled rotation",
      }),
    );
    const responseBody = await response.text();

    expect(response.status).toBe(500);
    expect(responseBody).toBe(JSON.stringify({ error: "Integration config operation failed" }));
    expect(responseBody).not.toContain(PLACEHOLDER_SECRET);
    const logArguments = JSON.stringify(logError.mock.calls);
    expect(logError).toHaveBeenCalledWith(
      "[integration-config] rotateSecret RPC failed",
      { message: "Operation failed" },
    );
    expect(logArguments).not.toContain(PLACEHOLDER_SECRET);
  });
});
