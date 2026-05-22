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
  rpcImplementation?: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;
  legacySettings?: Record<string, unknown> | null;
  legacySettingsError?: { message?: string } | null;
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

  const settingsMaybeSingle = vi.fn(async () => ({
    data: options?.legacySettings ?? null,
    error: options?.legacySettingsError ?? null,
  }));
  const settingsSelectQuery = {
    eq: vi.fn(),
    maybeSingle: settingsMaybeSingle,
  };
  settingsSelectQuery.eq.mockReturnValue(settingsSelectQuery);
  const settingsSelect = vi.fn(() => settingsSelectQuery);

  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    if (options?.rpcImplementation) {
      return options.rpcImplementation(fn, args);
    }

    return {
      data: options?.rpcData ?? [],
      error: options?.rpcError ?? null,
    };
  });

  const from = vi.fn((table: "profiles" | "settings") => (table === "profiles" ? { select } : { select: settingsSelect })) as unknown as IntegrationConfigAdminClient["from"];
  const client: IntegrationConfigAdminClient = {
    from,
    rpc,
  };

  return { client, rpc, select, single, settingsSelect, settingsMaybeSingle };
}

function runtimeRow(keyName: string, runtimeValue: unknown, valueKind = "text") {
  return {
    key_name: keyName,
    value_kind: valueKind,
    is_secret: valueKind === "secret",
    is_required: true,
    is_runtime_required: true,
    version_id: `version-${keyName.replace(/[^a-z0-9]+/g, "-")}`,
    version_number: 1,
    status: "active",
    runtime_value: runtimeValue,
    masked_value: valueKind === "secret" ? "BS-****SAFE" : null,
    value_fingerprint: valueKind === "secret" ? "fingerprint" : null,
    updated_at: "2026-05-21T00:00:00Z",
  };
}

function createBiteshipHealthRpc(summaryRows: unknown[], runtimeRows: unknown[]) {
  return async (fn: string, args: Record<string, unknown>) => {
    if (fn === "list_integration_config_summary") {
      return { data: summaryRows, error: null };
    }

    if (fn === "get_runtime_integration_config_versions") {
      const requestedKeys = Array.isArray(args.p_key_names) ? args.p_key_names : [];
      return {
        data: runtimeRows.filter((row) => requestedKeys.includes((row as { key_name?: string }).key_name)),
        error: null,
      };
    }

    return { data: [], error: null };
  };
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
    expect(payload).toEqual({ data: { rows: [summaryRow] } });
    expect(adminMock.rpc).toHaveBeenCalledWith("list_integration_config_summary", {
      p_key_names: ["midtrans.server_key"],
    });
  });

  it("strips unsafe secret fields from Midtrans summary responses", async () => {
    const summaryRow = {
      key_name: "midtrans.server_key",
      is_secret: true,
      masked_value: "sk-****SAFE",
      value_fingerprint: "fingerprint",
      runtime_value: PLACEHOLDER_SECRET,
      secret: PLACEHOLDER_SECRET,
      p_secret_value: PLACEHOLDER_SECRET,
      metadata: {
        rotation_status: "current",
        nested: { secret: PLACEHOLDER_SECRET },
      },
    };
    const adminMock = createAdminClient({ rpcData: [summaryRow] });
    const { handler } = createHandler({ adminClient: adminMock.client });

    const response = await handler(createRequest({ action: "summary", keys: ["midtrans.server_key"] }));
    const responseBody = await response.text();
    const payload = JSON.parse(responseBody);
    const row = payload.data.rows[0];

    expect(response.status).toBe(200);
    expect(responseBody).not.toContain(PLACEHOLDER_SECRET);
    expect(row).not.toHaveProperty("runtime_value");
    expect(row).not.toHaveProperty("secret");
    expect(row).not.toHaveProperty("p_secret_value");
    expect(row.metadata.nested).not.toHaveProperty("secret");
    expect(row.masked_value).toBe("sk-****SAFE");
    expect(row.value_fingerprint).toBe("fingerprint");
  });

  it("adds safe Biteship health only when summary requests Biteship keys", async () => {
    const summaryRow = {
      key_name: "biteship.api_key",
      is_secret: true,
      masked_value: "BS-****9999",
      non_secret_value: null,
      version_number: 2,
      status: "active",
    };
    const runtimeRows = [
      runtimeRow("biteship.api_key", "TEST_BITESHIP_SECRET_DO_NOT_LEAK", "secret"),
      runtimeRow("biteship.enabled_couriers", ["jne:reg"], "text_array"),
      runtimeRow("biteship.origin_area_id", "area-runtime"),
      runtimeRow("biteship.origin_postal_code", "12110"),
      runtimeRow("biteship.origin_latitude", "-6.2"),
      runtimeRow("biteship.origin_longitude", "106.8"),
      runtimeRow("shop.shipper_name", "PRIVATE_SHIPPER_NAME"),
      runtimeRow("shop.shipper_phone", "08123456789"),
      runtimeRow("shop.shipper_email", "shipper@example.test"),
      runtimeRow("shop.address", "PRIVATE STORE ADDRESS"),
      runtimeRow("shop.organization", "PRIVATE ORGANIZATION"),
    ];
    const adminMock = createAdminClient({
      rpcImplementation: createBiteshipHealthRpc([summaryRow], runtimeRows),
      legacySettings: {
        enabled_couriers: "sicepat:reg",
        origin_area_id: "legacy-area",
        origin_postal_code: "99999",
        origin_latitude: "-6.1",
        origin_longitude: "106.7",
      },
    });
    const { handler } = createHandler({ adminClient: adminMock.client });

    const response = await handler(createRequest({ action: "summary", keys: ["biteship.api_key"] }));
    const responseBody = await response.text();
    const payload = JSON.parse(responseBody);

    expect(response.status).toBe(200);
    expect(payload.data.rows).toEqual([summaryRow]);
    expect(payload.data.health.biteship).toEqual({
      provider: "biteship",
      apiKeyConfigured: true,
      apiKeySource: "runtime_config",
      requiredConfigComplete: true,
      missingKeys: [],
      legacyDrift: {
        enabledCouriers: true,
        originArea: true,
        originPostalCode: true,
        originCoordinates: true,
      },
      diagnostics: [],
    });
    expect(responseBody).not.toContain("TEST_BITESHIP_SECRET_DO_NOT_LEAK");
    expect(responseBody).not.toContain("PRIVATE_SHIPPER_NAME");
    expect(responseBody).not.toContain("08123456789");
    expect(responseBody).not.toContain("shipper@example.test");
    expect(responseBody).not.toContain("PRIVATE STORE ADDRESS");
    expect(responseBody).not.toContain("version-biteship-api-key");
  });

  it("reports missing Biteship runtime keys safely and omits health for non-Biteship summaries", async () => {
    const summaryRow = { key_name: "biteship.api_key", is_secret: true, masked_value: null };
    const adminMock = createAdminClient({
      rpcImplementation: createBiteshipHealthRpc([summaryRow], []),
      legacySettings: null,
    });
    const { handler } = createHandler({ adminClient: adminMock.client });

    const biteshipResponse = await handler(createRequest({ action: "summary", keys: ["biteship.api_key"] }));
    const biteshipPayload = await biteshipResponse.json();
    const paymentResponse = await handler(createRequest({ action: "summary", keys: ["midtrans.server_key"] }));
    const paymentPayload = await paymentResponse.json();

    expect(biteshipPayload.data.health.biteship).toMatchObject({
      provider: "biteship",
      apiKeyConfigured: false,
      apiKeySource: "missing",
      requiredConfigComplete: false,
      missingKeys: [
        "biteship.api_key",
        "biteship.enabled_couriers",
        "biteship.origin_area_id",
        "biteship.origin_postal_code",
        "biteship.origin_latitude",
        "biteship.origin_longitude",
      ],
      legacyDrift: {
        enabledCouriers: null,
        originArea: null,
        originPostalCode: null,
        originCoordinates: null,
      },
    });
    expect(JSON.stringify(biteshipPayload)).not.toContain("BITESHIP_API_KEY=");
    expect(paymentPayload).toEqual({ data: { rows: [summaryRow] } });
  });

  it("reports unknown legacy drift when the legacy settings lookup fails", async () => {
    const summaryRow = { key_name: "biteship.api_key", is_secret: true, masked_value: null };
    const adminMock = createAdminClient({
      rpcImplementation: createBiteshipHealthRpc([summaryRow], [
        runtimeRow("biteship.api_key", "TEST_BITESHIP_SECRET_DO_NOT_LEAK", "secret"),
        runtimeRow("biteship.enabled_couriers", ["jne:reg"], "text_array"),
        runtimeRow("biteship.origin_area_id", "area-runtime"),
        runtimeRow("biteship.origin_postal_code", "12110"),
        runtimeRow("biteship.origin_latitude", "-6.2"),
        runtimeRow("biteship.origin_longitude", "106.8"),
        runtimeRow("shop.shipper_name", "PRIVATE_SHIPPER_NAME"),
        runtimeRow("shop.shipper_phone", "08123456789"),
        runtimeRow("shop.shipper_email", "shipper@example.test"),
        runtimeRow("shop.address", "PRIVATE STORE ADDRESS"),
        runtimeRow("shop.organization", "PRIVATE ORGANIZATION"),
      ]),
      legacySettingsError: { message: "legacy settings unavailable" },
    });
    const { handler } = createHandler({ adminClient: adminMock.client });

    const response = await handler(createRequest({ action: "summary", keys: ["biteship.api_key"] }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.health.biteship.legacyDrift).toEqual({
      enabledCouriers: null,
      originArea: null,
      originPostalCode: null,
      originCoordinates: null,
    });
    expect(JSON.stringify(payload)).not.toContain("legacy settings unavailable");
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
