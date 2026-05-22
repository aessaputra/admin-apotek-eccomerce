import { beforeEach, describe, expect, it, vi } from "vitest";

import { CONFIG_KEYS, type RuntimeConfigRow } from "../../_shared/runtime-config.ts";

const envGet = vi.fn((key: string) => {
  if (key === "SUPABASE_URL") return "https://project.supabase.test";
  if (key === "SUPABASE_SERVICE_ROLE_KEY") return "service-role-sentinel";
  return undefined;
});

vi.stubGlobal("Deno", {
  env: { get: envGet },
  serve: vi.fn(),
});

const { createBiteshipHandler } = await import("../handler.ts");

type BiteshipHandler = ReturnType<typeof createBiteshipHandler>;

function createRuntimeConfigRow(
  keyName: string,
  runtimeValue: string | string[],
  versionNumber: number,
  valueKind: RuntimeConfigRow["value_kind"] = Array.isArray(runtimeValue)
    ? "text_array"
    : "text",
): RuntimeConfigRow {
  return {
    key_name: keyName,
    value_kind: valueKind,
    is_secret: valueKind === "secret",
    is_required: true,
    is_runtime_required: true,
    version_id: `version-${keyName.replaceAll(".", "-")}`,
    version_number: versionNumber,
    status: "active",
    runtime_value: runtimeValue,
    masked_value: valueKind === "secret" ? "bite************inel" : null,
    value_fingerprint: valueKind === "secret" ? "runtime-fingerprint" : null,
    updated_at: "2026-05-21T00:00:00.000Z",
  };
}

function createBiteshipRuntimeRows(options: {
  includeApiKey?: boolean;
  enabledCouriers?: string[];
  originAreaId?: string;
  originPostalCode?: string;
  shipperName?: string;
} = {}): RuntimeConfigRow[] {
  const includeApiKey = options.includeApiKey ?? true;

  return [
    ...(includeApiKey
      ? [createRuntimeConfigRow(
        CONFIG_KEYS.biteshipApiKey,
        "runtime-biteship-secret-sentinel",
        1,
        "secret",
      )]
      : []),
    createRuntimeConfigRow(
      CONFIG_KEYS.biteshipEnabledCouriers,
      options.enabledCouriers ?? ["jne"],
      2,
      "text_array",
    ),
    createRuntimeConfigRow(
      CONFIG_KEYS.biteshipOriginAreaId,
      options.originAreaId ?? "RUNTIME-AREA-ID",
      3,
    ),
    createRuntimeConfigRow(CONFIG_KEYS.biteshipOriginLatitude, "-6.145632", 4),
    createRuntimeConfigRow(CONFIG_KEYS.biteshipOriginLongitude, "106.226614", 5),
    createRuntimeConfigRow(
      CONFIG_KEYS.biteshipOriginPostalCode,
      options.originPostalCode ?? "12345",
      6,
    ),
    createRuntimeConfigRow(
      CONFIG_KEYS.shopShipperName,
      options.shipperName ?? "Runtime Sender",
      7,
    ),
    createRuntimeConfigRow(CONFIG_KEYS.shopShipperPhone, "0812222222", 8),
    createRuntimeConfigRow(CONFIG_KEYS.shopShipperEmail, "runtime@example.com", 9),
    createRuntimeConfigRow(CONFIG_KEYS.shopAddress, "Jl. Runtime No. 10", 10),
    createRuntimeConfigRow(CONFIG_KEYS.shopOrganization, "Runtime Pharmacy", 11),
  ];
}

function createAdminClient(rows: RuntimeConfigRow[]) {
  return {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      expect(name).toBe("get_runtime_integration_config_versions");
      const keyNames = (args.p_key_names ?? []) as string[];
      return {
        data: rows.filter((row) => keyNames.includes(row.key_name)),
        error: null,
      };
    }),
    from: vi.fn(() => {
      throw new Error("legacy public.settings must not be read by Biteship proxy");
    }),
  };
}

function createRequest(action: string, payload: Record<string, unknown> = {}) {
  return new Request("https://project.supabase.test/functions/v1/biteship", {
    method: "POST",
    headers: {
      Authorization: "Bearer test-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action, payload }),
  });
}

async function readJson(response: Response) {
  return await response.json() as Record<string, unknown>;
}

describe("Biteship proxy runtime configuration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    envGet.mockImplementation((key: string) => {
      if (key === "SUPABASE_URL") return "https://project.supabase.test";
      if (key === "SUPABASE_SERVICE_ROLE_KEY") return "service-role-sentinel";
      return undefined;
    });
  });

  it("uses runtime config for rates and strips client-supplied origin fields", async () => {
    const adminClient = createAdminClient(createBiteshipRuntimeRows());
    const fetchFn = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(requestBody).toMatchObject({
        origin_area_id: "RUNTIME-AREA-ID",
        destination_area_id: "DEST-AREA-ID",
        couriers: "jne",
      });
      expect(requestBody.origin_area_id).not.toBe("CLIENT-AREA-ID");
      expect(requestBody.origin_postal_code).not.toBe(99999);
      expect(requestBody.origin_latitude).not.toBe(-1.23);
      expect(requestBody).not.toHaveProperty("origin_coordinate");

      return new Response(JSON.stringify({
        success: true,
        pricing: [{ courier_code: "jne", courier_service_code: "reg" }],
      }), { status: 200 });
    });
    const handler: BiteshipHandler = createBiteshipHandler({
      fetchFn,
      getAdminClient: () => adminClient,
      verifyUserId: async () => "user-1",
    });

    const response = await handler(createRequest("rates", {
      origin_area_id: "CLIENT-AREA-ID",
      origin_postal_code: "99999",
      origin_latitude: -1.23,
      origin_longitude: 100.45,
      origin_coordinate: { latitude: -1.23, longitude: 100.45 },
      destination_area_id: "DEST-AREA-ID",
      items: [],
    }));

    await expect(readJson(response)).resolves.toMatchObject({
      success: true,
      pricing: [{ courier_code: "jne", courier_service_code: "reg" }],
    });
    expect(response.status).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(adminClient.from).not.toHaveBeenCalled();
  });

  it("uses runtime shipper and origin fields for reachable draft orders", async () => {
    const adminClient = createAdminClient(
      createBiteshipRuntimeRows({ shipperName: "Runtime Draft Sender" }),
    );
    const fetchFn = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(requestBody).toMatchObject({
        shipper_contact_name: "Runtime Draft Sender",
        origin_contact_name: "Runtime Draft Sender",
        origin_address: "Jl. Runtime No. 10",
        origin_postal_code: 12345,
      });
      expect(requestBody.shipper_contact_name).not.toBe("Client Sender");
      expect(requestBody.origin_address).not.toBe("Client Origin Address");
      return new Response(JSON.stringify({ success: true, id: "draft-1" }), {
        status: 200,
      });
    });
    const handler: BiteshipHandler = createBiteshipHandler({
      fetchFn,
      getAdminClient: () => adminClient,
      verifyUserId: async () => "user-1",
    });

    const response = await handler(createRequest("draft_order", {
      shipper_contact_name: "Client Sender",
      origin_address: "Client Origin Address",
      destination_contact_name: "Buyer",
      destination_contact_phone: "0811111111",
      destination_address: "Jl. Buyer No. 1",
      courier_company: "jne",
      courier_type: "reg",
    }));

    await expect(readJson(response)).resolves.toMatchObject({ success: true, id: "draft-1" });
    expect(response.status).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(adminClient.from).not.toHaveBeenCalled();
  });

  it("returns a safe config error without outbound calls when runtime config is incomplete", async () => {
    const adminClient = createAdminClient(
      createBiteshipRuntimeRows({ includeApiKey: false, enabledCouriers: [] }),
    );
    const fetchFn = vi.fn(async () => {
      throw new Error("Biteship must not be called with incomplete runtime config");
    });
    const handler: BiteshipHandler = createBiteshipHandler({
      fetchFn,
      getAdminClient: () => adminClient,
      verifyUserId: async () => "user-1",
    });

    const response = await handler(createRequest("rates", {
      destination_area_id: "DEST-AREA-ID",
      items: [],
    }));

    const body = await readJson(response);
    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      error: "BITESHIP_CONFIG_INCOMPLETE",
      diagnostics: expect.arrayContaining([
        "biteship.api_key current version missing; no env fallback configured",
        "biteship.enabled_couriers current version missing or empty",
      ]),
    });
    expect(JSON.stringify(body)).not.toContain("runtime-biteship-secret-sentinel");
    expect(JSON.stringify(body)).not.toContain("BITESHIP_API_KEY=");
    expect(fetchFn).not.toHaveBeenCalled();
    expect(adminClient.from).not.toHaveBeenCalled();
  });

  it("returns a safe config error without outbound calls when standard rates origin is missing", async () => {
    const adminClient = createAdminClient(
      createBiteshipRuntimeRows({
        enabledCouriers: ["jne"],
        originAreaId: "",
        originPostalCode: "",
      }),
    );
    const fetchFn = vi.fn(async () => {
      throw new Error("Biteship must not be called with missing runtime origin config");
    });
    const handler: BiteshipHandler = createBiteshipHandler({
      fetchFn,
      getAdminClient: () => adminClient,
      verifyUserId: async () => "user-1",
    });

    const response = await handler(createRequest("rates", {
      destination_area_id: "DEST-AREA-ID",
      items: [],
    }));

    const body = await readJson(response);
    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      error: "BITESHIP_CONFIG_INCOMPLETE",
      diagnostics: expect.arrayContaining([
        "standard Biteship rates require biteship.origin_area_id or biteship.origin_postal_code",
      ]),
    });
    expect(JSON.stringify(body)).not.toContain("runtime-biteship-secret-sentinel");
    expect(JSON.stringify(body)).not.toContain("BITESHIP_API_KEY=");
    expect(fetchFn).not.toHaveBeenCalled();
    expect(adminClient.from).not.toHaveBeenCalled();
  });

  it.each(["create_order", "track"])(
    "keeps direct %s disabled before any settings reads or Biteship calls",
    async (action) => {
      const getAdminClient = vi.fn(() => {
        throw new Error("settings/runtime config must not be read for disabled actions");
      });
      const fetchFn = vi.fn(async () => {
        throw new Error("Biteship must not be called for disabled actions");
      });
      const handler: BiteshipHandler = createBiteshipHandler({
        fetchFn,
        getAdminClient,
        verifyUserId: async () => "user-1",
      });

      const response = await handler(createRequest(action, { tracking_id: "track-1" }));
      const body = await readJson(response);

      expect(response.status).toBe(403);
      expect(String(body.error)).toContain(`Direct ${action === "track" ? "track" : "create_order"} is disabled`);
      expect(getAdminClient).not.toHaveBeenCalled();
      expect(fetchFn).not.toHaveBeenCalled();
    },
  );
});
