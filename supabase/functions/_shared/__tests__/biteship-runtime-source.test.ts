import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveBiteshipRuntimeSettings } from "../biteship.ts";
import { CONFIG_KEYS, type RuntimeConfigRow } from "../runtime-config.ts";

const getSupabaseAdminClientMock = vi.hoisted(() => vi.fn());

vi.mock("../supabase.ts", () => ({
  getSupabaseAdminClient: getSupabaseAdminClientMock,
}));

const readSource = (relativePath: string) =>
  readFileSync(join(process.cwd(), relativePath), "utf8");

const targetRuntimeFiles = [
  "supabase/functions/biteship/index.ts",
  "supabase/functions/biteship/handler.ts",
  "supabase/functions/order-manager/index.ts",
  "supabase/functions/_shared/webhook-side-effects.ts",
];

const requiredBiteshipRuntimeKeys = [
  CONFIG_KEYS.biteshipApiKey,
  CONFIG_KEYS.biteshipEnabledCouriers,
  CONFIG_KEYS.biteshipOriginAreaId,
  CONFIG_KEYS.biteshipOriginLatitude,
  CONFIG_KEYS.biteshipOriginLongitude,
  CONFIG_KEYS.biteshipOriginPostalCode,
  CONFIG_KEYS.shopShipperName,
  CONFIG_KEYS.shopShipperPhone,
  CONFIG_KEYS.shopShipperEmail,
  CONFIG_KEYS.shopAddress,
  CONFIG_KEYS.shopOrganization,
] as const;

function createRuntimeConfigRow(
  keyName: string,
  runtimeValue: string | string[],
  versionNumber: number,
  valueKind: RuntimeConfigRow["value_kind"] = Array.isArray(runtimeValue)
    ? "text_array"
    : "text",
  status: RuntimeConfigRow["status"] = "active",
): RuntimeConfigRow {
  return {
    key_name: keyName,
    value_kind: valueKind,
    is_secret: valueKind === "secret",
    is_required: true,
    is_runtime_required: true,
    version_id: `version-${keyName.replaceAll(".", "-")}`,
    version_number: versionNumber,
    status,
    runtime_value: runtimeValue,
    masked_value: valueKind === "secret" ? "bite************inel" : null,
    value_fingerprint: valueKind === "secret" ? "runtime-fingerprint" : null,
    updated_at: "2026-05-21T00:00:00.000Z",
  };
}

function createBiteshipRuntimeRows(options: {
  includeApiKey?: boolean;
  apiKey?: string;
  enabledCouriers?: string[];
} = {}): RuntimeConfigRow[] {
  const includeApiKey = options.includeApiKey ?? true;

  return [
    ...(includeApiKey
      ? [createRuntimeConfigRow(
        CONFIG_KEYS.biteshipApiKey,
        options.apiKey ?? "runtime-biteship-secret-sentinel",
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
    createRuntimeConfigRow(CONFIG_KEYS.biteshipOriginAreaId, "RUNTIME-AREA-ID", 3),
    createRuntimeConfigRow(CONFIG_KEYS.biteshipOriginLatitude, "-6.145632", 4),
    createRuntimeConfigRow(CONFIG_KEYS.biteshipOriginLongitude, "106.226614", 5),
    createRuntimeConfigRow(CONFIG_KEYS.biteshipOriginPostalCode, "12345", 6),
    createRuntimeConfigRow(CONFIG_KEYS.shopShipperName, "Runtime Sender", 7),
    createRuntimeConfigRow(CONFIG_KEYS.shopShipperPhone, "0812222222", 8),
    createRuntimeConfigRow(CONFIG_KEYS.shopShipperEmail, "runtime@example.com", 9),
    createRuntimeConfigRow(CONFIG_KEYS.shopAddress, "Jl. Runtime No. 10", 10),
    createRuntimeConfigRow(CONFIG_KEYS.shopOrganization, "Runtime Pharmacy", 11),
  ];
}

function createRuntimeConfigClient(rows: RuntimeConfigRow[]) {
  return {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      expect(name).toBe("get_runtime_integration_config_versions");
      const keyNames = (args.p_key_names ?? []) as string[];
      const includeGrace = args.p_include_grace === true;
      const data = rows.filter((row) => {
        if (!keyNames.includes(row.key_name)) {
          return false;
        }

        return includeGrace
          ? row.status === "active" || row.status === "grace"
          : row.status === "active";
      });

      return { data, error: null };
    }),
  };
}

function getRequestedKeyNames(
  adminClient: ReturnType<typeof createRuntimeConfigClient>,
): string[] {
  return adminClient.rpc.mock.calls.flatMap(
    ([, args]) => (args.p_key_names ?? []) as string[],
  );
}

describe("Biteship runtime config source migration", () => {
  it("removes direct Biteship provider env reads from runtime paths", () => {
    for (const relativePath of targetRuntimeFiles) {
      const source = readSource(relativePath);

      expect(source, relativePath).not.toContain('Deno.env.get("BITESHIP_API_KEY")');
      expect(source, relativePath).not.toContain("Missing BITESHIP_API_KEY");
    }
  });

  it("uses the shared runtime config helper for Biteship API key lookups", () => {
    const sharedSource = readSource("supabase/functions/_shared/biteship.ts");

    expect(sharedSource).toContain("CONFIG_KEYS.biteshipApiKey");
    expect(sharedSource).toContain("createRuntimeConfigProvider");
    expect(sharedSource).toContain("resolveBiteshipApiKeyFromRuntimeConfig");
  });

  it("registers the Biteship handler without a module-level API key guard", () => {
    const source = readSource("supabase/functions/biteship/index.ts");
    const serveIndex = source.indexOf("Deno.serve");

    expect(serveIndex).toBeGreaterThan(-1);
    expect(source.slice(0, serveIndex)).not.toContain("biteship.api_key");
    expect(source.slice(0, serveIndex)).not.toContain("BITESHIP_API_KEY");
  });

});

describe("Biteship runtime settings helper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("loads runtime config settings without reading legacy store settings", async () => {
    const adminClient = createRuntimeConfigClient(createBiteshipRuntimeRows());
    const env = { get: vi.fn(() => "env-biteship-secret-must-not-be-used") };
    const legacySettingsFrom = vi.fn(() => {
      throw new Error("legacy settings enabled_couriers=sicepat must not be read");
    });
    vi.stubGlobal("Deno", { env });
    getSupabaseAdminClientMock.mockResolvedValue({ from: legacySettingsFrom });

    const settings = await resolveBiteshipRuntimeSettings(adminClient);

    expect(settings).toMatchObject({
      apiKeyConfigured: true,
      apiKeySource: "runtime_config",
      enabledCouriers: ["jne"],
      originAreaId: "RUNTIME-AREA-ID",
      originPostalCode: "12345",
      originLatitude: -6.145632,
      originLongitude: 106.226614,
      shipperName: "Runtime Sender",
      shipperPhone: "0812222222",
      shipperEmail: "runtime@example.com",
      shipperAddress: "Jl. Runtime No. 10",
      shipperOrganization: "Runtime Pharmacy",
      diagnostics: [],
    });
    expect(env.get).not.toHaveBeenCalled();
    expect(getSupabaseAdminClientMock).not.toHaveBeenCalled();
    expect(legacySettingsFrom).not.toHaveBeenCalled();

    const requestedKeyNames = getRequestedKeyNames(adminClient);
    expect(requestedKeyNames).toHaveLength(requiredBiteshipRuntimeKeys.length);
    expect([...new Set(requestedKeyNames)].sort()).toEqual(
      [...requiredBiteshipRuntimeKeys].sort(),
    );
    expect(JSON.stringify(settings)).not.toContain("runtime-biteship-secret-sentinel");
    expect(JSON.stringify(settings)).not.toContain("env-biteship-secret-must-not-be-used");
    expect(JSON.stringify(settings)).not.toContain("sicepat");
  });

  it("reports a safe missing API key diagnostic without exposing secret material", async () => {
    const adminClient = createRuntimeConfigClient(
      createBiteshipRuntimeRows({ includeApiKey: false }),
    );
    const env = { get: vi.fn(() => undefined) };
    vi.stubGlobal("Deno", { env });

    const settings = await resolveBiteshipRuntimeSettings(adminClient);

    expect(settings.apiKeyConfigured).toBe(false);
    expect(settings.apiKeySource).toBe("missing");
    expect(settings.diagnostics).toContain(
      "biteship.api_key current version missing; no env fallback configured",
    );
    expect(settings.diagnostics.join(" ")).not.toContain("BITESHIP_API_KEY=");
    expect(JSON.stringify(settings)).not.toContain("runtime_biteship_secret");
    expect(JSON.stringify(settings)).not.toContain("runtime_value");
    expect(env.get).toHaveBeenCalledWith("BITESHIP_API_KEY");

    const requestedKeyNames = getRequestedKeyNames(adminClient);
    expect(requestedKeyNames).toHaveLength(requiredBiteshipRuntimeKeys.length);
    expect([...new Set(requestedKeyNames)].sort()).toEqual(
      [...requiredBiteshipRuntimeKeys].sort(),
    );
  });
});
