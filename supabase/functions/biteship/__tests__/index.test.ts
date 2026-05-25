import { beforeEach, describe, expect, it, vi } from "vitest";

import { CONFIG_KEYS, type RuntimeConfigRow } from "../../_shared/runtime-config.ts";

const envGet = vi.fn((key: string): string | undefined => {
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

type ProfileRow = { role: string | null };
type OrderReadModelRow = {
  id: string;
  user_id: string | null;
  waybill_number?: string | null;
  courier_code?: string | null;
};

interface AdminClientOptions {
  profileRole?: string | null;
  profileError?: unknown;
  orders?: OrderReadModelRow[];
  orderError?: unknown;
}

function createTableQuery<T>(
  resolve: (filters: Record<string, unknown>) => { data: T | null; error: unknown },
) {
  const filters: Record<string, unknown> = {};
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    single: vi.fn(),
    maybeSingle: vi.fn(),
  };

  query.select.mockImplementation(() => query);
  query.eq.mockImplementation((column: string, value: unknown) => {
    filters[column] = value;
    return query;
  });
  query.single.mockImplementation(async () => resolve(filters));
  query.maybeSingle.mockImplementation(async () => resolve(filters));

  return query;
}

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

function createAdminClient(
  rows: RuntimeConfigRow[],
  options: AdminClientOptions = {},
) {
  const resolveProfile = (): { data: ProfileRow | null; error: unknown } => {
    if (options.profileError) {
      return { data: null, error: options.profileError };
    }

    if (options.profileRole === null) {
      return { data: null, error: { message: "Profile not found" } };
    }

    return { data: { role: options.profileRole ?? "customer" }, error: null };
  };

  const resolveOrder = (
    filters: Record<string, unknown>,
  ): { data: OrderReadModelRow | null; error: unknown } => {
    if (options.orderError) {
      return { data: null, error: options.orderError };
    }

    const orderId = filters.id;
    const userId = filters.user_id;
    const order = options.orders?.find((candidate) => {
      return (
        candidate.id === orderId &&
        (userId === undefined || candidate.user_id === userId)
      );
    });

    if (!order) {
      return { data: null, error: { message: "Order not found" } };
    }

    return { data: order, error: null };
  };

  return {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      expect(name).toBe("get_runtime_integration_config_versions");
      const keyNames = (args.p_key_names ?? []) as string[];
      return {
        data: rows.filter((row) => keyNames.includes(row.key_name)),
        error: null,
      };
    }),
    from: vi.fn((table: string) => {
      if (table === "profiles") {
        return createTableQuery(resolveProfile);
      }

      if (table === "order_read_model") {
        return createTableQuery(resolveOrder);
      }

      throw new Error("legacy public.settings must not be read by Biteship proxy");
    }),
  };
}

function createRequest(
  action: string,
  payload: Record<string, unknown> = {},
  token = "test-token",
  requestId?: string,
) {
  return new Request("https://project.supabase.test/functions/v1/biteship", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(requestId ? { "x-request-id": requestId } : {}),
    },
    body: JSON.stringify({ action, payload }),
  });
}

async function readJson(response: Response) {
  return await response.json() as Record<string, unknown>;
}

function findProviderCallLog(spy: ReturnType<typeof vi.spyOn>) {
  return spy.mock.calls.find((call: unknown[]) => call[0] === "[biteship] provider_call");
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
    }, "test-token", "biteship-rates-1"));

    await expect(readJson(response)).resolves.toMatchObject({
      success: true,
      pricing: [{ courier_code: "jne", courier_service_code: "reg" }],
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("biteship-rates-1");
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(adminClient.from).not.toHaveBeenCalled();
  });

  it("logs rates provider calls with safe structured correlation metadata", async () => {
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const adminClient = createAdminClient(createBiteshipRuntimeRows());
    const fetchFn = vi.fn(async () => {
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

    try {
      const response = await handler(createRequest("rates", {
        destination_area_id: "DEST-AREA-ID",
        items: [{ name: "Private Item", value: 10000, quantity: 1 }],
      }, "test-token", "biteship-rates-log-1"));
      const loggedText = JSON.stringify(consoleLogSpy.mock.calls);

      expect(response.status).toBe(200);
      expect(findProviderCallLog(consoleLogSpy)?.[1]).toMatchObject({
        action: "rates",
        endpoint: "/v1/rates/couriers",
        method: "POST",
        provider: "biteship",
        requestId: "biteship-rates-log-1",
      });
      expect(loggedText).not.toContain("Private Item");
      expect(loggedText).not.toContain("DEST-AREA-ID");
      expect(loggedText).not.toContain("runtime-biteship-secret-sentinel");
      expect(loggedText).not.toContain("authorization");
    } finally {
      consoleLogSpy.mockRestore();
    }
  });

  it("uses runtime shipper and origin fields for admin-authorized draft orders", async () => {
    const adminClient = createAdminClient(
      createBiteshipRuntimeRows({ shipperName: "Runtime Draft Sender" }),
      { profileRole: "admin" },
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
    expect(adminClient.from).toHaveBeenCalledWith("profiles");
    expect(adminClient.from).not.toHaveBeenCalledWith("order_read_model");
  });

  it("logs generic provider calls with safe structured correlation metadata", async () => {
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const adminClient = createAdminClient(
      createBiteshipRuntimeRows({ shipperName: "Runtime Draft Sender" }),
      { profileRole: "admin" },
    );
    const fetchFn = vi.fn(async () => {
      return new Response(JSON.stringify({ success: true, id: "draft-1" }), {
        status: 200,
      });
    });
    const handler: BiteshipHandler = createBiteshipHandler({
      fetchFn,
      getAdminClient: () => adminClient,
      verifyUserId: async () => "user-1",
    });

    try {
      const response = await handler(createRequest("draft_order", {
        destination_contact_name: "Buyer Private",
        destination_contact_phone: "0811111111",
        destination_address: "Jl. Private No. 1",
        courier_company: "jne",
        courier_type: "reg",
      }, "test-token", "biteship-draft-log-1"));
      const loggedText = JSON.stringify(consoleLogSpy.mock.calls);

      expect(response.status).toBe(200);
      expect(findProviderCallLog(consoleLogSpy)?.[1]).toMatchObject({
        action: "draft_order",
        endpoint: "/v1/draft_orders",
        method: "POST",
        provider: "biteship",
        requestId: "biteship-draft-log-1",
      });
      expect(loggedText).not.toContain("Buyer Private");
      expect(loggedText).not.toContain("0811111111");
      expect(loggedText).not.toContain("Jl. Private");
      expect(loggedText).not.toContain("runtime-biteship-secret-sentinel");
      expect(loggedText).not.toContain("authorization");
    } finally {
      consoleLogSpy.mockRestore();
    }
  });

  it("logs maps provider calls with a static endpoint label only", async () => {
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const mapsInput = "Jakarta Private Area Sentinel";
    const adminClient = createAdminClient(createBiteshipRuntimeRows());
    const fetchFn = vi.fn(async (url: RequestInfo | URL) => {
      expect(String(url)).toBe(
        "https://api.biteship.com/v1/maps/areas?input=Jakarta%20Private%20Area%20Sentinel&type=single",
      );

      return new Response(JSON.stringify({ success: true, areas: [] }), {
        status: 200,
      });
    });
    const handler: BiteshipHandler = createBiteshipHandler({
      fetchFn,
      getAdminClient: () => adminClient,
      verifyUserId: async () => "user-1",
    });

    try {
      const response = await handler(createRequest("maps", {
        input: mapsInput,
      }, "test-token", "biteship-maps-log-1"));
      const loggedText = JSON.stringify(consoleLogSpy.mock.calls);

      expect(response.status).toBe(200);
      expect(findProviderCallLog(consoleLogSpy)?.[1]).toMatchObject({
        action: "maps",
        endpoint: "/v1/maps/areas",
        method: "GET",
        provider: "biteship",
        requestId: "biteship-maps-log-1",
      });
      expect(loggedText).not.toContain(mapsInput);
      expect(loggedText).not.toContain("Jakarta%20Private%20Area%20Sentinel");
      expect(loggedText).not.toContain("type=single");
      expect(loggedText).not.toContain("runtime-biteship-secret-sentinel");
      expect(loggedText).not.toContain("authorization");
    } finally {
      consoleLogSpy.mockRestore();
    }
  });

  it("logs public tracking provider calls with a static endpoint label only", async () => {
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const waybillNumber = "WB-PRIVATE-SENTINEL-123";
    const courierCode = "JNE-PRIVATE-SENTINEL";
    const adminClient = createAdminClient(createBiteshipRuntimeRows(), {
      orders: [{
        id: "order-private-sentinel",
        user_id: "user-1",
        waybill_number: waybillNumber,
        courier_code: courierCode,
      }],
    });
    const fetchFn = vi.fn(async (url: RequestInfo | URL) => {
      expect(String(url)).toBe(
        "https://api.biteship.com/v1/trackings/WB-PRIVATE-SENTINEL-123/couriers/jne-private-sentinel",
      );

      return new Response(JSON.stringify({ success: true, history: [] }), {
        status: 200,
      });
    });
    const handler: BiteshipHandler = createBiteshipHandler({
      fetchFn,
      getAdminClient: () => adminClient,
      verifyUserId: async () => "user-1",
    });

    try {
      const response = await handler(createRequest("track_public", {
        order_id: "order-private-sentinel",
      }, "test-token", "biteship-track-log-1"));
      const loggedText = JSON.stringify(consoleLogSpy.mock.calls);

      expect(response.status).toBe(200);
      expect(findProviderCallLog(consoleLogSpy)?.[1]).toMatchObject({
        action: "track_public",
        endpoint: "/v1/public-track",
        method: "GET",
        provider: "biteship",
        requestId: "biteship-track-log-1",
      });
      expect(loggedText).not.toContain(waybillNumber);
      expect(loggedText).not.toContain(courierCode);
      expect(loggedText).not.toContain(courierCode.toLowerCase());
      expect(loggedText).not.toContain("order-private-sentinel");
      expect(loggedText).not.toContain("runtime-biteship-secret-sentinel");
      expect(loggedText).not.toContain("authorization");
    } finally {
      consoleLogSpy.mockRestore();
    }
  });

  it("denies draft orders without admin role or order id before runtime config or provider fetch", async () => {
    const adminClient = createAdminClient(createBiteshipRuntimeRows(), {
      profileRole: "customer",
    });
    const fetchFn = vi.fn(async () => {
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
      destination_contact_name: "Buyer",
      destination_contact_phone: "0811111111",
      destination_address: "Jl. Buyer No. 1",
      courier_company: "jne",
      courier_type: "reg",
    }));

    const body = await readJson(response);
    const bodyText = JSON.stringify(body);
    expect(response.status).toBe(403);
    expect(body).toEqual({ error: "Unauthorized" });
    expect(bodyText).not.toContain("runtime-biteship-secret-sentinel");
    expect(bodyText).not.toContain("service-role-sentinel");
    expect(bodyText).not.toContain("test-token");
    expect(bodyText).not.toContain("Bearer");
    expect(fetchFn).not.toHaveBeenCalled();
    expect(adminClient.rpc).not.toHaveBeenCalled();
    expect(adminClient.from).toHaveBeenCalledWith("profiles");
    expect(adminClient.from).not.toHaveBeenCalledWith("order_read_model");
  });

  it("denies customer draft orders with an order id before runtime config or provider fetch", async () => {
    const adminClient = createAdminClient(createBiteshipRuntimeRows(), {
      profileRole: "customer",
      orders: [{ id: "order-1", user_id: "owner-2" }],
    });
    const fetchFn = vi.fn(async () => {
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
      order_id: "order-1",
      destination_contact_name: "Buyer",
      destination_contact_phone: "0811111111",
      destination_address: "Jl. Buyer No. 1",
      courier_company: "jne",
      courier_type: "reg",
    }));

    const body = await readJson(response);
    const bodyText = JSON.stringify(body);
    expect(response.status).toBe(403);
    expect(body).toEqual({ error: "Unauthorized" });
    expect(bodyText).not.toContain("runtime-biteship-secret-sentinel");
    expect(bodyText).not.toContain("service-role-sentinel");
    expect(bodyText).not.toContain("test-token");
    expect(bodyText).not.toContain("Bearer");
    expect(fetchFn).not.toHaveBeenCalled();
    expect(adminClient.rpc).not.toHaveBeenCalled();
    expect(adminClient.from).toHaveBeenCalledWith("profiles");
    expect(adminClient.from).not.toHaveBeenCalledWith("order_read_model");
  });

  it("denies customer draft orders for owned orders before unsafe client fields can reach Biteship", async () => {
    const adminClient = createAdminClient(
      createBiteshipRuntimeRows({ shipperName: "Runtime Owner Sender" }),
      {
        profileRole: "customer",
        orders: [{ id: "order-1", user_id: "user-1" }],
      },
    );
    const fetchFn = vi.fn(async () => {
      return new Response(JSON.stringify({ success: true, id: "draft-owner-1" }), {
        status: 200,
      });
    });
    const handler: BiteshipHandler = createBiteshipHandler({
      fetchFn,
      getAdminClient: () => adminClient,
      verifyUserId: async () => "user-1",
    });

    const response = await handler(createRequest("draft_order", {
      order_id: "order-1",
      destination_contact_name: "Buyer",
      destination_contact_phone: "0811111111",
      destination_address: "Jl. Buyer No. 1",
      shipper_contact_name: "Injected Sender",
      shipper_contact_phone: "0800000000",
      shipper_contact_email: "attacker@example.test",
      origin_address: "Injected Origin Address",
      origin_postal_code: "99999",
      items: [{ name: "Injected Item", value: 1, quantity: 99 }],
      courier_company: "jne",
      courier_type: "reg",
    }));

    const body = await readJson(response);
    const bodyText = JSON.stringify(body);
    expect(response.status).toBe(403);
    expect(body).toEqual({ error: "Unauthorized" });
    expect(bodyText).not.toContain("runtime-biteship-secret-sentinel");
    expect(bodyText).not.toContain("service-role-sentinel");
    expect(bodyText).not.toContain("test-token");
    expect(bodyText).not.toContain("Bearer");
    expect(fetchFn).not.toHaveBeenCalled();
    expect(adminClient.rpc).not.toHaveBeenCalled();
    expect(adminClient.from).toHaveBeenCalledWith("profiles");
    expect(adminClient.from).not.toHaveBeenCalledWith("order_read_model");
  });

  it("denies service-role bearer access to non-draft actions before provider fetch", async () => {
    const getAdminClient = vi.fn(() => createAdminClient(createBiteshipRuntimeRows()));
    const fetchFn = vi.fn(async () => {
      throw new Error("Biteship must not be called for service-role non-draft actions");
    });
    const verifyUserId = vi.fn(async () => {
      throw new Error("service-role callers must not be verified as user JWTs");
    });
    const handler: BiteshipHandler = createBiteshipHandler({
      fetchFn,
      getAdminClient,
      verifyUserId,
    });

    const response = await handler(createRequest("rates", {
      destination_area_id: "DEST-AREA-ID",
      items: [],
    }, "service-role-sentinel"));

    const body = await readJson(response);
    expect(response.status).toBe(403);
    expect(body).toEqual({ error: "Unauthorized" });
    expect(verifyUserId).not.toHaveBeenCalled();
    expect(getAdminClient).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("allows draft orders for service-role internal callers without user profile lookups", async () => {
    const adminClient = createAdminClient(
      createBiteshipRuntimeRows({ shipperName: "Runtime Service Sender" }),
    );
    const fetchFn = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(requestBody).toMatchObject({
        shipper_contact_name: "Runtime Service Sender",
        origin_contact_name: "Runtime Service Sender",
        origin_address: "Jl. Runtime No. 10",
        origin_postal_code: 12345,
      });

      return new Response(JSON.stringify({ success: true, id: "draft-service-1" }), {
        status: 200,
      });
    });
    const verifyUserId = vi.fn(async () => {
      throw new Error("service-role callers must not be verified as user JWTs");
    });
    const handler: BiteshipHandler = createBiteshipHandler({
      fetchFn,
      getAdminClient: () => adminClient,
      verifyUserId,
    });

    const response = await handler(createRequest("draft_order", {
      destination_contact_name: "Buyer",
      destination_contact_phone: "0811111111",
      destination_address: "Jl. Buyer No. 1",
      courier_company: "jne",
      courier_type: "reg",
    }, "service-role-sentinel"));

    await expect(readJson(response)).resolves.toMatchObject({
      success: true,
      id: "draft-service-1",
    });
    expect(response.status).toBe(200);
    expect(verifyUserId).not.toHaveBeenCalled();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(adminClient.from).not.toHaveBeenCalled();
  });


  it("redacts runtime settings resolution errors from logs", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const adminClient = createAdminClient(createBiteshipRuntimeRows());
    adminClient.rpc.mockResolvedValueOnce(({
      data: null,
      error: { message: "select from integration_config_versions failed: BITESHIP_API_KEY policy stack" },
    } as unknown) as Awaited<ReturnType<typeof adminClient.rpc>>);
    const handler: BiteshipHandler = createBiteshipHandler({
      fetchFn: vi.fn(),
      getAdminClient: () => adminClient,
      verifyUserId: async () => "user-1",
    });

    try {
      const response = await handler(createRequest("rates", {
        destination_area_id: "DEST-AREA-ID",
        items: [],
      }));
      const body = await readJson(response);
      const loggedText = JSON.stringify(consoleErrorSpy.mock.calls);

      expect(response.status).toBe(503);
      expect(body).toMatchObject({ error: "BITESHIP_CONFIG_INCOMPLETE" });
      expect(loggedText).toContain("biteship_runtime_settings_unavailable");
      expect(loggedText).not.toContain("integration_config_versions");
      expect(loggedText).not.toContain("BITESHIP_API_KEY");
      expect(loggedText).not.toContain("policy stack");
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("returns a safe config error without outbound calls when the runtime API key is missing", async () => {
    envGet.mockImplementation((key: string) => {
      if (key === "SUPABASE_URL") return "https://project.supabase.test";
      if (key === "SUPABASE_SERVICE_ROLE_KEY") return "service-role-sentinel";
      if (key === "BITESHIP_API_KEY") return "env-biteship-key-sentinel";
      return undefined;
    });
    const adminClient = createAdminClient(
      createBiteshipRuntimeRows({ includeApiKey: false }),
    );
    const fetchFn = vi.fn(async () => {
      throw new Error("Biteship must not be called with missing runtime API key");
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
        "biteship.api_key runtime config missing or unavailable",
      ]),
    });
    expect(JSON.stringify(body)).not.toContain("runtime-biteship-secret-sentinel");
    expect(JSON.stringify(body)).not.toContain("env-biteship-key-sentinel");
    expect(JSON.stringify(body)).not.toContain("BITESHIP_API_KEY");
    expect(JSON.stringify(body)).not.toContain("env fallback");
    expect(JSON.stringify(body)).not.toContain("no env fallback configured");
    expect(envGet.mock.calls.map(([key]) => key)).not.toContain("BITESHIP_API_KEY");
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


  it("redacts raw Biteship provider errors and request payloads from caller responses and logs", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const adminClient = createAdminClient(createBiteshipRuntimeRows(), { profileRole: "admin" });
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      error: "provider validation failed",
      customer: { name: "Buyer Private", phone: "0811111111" },
      order_id: "provider-order-123",
      debug: "runtime-biteship-secret-sentinel",
    }), { status: 502 }));
    const handler: BiteshipHandler = createBiteshipHandler({
      fetchFn,
      getAdminClient: () => adminClient,
      verifyUserId: async () => "user-1",
    });

    try {
      const response = await handler(createRequest("draft_order", {
        destination_contact_name: "Buyer Private",
        destination_contact_phone: "0811111111",
        destination_address: "Jl. Private No. 1",
        courier_company: "jne",
        courier_type: "reg",
      }, "test-token", "biteship-provider-1"));
      const body = await readJson(response);
      const bodyText = JSON.stringify(body);
      const loggedText = JSON.stringify(consoleErrorSpy.mock.calls);

      expect(response.status).toBe(502);
      expect(response.headers.get("x-request-id")).toBe("biteship-provider-1");
      expect(body).toEqual({ error: "BITESHIP_PROVIDER_UNAVAILABLE", status: 502 });
      expect(bodyText).not.toContain("Buyer Private");
      expect(bodyText).not.toContain("0811111111");
      expect(bodyText).not.toContain("Jl. Private");
      expect(bodyText).not.toContain("provider-order-123");
      expect(bodyText).not.toContain("runtime-biteship-secret-sentinel");
      expect(loggedText).toContain("biteship_provider_unavailable");
      expect(loggedText).toContain("biteship-provider-1");
      expect(loggedText).not.toContain("Buyer Private");
      expect(loggedText).not.toContain("0811111111");
      expect(loggedText).not.toContain("Jl. Private");
      expect(loggedText).not.toContain("provider-order-123");
      expect(loggedText).not.toContain("runtime-biteship-secret-sentinel");
      expect(consoleErrorSpy.mock.calls[0]?.[1]).not.toHaveProperty("payload");
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("replaces unsafe request IDs in Biteship provider failure responses and logs", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const unsafeRequestId = "x".repeat(129);
    const adminClient = createAdminClient(createBiteshipRuntimeRows(), { profileRole: "admin" });
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ error: "provider failure" }), { status: 503 }));
    const handler: BiteshipHandler = createBiteshipHandler({
      fetchFn,
      getAdminClient: () => adminClient,
      verifyUserId: async () => "user-1",
    });

    try {
      const response = await handler(createRequest("draft_order", {
        destination_contact_name: "Buyer Private",
        destination_contact_phone: "0811111111",
        destination_address: "Jl. Private No. 1",
        courier_company: "jne",
        courier_type: "reg",
      }, "test-token", unsafeRequestId));
      const effectiveRequestId = response.headers.get("x-request-id");
      const loggedText = JSON.stringify(consoleErrorSpy.mock.calls);

      expect(response.status).toBe(503);
      expect(effectiveRequestId).toBeTruthy();
      expect(effectiveRequestId).not.toBe(unsafeRequestId);
      expect(loggedText).toContain(String(effectiveRequestId));
      expect(loggedText).not.toContain(unsafeRequestId);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("maps generic Biteship aborts to stable 504 provider responses", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const adminClient = createAdminClient(createBiteshipRuntimeRows());
    const fetchFn = vi.fn(async () => {
      throw new DOMException("provider timeout secret-sentinel", "AbortError");
    });
    const handler: BiteshipHandler = createBiteshipHandler({
      fetchFn,
      getAdminClient: () => adminClient,
      verifyUserId: async () => "user-1",
    });

    try {
      const response = await handler(createRequest("maps", {
        input: "Jakarta",
      }, "test-token", "biteship-abort-1"));
      const body = await readJson(response);
      const combinedOutput = JSON.stringify({ body, logs: consoleErrorSpy.mock.calls });

      expect(response.status).toBe(504);
      expect(body).toEqual({ error: "BITESHIP_PROVIDER_UNAVAILABLE", status: 504 });
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(combinedOutput).not.toContain("provider timeout secret-sentinel");
    } finally {
      consoleErrorSpy.mockRestore();
    }
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
