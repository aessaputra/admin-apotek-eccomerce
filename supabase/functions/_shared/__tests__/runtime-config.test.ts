import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CONFIG_KEYS,
  RuntimeConfigError,
  createRuntimeConfigProvider,
  fingerprintRuntimeConfigValue,
  maskRuntimeConfigValue,
  toLogSafeRuntimeConfig,
  type RuntimeConfigErrorCode,
  type RuntimeConfigRow,
} from "../runtime-config.ts";

const activeMidtransRow = createRuntimeConfigRow({
  key_name: CONFIG_KEYS.midtransServerKey,
  version_id: "version-active",
  version_number: 3,
  status: "active",
  runtime_value: "db-active-midtrans-secret",
  masked_value: "midt****************cret",
  value_fingerprint: "active-fingerprint",
});

const graceMidtransRow = createRuntimeConfigRow({
  key_name: CONFIG_KEYS.midtransServerKey,
  version_id: "version-grace",
  version_number: 2,
  status: "grace",
  runtime_value: "db-grace-midtrans-secret",
  masked_value: "midt***************cret",
  value_fingerprint: "grace-fingerprint",
});

function createRuntimeConfigRow(
  overrides: Partial<RuntimeConfigRow> = {},
): RuntimeConfigRow {
  return {
    key_name: CONFIG_KEYS.midtransServerKey,
    value_kind: "secret",
    is_secret: true,
    is_required: true,
    is_runtime_required: true,
    version_id: "version-1",
    version_number: 1,
    status: "active",
    runtime_value: "db-secret",
    masked_value: "db-****cret",
    value_fingerprint: "fingerprint",
    updated_at: "2026-05-18T00:00:00.000Z",
    ...overrides,
  };
}

function createEnvMock(values: Record<string, string | undefined>) {
  return {
    get: vi.fn((key: string) => values[key]),
  };
}

function createRuntimeConfigClient(
  rows: RuntimeConfigRow[],
  error: { message: string } | null = null,
) {
  return {
    rpc: vi.fn(async (_name: string, args: Record<string, unknown>) => {
      if (error) {
        return { data: null, error };
      }

      const keyNames = args.p_key_names as string[];
      const versionNumbers = (args.p_version_numbers ?? {}) as Record<string, number>;
      const includeGrace = args.p_include_grace === true;

      const data = rows.filter((row) => {
        if (!keyNames.includes(row.key_name)) {
          return false;
        }

        const explicitVersion = versionNumbers[row.key_name];
        if (explicitVersion !== undefined) {
          return row.version_number === explicitVersion;
        }

        if (includeGrace) {
          return row.status === "active" || row.status === "grace";
        }

        return row.status === "active";
      });

      return { data, error: null };
    }),
  };
}

async function captureRuntimeConfigError(
  action: () => Promise<unknown>,
): Promise<RuntimeConfigError> {
  try {
    await action();
  } catch (error) {
    if (error instanceof RuntimeConfigError) {
      return error;
    }
    throw error;
  }

  throw new Error("Expected RuntimeConfigError");
}

describe("runtime config log-safe helpers", () => {
  it("masks and fingerprints values without exposing plaintext", async () => {
    const plaintext = "runtime-secret-sentinel-value";
    const maskedValue = maskRuntimeConfigValue(plaintext);
    const fingerprint = await fingerprintRuntimeConfigValue(plaintext);

    expect(maskedValue).toMatch(/^runt\*+alue$/);
    expect(maskedValue).not.toContain("secret-sentinel");
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(fingerprint).toBe(await fingerprintRuntimeConfigValue(plaintext));
    expect(fingerprint).not.toContain(plaintext);
  });
});

describe("runtime config database lookups", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads active config through the service-role RPC and reuses the TTL cache", async () => {
    const adminClient = createRuntimeConfigClient([activeMidtransRow]);
    const provider = createRuntimeConfigProvider({
      adminClient,
      cacheTtlMs: 60_000,
      now: () => 1_000,
    });

    const first = await provider.getRequiredConfig(CONFIG_KEYS.midtransServerKey);
    const second = await provider.getRequiredConfig(CONFIG_KEYS.midtransServerKey);

    expect(first).toMatchObject({
      keyName: CONFIG_KEYS.midtransServerKey,
      source: "database",
      status: "active",
      versionId: "version-active",
      versionNumber: 3,
      value: "db-active-midtrans-secret",
      maskedValue: "midt****************cret",
      valueFingerprint: "active-fingerprint",
    });
    expect(second).toEqual(first);
    expect(adminClient.rpc).toHaveBeenCalledTimes(1);
    expect(adminClient.rpc).toHaveBeenCalledWith(
      "get_runtime_integration_config_versions",
      {
        p_key_names: [CONFIG_KEYS.midtransServerKey],
        p_version_numbers: {},
        p_include_grace: false,
      },
    );
    expect(JSON.stringify(toLogSafeRuntimeConfig(first))).not.toContain(
      "db-active-midtrans-secret",
    );
  });

  it("returns active and grace candidates with active first", async () => {
    const adminClient = createRuntimeConfigClient([
      graceMidtransRow,
      activeMidtransRow,
    ]);
    const provider = createRuntimeConfigProvider({ adminClient });

    const candidates = await provider.getConfigCandidates(
      CONFIG_KEYS.midtransServerKey,
    );

    expect(candidates.map((candidate) => candidate.status)).toEqual([
      "active",
      "grace",
    ]);
    expect(candidates.map((candidate) => candidate.value)).toEqual([
      "db-active-midtrans-secret",
      "db-grace-midtrans-secret",
    ]);
    expect(adminClient.rpc).toHaveBeenCalledWith(
      "get_runtime_integration_config_versions",
      {
        p_key_names: [CONFIG_KEYS.midtransServerKey],
        p_version_numbers: {},
        p_include_grace: true,
      },
    );
  });

  it("loads an explicit config version by key and version number", async () => {
    const adminClient = createRuntimeConfigClient([
      activeMidtransRow,
      graceMidtransRow,
    ]);
    const provider = createRuntimeConfigProvider({ adminClient });

    const version = await provider.getConfigVersion(
      CONFIG_KEYS.midtransServerKey,
      2,
    );

    expect(version).toMatchObject({
      keyName: CONFIG_KEYS.midtransServerKey,
      status: "grace",
      versionId: "version-grace",
      versionNumber: 2,
      value: "db-grace-midtrans-secret",
    });
    expect(adminClient.rpc).toHaveBeenCalledWith(
      "get_runtime_integration_config_versions",
      {
        p_key_names: [CONFIG_KEYS.midtransServerKey],
        p_version_numbers: { [CONFIG_KEYS.midtransServerKey]: 2 },
        p_include_grace: false,
      },
    );
  });
});

describe("runtime config fallback and errors", () => {
  it("fails closed for required config when fallback is disabled", async () => {
    const fallbackSentinel = "fallback-secret-sentinel";
    const env = createEnvMock({ MIDTRANS_SERVER_KEY: fallbackSentinel });
    const adminClient = createRuntimeConfigClient([]);
    const provider = createRuntimeConfigProvider({
      adminClient,
      fallback: { enabled: false, env },
    });

    const error = await captureRuntimeConfigError(() =>
      provider.getRequiredConfig(CONFIG_KEYS.midtransServerKey),
    );

    expect(error.code).toBe("CONFIG_MISSING" satisfies RuntimeConfigErrorCode);
    expect(error.toLogSafe()).toMatchObject({
      code: "CONFIG_MISSING",
      keyName: CONFIG_KEYS.midtransServerKey,
    });
    expect(env.get).not.toHaveBeenCalled();
    expect(JSON.stringify(error)).not.toContain(fallbackSentinel);
  });

  it("requires fallback callers to explicitly allow each fallback key", async () => {
    const env = createEnvMock({ MIDTRANS_SERVER_KEY: "allowed-key-required" });
    const adminClient = createRuntimeConfigClient([]);
    const provider = createRuntimeConfigProvider({
      adminClient,
      fallback: { enabled: true, env },
    });

    const error = await captureRuntimeConfigError(() =>
      provider.getRequiredConfig(CONFIG_KEYS.midtransServerKey),
    );

    expect(error.code).toBe("CONFIG_MISSING" satisfies RuntimeConfigErrorCode);
    expect(env.get).not.toHaveBeenCalled();
  });

  it("uses request-time fallback without fallback audit writes in pre-signature mode", async () => {
    const fallbackSentinel = "fallback-midtrans-secret-sentinel";
    const env = createEnvMock({ MIDTRANS_SERVER_KEY: fallbackSentinel });
    const adminClient = createRuntimeConfigClient([]);
    const provider = createRuntimeConfigProvider({
      adminClient,
      fallback: {
        enabled: true,
        env,
        allowKeys: [CONFIG_KEYS.midtransServerKey],
      },
    });

    const config = await provider.getRequiredConfig(
      CONFIG_KEYS.midtransServerKey,
      { preSignature: true },
    );

    expect(config).toMatchObject({
      keyName: CONFIG_KEYS.midtransServerKey,
      source: "environment",
      value: fallbackSentinel,
      warning: {
        code: "CONFIG_FALLBACK_USED",
        keyName: CONFIG_KEYS.midtransServerKey,
      },
    });
    expect(env.get).toHaveBeenCalledWith("MIDTRANS_SERVER_KEY");
    expect(adminClient.rpc).toHaveBeenCalledTimes(1);
    expect(adminClient.rpc.mock.calls.map(([rpcName]) => rpcName)).toEqual([
      "get_runtime_integration_config_versions",
    ]);
    expect(JSON.stringify(config.warning)).not.toContain(fallbackSentinel);
    expect(JSON.stringify(toLogSafeRuntimeConfig(config))).not.toContain(
      fallbackSentinel,
    );
  });

  it("rejects invalid fallback values without serializing the submitted value", async () => {
    const invalidBooleanSentinel = "not-a-boolean-sentinel";
    const env = createEnvMock({ MIDTRANS_IS_PRODUCTION: invalidBooleanSentinel });
    const adminClient = createRuntimeConfigClient([]);
    const provider = createRuntimeConfigProvider({
      adminClient,
      fallback: {
        enabled: true,
        env,
        allowKeys: [CONFIG_KEYS.midtransIsProduction],
      },
    });

    const error = await captureRuntimeConfigError(() =>
      provider.getRequiredConfig(CONFIG_KEYS.midtransIsProduction),
    );

    expect(error.code).toBe("CONFIG_INVALID" satisfies RuntimeConfigErrorCode);
    expect(error.toLogSafe()).toMatchObject({
      code: "CONFIG_INVALID",
      keyName: CONFIG_KEYS.midtransIsProduction,
    });
    expect(JSON.stringify(error)).not.toContain(invalidBooleanSentinel);
  });

  it("reports unavailable database lookups without leaking database messages", async () => {
    const databaseMessage = "database unavailable with leaked-secret-sentinel";
    const adminClient = createRuntimeConfigClient([], { message: databaseMessage });
    const provider = createRuntimeConfigProvider({ adminClient });

    const error = await captureRuntimeConfigError(() =>
      provider.getRequiredConfig(CONFIG_KEYS.midtransServerKey),
    );

    expect(error.code).toBe("CONFIG_UNAVAILABLE" satisfies RuntimeConfigErrorCode);
    expect(error.toLogSafe()).toMatchObject({
      code: "CONFIG_UNAVAILABLE",
      keyName: CONFIG_KEYS.midtransServerKey,
    });
    expect(JSON.stringify(error)).not.toContain(databaseMessage);
    expect(error.message).not.toContain(databaseMessage);
  });
});
