export const CONFIG_KEYS = {
  midtransServerKey: "midtrans.server_key",
  biteshipApiKey: "biteship.api_key",
  pushExpoAccessToken: "push.expo_access_token",
  midtransIsProduction: "midtrans.is_production",
  biteshipOriginPostalCode: "biteship.origin_postal_code",
  biteshipOriginAreaId: "biteship.origin_area_id",
  biteshipOriginLatitude: "biteship.origin_latitude",
  biteshipOriginLongitude: "biteship.origin_longitude",
  biteshipEnabledCouriers: "biteship.enabled_couriers",
  shopShipperName: "shop.shipper_name",
  shopShipperPhone: "shop.shipper_phone",
  shopShipperEmail: "shop.shipper_email",
  shopAddress: "shop.address",
  shopOrganization: "shop.organization",
  corsAllowedOrigins: "cors.allowed_origins",
} as const;

export type RuntimeConfigKey = typeof CONFIG_KEYS[keyof typeof CONFIG_KEYS];
export type RuntimeConfigValueKind = "secret" | "boolean" | "text" | "text_array";
export type RuntimeConfigStatus =
  | "active"
  | "grace"
  | "retired"
  | "disabled"
  | "superseded";
export type RuntimeConfigSource = "database";
export type RuntimeConfigParsedValue = string | boolean | string[];
export type RuntimeConfigErrorCode =
  | "CONFIG_MISSING"
  | "CONFIG_INVALID"
  | "CONFIG_UNAVAILABLE";

export interface RuntimeConfigRow {
  key_name: string;
  value_kind: RuntimeConfigValueKind;
  is_secret: boolean;
  is_required: boolean;
  is_runtime_required: boolean;
  version_id: string | null;
  version_number: number;
  status: RuntimeConfigStatus;
  runtime_value: unknown;
  masked_value: string | null;
  value_fingerprint: string | null;
  updated_at: string | null;
}

export interface RuntimeConfigEntry<K extends RuntimeConfigKey = RuntimeConfigKey> {
  keyName: K;
  value: RuntimeConfigParsedValue;
  valueKind: RuntimeConfigValueKind;
  source: RuntimeConfigSource;
  status: RuntimeConfigStatus;
  versionId: string | null;
  versionNumber: number | null;
  maskedValue: string | null;
  valueFingerprint: string | null;
  updatedAt: string | null;
}

export interface RuntimeConfigLogSafeEntry {
  keyName: RuntimeConfigKey;
  valueKind: RuntimeConfigValueKind;
  source: RuntimeConfigSource;
  status: RuntimeConfigStatus;
  versionId: string | null;
  versionNumber: number | null;
  maskedValue: string | null;
  valueFingerprint: string | null;
}

export interface RuntimeConfigLogSafeError {
  code: RuntimeConfigErrorCode;
  keyName?: RuntimeConfigKey;
  versionNumber?: number;
  source?: RuntimeConfigSource;
}

export interface RuntimeConfigAdminClient {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
}

export interface RuntimeConfigProviderOptions {
  adminClient?: RuntimeConfigAdminClient;
  cacheTtlMs?: number;
  now?: () => number;
}

type RuntimeConfigDefinition = {
  keyName: RuntimeConfigKey;
  valueKind: RuntimeConfigValueKind;
  runtimeRequired: boolean;
};

type CacheEntry = {
  expiresAt: number;
  rows: RuntimeConfigRow[];
};

const RUNTIME_CONFIG_LOOKUP_RPC = "get_runtime_integration_config_versions";
const DEFAULT_CACHE_TTL_MS = 30_000;
const STATUS_ORDER: Record<RuntimeConfigStatus, number> = {
  active: 0,
  grace: 1,
  retired: 2,
  disabled: 3,
  superseded: 4,
};

const CONFIG_DEFINITIONS = {
  [CONFIG_KEYS.midtransServerKey]: {
    keyName: CONFIG_KEYS.midtransServerKey,
    valueKind: "secret",
    runtimeRequired: true,
  },
  [CONFIG_KEYS.biteshipApiKey]: {
    keyName: CONFIG_KEYS.biteshipApiKey,
    valueKind: "secret",
    runtimeRequired: true,
  },
  [CONFIG_KEYS.pushExpoAccessToken]: {
    keyName: CONFIG_KEYS.pushExpoAccessToken,
    valueKind: "secret",
    runtimeRequired: false,
  },
  [CONFIG_KEYS.midtransIsProduction]: {
    keyName: CONFIG_KEYS.midtransIsProduction,
    valueKind: "boolean",
    runtimeRequired: true,
  },
  [CONFIG_KEYS.biteshipOriginPostalCode]: {
    keyName: CONFIG_KEYS.biteshipOriginPostalCode,
    valueKind: "text",
    runtimeRequired: true,
  },
  [CONFIG_KEYS.biteshipOriginAreaId]: {
    keyName: CONFIG_KEYS.biteshipOriginAreaId,
    valueKind: "text",
    runtimeRequired: true,
  },
  [CONFIG_KEYS.biteshipOriginLatitude]: {
    keyName: CONFIG_KEYS.biteshipOriginLatitude,
    valueKind: "text",
    runtimeRequired: true,
  },
  [CONFIG_KEYS.biteshipOriginLongitude]: {
    keyName: CONFIG_KEYS.biteshipOriginLongitude,
    valueKind: "text",
    runtimeRequired: true,
  },
  [CONFIG_KEYS.biteshipEnabledCouriers]: {
    keyName: CONFIG_KEYS.biteshipEnabledCouriers,
    valueKind: "text_array",
    runtimeRequired: true,
  },
  [CONFIG_KEYS.shopShipperName]: {
    keyName: CONFIG_KEYS.shopShipperName,
    valueKind: "text",
    runtimeRequired: true,
  },
  [CONFIG_KEYS.shopShipperPhone]: {
    keyName: CONFIG_KEYS.shopShipperPhone,
    valueKind: "text",
    runtimeRequired: true,
  },
  [CONFIG_KEYS.shopShipperEmail]: {
    keyName: CONFIG_KEYS.shopShipperEmail,
    valueKind: "text",
    runtimeRequired: true,
  },
  [CONFIG_KEYS.shopAddress]: {
    keyName: CONFIG_KEYS.shopAddress,
    valueKind: "text",
    runtimeRequired: true,
  },
  [CONFIG_KEYS.shopOrganization]: {
    keyName: CONFIG_KEYS.shopOrganization,
    valueKind: "text",
    runtimeRequired: true,
  },
  [CONFIG_KEYS.corsAllowedOrigins]: {
    keyName: CONFIG_KEYS.corsAllowedOrigins,
    valueKind: "text_array",
    runtimeRequired: false,
  },
} satisfies Record<RuntimeConfigKey, RuntimeConfigDefinition>;

export class RuntimeConfigError extends Error {
  readonly code: RuntimeConfigErrorCode;
  readonly keyName?: RuntimeConfigKey;
  readonly versionNumber?: number;
  readonly source?: RuntimeConfigSource;

  constructor(params: {
    code: RuntimeConfigErrorCode;
    keyName?: RuntimeConfigKey;
    versionNumber?: number;
    source?: RuntimeConfigSource;
  }) {
    super(buildRuntimeConfigErrorMessage(params));
    this.name = "RuntimeConfigError";
    this.code = params.code;
    this.keyName = params.keyName;
    this.versionNumber = params.versionNumber;
    this.source = params.source;
  }

  toLogSafe(): RuntimeConfigLogSafeError {
    return {
      code: this.code,
      ...(this.keyName ? { keyName: this.keyName } : {}),
      ...(this.versionNumber ? { versionNumber: this.versionNumber } : {}),
      ...(this.source ? { source: this.source } : {}),
    };
  }

  toJSON(): RuntimeConfigLogSafeError {
    return this.toLogSafe();
  }
}

export function createRuntimeConfigProvider(
  options: RuntimeConfigProviderOptions = {},
): RuntimeConfigProvider {
  return new RuntimeConfigProvider(options);
}

export class RuntimeConfigProvider {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly cacheTtlMs: number;
  private readonly now: () => number;

  constructor(private readonly options: RuntimeConfigProviderOptions = {}) {
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  async getRequiredConfig<K extends RuntimeConfigKey>(
    keyName: K,
  ): Promise<RuntimeConfigEntry<K>> {
    const entry = await this.getOptionalConfig(keyName);
    if (entry) {
      return entry;
    }

    throw new RuntimeConfigError({
      code: "CONFIG_MISSING",
      keyName,
    });
  }

  async getOptionalConfig<K extends RuntimeConfigKey>(
    keyName: K,
  ): Promise<RuntimeConfigEntry<K> | null> {
    const rows = await this.lookupRows([keyName], {}, false, keyName);
    const activeEntry = rows
      .map((row) => this.parseRow(row, keyName))
      .find((candidate) => candidate.status === "active") as
        | RuntimeConfigEntry<K>
        | undefined;

    return activeEntry ?? null;
  }

  async getConfigCandidates<K extends RuntimeConfigKey>(
    keyName: K,
  ): Promise<Array<RuntimeConfigEntry<K>>> {
    const rows = await this.lookupRows([keyName], {}, true, keyName);

    return rows
      .map((row) => this.parseRow(row, keyName))
      .filter((entry): entry is RuntimeConfigEntry<K> => entry.keyName === keyName)
      .sort(compareRuntimeConfigEntries);
  }

  async getConfigVersion<K extends RuntimeConfigKey>(
    keyName: K,
    versionNumber: number,
  ): Promise<RuntimeConfigEntry<K>> {
    assertPositiveVersionNumber(keyName, versionNumber);

    const rows = await this.lookupRows(
      [keyName],
      { [keyName]: versionNumber },
      false,
      keyName,
    );
    const entry = rows
      .map((row) => this.parseRow(row, keyName))
      .find((candidate) =>
        candidate.keyName === keyName && candidate.versionNumber === versionNumber
      ) as RuntimeConfigEntry<K> | undefined;

    if (!entry) {
      throw new RuntimeConfigError({
        code: "CONFIG_MISSING",
        keyName,
        versionNumber,
      });
    }

    return entry;
  }

  clearCache(keyName?: RuntimeConfigKey): void {
    if (!keyName) {
      this.cache.clear();
      return;
    }

    for (const cacheKey of this.cache.keys()) {
      if (cacheKey.includes(`"${keyName}"`)) {
        this.cache.delete(cacheKey);
      }
    }
  }

  private async lookupRows(
    keyNames: RuntimeConfigKey[],
    versionNumbers: Record<string, number>,
    includeGrace: boolean,
    errorKeyName: RuntimeConfigKey,
  ): Promise<RuntimeConfigRow[]> {
    const cacheKey = buildCacheKey(keyNames, versionNumbers, includeGrace);
    const cachedEntry = this.cache.get(cacheKey);
    if (cachedEntry && cachedEntry.expiresAt > this.now()) {
      return cachedEntry.rows;
    }

    const adminClient = await this.getAdminClient();
    const { data, error } = await adminClient.rpc(RUNTIME_CONFIG_LOOKUP_RPC, {
      p_key_names: [...keyNames].sort(),
      p_version_numbers: versionNumbers,
      p_include_grace: includeGrace,
    });

    if (error) {
      throw new RuntimeConfigError({
        code: "CONFIG_UNAVAILABLE",
        keyName: errorKeyName,
      });
    }

    const rows = Array.isArray(data) ? data as RuntimeConfigRow[] : [];
    this.writeCache(cacheKey, rows);
    return rows;
  }

  private writeCache(cacheKey: string, rows: RuntimeConfigRow[]): void {
    if (this.cacheTtlMs <= 0) {
      return;
    }

    this.cache.set(cacheKey, {
      expiresAt: this.now() + this.cacheTtlMs,
      rows,
    });
  }

  private async getAdminClient(): Promise<RuntimeConfigAdminClient> {
    if (this.options.adminClient) {
      return this.options.adminClient;
    }

    const supabaseModule = await import("./supabase.ts");
    return supabaseModule.getSupabaseAdminClient() as RuntimeConfigAdminClient;
  }

  private parseRow<K extends RuntimeConfigKey>(
    row: RuntimeConfigRow,
    requestedKeyName: K,
  ): RuntimeConfigEntry<K> {
    const definition = getConfigDefinition(requestedKeyName);
    if (row.key_name !== requestedKeyName || row.value_kind !== definition.valueKind) {
      throw new RuntimeConfigError({
        code: "CONFIG_INVALID",
        keyName: requestedKeyName,
        source: "database",
      });
    }

    const value = parseRuntimeConfigValue(
      requestedKeyName,
      row.runtime_value,
      definition.valueKind,
    );

    return {
      keyName: requestedKeyName,
      value,
      valueKind: definition.valueKind,
      source: "database",
      status: row.status,
      versionId: row.version_id,
      versionNumber: row.version_number,
      maskedValue: row.masked_value,
      valueFingerprint: row.value_fingerprint,
      updatedAt: row.updated_at,
    };
  }

}

export function toLogSafeRuntimeConfig(
  entry: RuntimeConfigEntry,
): RuntimeConfigLogSafeEntry {
  return {
    keyName: entry.keyName,
    valueKind: entry.valueKind,
    source: entry.source,
    status: entry.status,
    versionId: entry.versionId,
    versionNumber: entry.versionNumber,
    maskedValue: entry.maskedValue,
    valueFingerprint: entry.valueFingerprint,
  };
}

export function maskRuntimeConfigValue(
  value: string | null | undefined,
): string | null {
  if (value == null) {
    return null;
  }

  if (value.length === 0) {
    return null;
  }

  if (value.length <= 8) {
    return "*".repeat(value.length);
  }

  return `${value.slice(0, 4)}${"*".repeat(Math.max(value.length - 8, 4))}${value.slice(-4)}`;
}

export async function fingerprintRuntimeConfigValue(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function buildRuntimeConfigErrorMessage(params: {
  code: RuntimeConfigErrorCode;
  keyName?: RuntimeConfigKey;
  versionNumber?: number;
}): string {
  const keyLabel = params.keyName ? ` for ${params.keyName}` : "";
  const versionLabel = params.versionNumber
    ? ` version ${params.versionNumber}`
    : "";

  if (params.code === "CONFIG_MISSING") {
    return `Runtime config missing${keyLabel}${versionLabel}`;
  }

  if (params.code === "CONFIG_INVALID") {
    return `Runtime config invalid${keyLabel}${versionLabel}`;
  }

  if (params.code === "CONFIG_UNAVAILABLE") {
    return `Runtime config unavailable${keyLabel}${versionLabel}`;
  }

  return `Runtime config unavailable${keyLabel}${versionLabel}`;
}

function buildCacheKey(
  keyNames: RuntimeConfigKey[],
  versionNumbers: Record<string, number>,
  includeGrace: boolean,
): string {
  return JSON.stringify({
    includeGrace,
    keyNames: [...keyNames].sort(),
    versionNumbers: Object.fromEntries(
      Object.entries(versionNumbers).sort(([leftKey], [rightKey]) =>
        leftKey.localeCompare(rightKey)
      ),
    ),
  });
}

function compareRuntimeConfigEntries(
  left: RuntimeConfigEntry,
  right: RuntimeConfigEntry,
): number {
  const leftStatusOrder = STATUS_ORDER[left.status];
  const rightStatusOrder = STATUS_ORDER[right.status];

  if (leftStatusOrder !== rightStatusOrder) {
    return leftStatusOrder - rightStatusOrder;
  }

  return (right.versionNumber ?? 0) - (left.versionNumber ?? 0);
}

function getConfigDefinition(keyName: RuntimeConfigKey): RuntimeConfigDefinition {
  return CONFIG_DEFINITIONS[keyName];
}

function parseRuntimeConfigValue(
  keyName: RuntimeConfigKey,
  value: unknown,
  valueKind: RuntimeConfigValueKind,
  source: RuntimeConfigSource = "database",
): RuntimeConfigParsedValue {
  if (valueKind === "secret" || valueKind === "text") {
    return parseRuntimeConfigString(keyName, value, source);
  }

  if (valueKind === "boolean") {
    return parseRuntimeConfigBoolean(keyName, value, source);
  }

  return parseRuntimeConfigTextArray(keyName, value, source);
}

function parseRuntimeConfigString(
  keyName: RuntimeConfigKey,
  value: unknown,
  source: RuntimeConfigSource,
): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new RuntimeConfigError({
      code: value == null ? "CONFIG_MISSING" : "CONFIG_INVALID",
      keyName,
      source,
    });
  }

  return value.trim();
}

function parseRuntimeConfigBoolean(
  keyName: RuntimeConfigKey,
  value: unknown,
  source: RuntimeConfigSource,
): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalizedValue = value.trim().toLowerCase();
    if (normalizedValue === "true") {
      return true;
    }
    if (normalizedValue === "false") {
      return false;
    }
  }

  throw new RuntimeConfigError({
    code: value == null ? "CONFIG_MISSING" : "CONFIG_INVALID",
    keyName,
    source,
  });
}

function parseRuntimeConfigTextArray(
  keyName: RuntimeConfigKey,
  value: unknown,
  source: RuntimeConfigSource,
): string[] {
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    const values = value.map((item) => item.trim()).filter(Boolean);
    if (values.length > 0) {
      return values;
    }
  }

  if (typeof value === "string") {
    const values = value.split(",").map((item) => item.trim()).filter(Boolean);
    if (values.length > 0) {
      return values;
    }
  }

  throw new RuntimeConfigError({
    code: value == null ? "CONFIG_MISSING" : "CONFIG_INVALID",
    keyName,
    source,
  });
}

function assertPositiveVersionNumber(
  keyName: RuntimeConfigKey,
  versionNumber: number,
): void {
  if (!Number.isInteger(versionNumber) || versionNumber <= 0) {
    throw new RuntimeConfigError({
      code: "CONFIG_INVALID",
      keyName,
      versionNumber,
    });
  }
}
