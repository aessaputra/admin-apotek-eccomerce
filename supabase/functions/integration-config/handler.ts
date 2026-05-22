import { corsHeaders } from "../_shared/cors.ts";
import {
  type BiteshipApiKeySource,
  type BiteshipRuntimeSettings,
  resolveBiteshipRuntimeSettings,
} from "../_shared/biteship.ts";

const JSON_HEADERS = { ...corsHeaders, "Content-Type": "application/json" };
const ADMIN_SOURCE = "admin_gateway";

type IntegrationConfigAction = "summary" | "rotateSecret" | "updateValue" | "audit";

type IntegrationConfigRequestBody = {
  action?: unknown;
  keys?: unknown;
  key?: unknown;
  secret?: unknown;
  value?: unknown;
  reason?: unknown;
  limit?: unknown;
};

type UserRecord = {
  id: string;
};

type ProfileRecord = {
  role?: string | null;
};

type SupabaseError = {
  message?: string;
};

type ProfileSelectQuery = {
  eq: (column: string, value: unknown) => ProfileSelectQuery;
  single: () => Promise<{ data: ProfileRecord | null; error: SupabaseError | null }>;
};

type ProfilesTableQuery = {
  select: (columns: string) => ProfileSelectQuery;
};

type SettingsSelectQuery = {
  eq: (column: string, value: unknown) => SettingsSelectQuery;
  maybeSingle: () => Promise<{ data: LegacySettingsRecord | null; error: SupabaseError | null }>;
};

type SettingsTableQuery = {
  select: (columns: string) => SettingsSelectQuery;
};

type LegacySettingsRecord = {
  enabled_couriers?: string | null;
  origin_area_id?: string | null;
  origin_postal_code?: string | number | null;
  origin_latitude?: string | number | null;
  origin_longitude?: string | number | null;
};

type BiteshipHealthMissingKey =
  | "biteship.api_key"
  | "biteship.enabled_couriers"
  | "biteship.origin_area_id"
  | "biteship.origin_postal_code"
  | "biteship.origin_latitude"
  | "biteship.origin_longitude";

type BiteshipLegacyDrift = {
  enabledCouriers: boolean | null;
  originArea: boolean | null;
  originPostalCode: boolean | null;
  originCoordinates: boolean | null;
};

export type BiteshipIntegrationHealth = {
  provider: "biteship";
  apiKeyConfigured: boolean;
  apiKeySource: BiteshipApiKeySource;
  requiredConfigComplete: boolean;
  missingKeys: BiteshipHealthMissingKey[];
  legacyDrift: BiteshipLegacyDrift;
  diagnostics: string[];
};

type IntegrationConfigRpcName =
  | "list_integration_config_summary"
  | "rotate_integration_config_secret"
  | "update_integration_config_value"
  | "list_integration_config_audit"
  | "get_runtime_integration_config_versions";

export interface IntegrationConfigAuthClient {
  auth: {
    getUser: (token: string) => Promise<{ data: { user: UserRecord | null }; error: SupabaseError | null }>;
  };
}

export interface IntegrationConfigAdminClient {
  from: {
    (table: "profiles"): ProfilesTableQuery;
    (table: "settings"): SettingsTableQuery;
  };
  rpc: (
    fn: IntegrationConfigRpcName | string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: SupabaseError | null }>;
}

const BITESHIP_HEALTH_KEYS: readonly BiteshipHealthMissingKey[] = [
  "biteship.api_key",
  "biteship.enabled_couriers",
  "biteship.origin_area_id",
  "biteship.origin_postal_code",
  "biteship.origin_latitude",
  "biteship.origin_longitude",
];

const LEGACY_SETTINGS_COLUMNS = [
  "enabled_couriers",
  "origin_area_id",
  "origin_postal_code",
  "origin_latitude",
  "origin_longitude",
].join(", ");

const UNKNOWN_BITESHIP_LEGACY_DRIFT: BiteshipLegacyDrift = {
  enabledCouriers: null,
  originArea: null,
  originPostalCode: null,
  originCoordinates: null,
};

export interface IntegrationConfigHandlerDependencies {
  getAuthClient: () => IntegrationConfigAuthClient;
  getAdminClient: () => IntegrationConfigAdminClient;
  logError?: (message: string, error?: unknown) => void;
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function nullableString(value: unknown): string | null {
  const normalized = normalizeString(value);
  return normalized || null;
}

function getRequestId(req: Request): string | null {
  return nullableString(req.headers.get("x-request-id"));
}

function isIntegrationConfigAction(value: unknown): value is IntegrationConfigAction {
  return value === "summary" || value === "rotateSecret" || value === "updateValue" || value === "audit";
}

async function readRequestBody(req: Request): Promise<IntegrationConfigRequestBody> {
  const body = await req.json();

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {};
  }

  return body;
}

function normalizeKeys(value: unknown): string[] | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (!Array.isArray(value)) {
    throw new HttpError(400, "keys must be an array of non-empty strings");
  }

  const keys = value.map(normalizeString);
  if (keys.some((key) => !key)) {
    throw new HttpError(400, "keys must be an array of non-empty strings");
  }

  return keys;
}

function requireString(value: unknown, fieldName: string): string {
  const normalized = normalizeString(value);

  if (!normalized) {
    throw new HttpError(400, `${fieldName} is required`);
  }

  return normalized;
}

function requireJsonValue(body: IntegrationConfigRequestBody): unknown {
  if (!Object.prototype.hasOwnProperty.call(body, "value") || body.value === undefined || body.value === null) {
    throw new HttpError(400, "value is required");
  }

  return body.value;
}

function normalizeLimit(value: unknown): number {
  if (value === undefined || value === null) {
    return 100;
  }

  if (typeof value !== "number") {
    throw new HttpError(400, "limit must be an integer between 1 and 500");
  }

  const limit = value;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new HttpError(400, "limit must be an integer between 1 and 500");
  }

  return limit;
}

function firstRow(data: unknown): unknown {
  return Array.isArray(data) ? data[0] ?? null : data;
}

function hasRequestedBiteshipKey(keys: string[] | null): boolean {
  return Array.isArray(keys) && keys.some((key) => key.startsWith("biteship."));
}

function normalizeLegacyString(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value).trim();
  }

  return "";
}

function normalizeLegacyCoordinate(value: unknown): number | null {
  const normalized = normalizeLegacyString(value);
  if (!normalized) {
    return null;
  }

  const coordinate = Number(normalized);
  return Number.isFinite(coordinate) ? coordinate : null;
}

function normalizeLegacyCourierSet(value: unknown): Set<string> {
  return new Set(
    normalizeLegacyString(value)
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
}

function normalizeRuntimeCourierSet(values: string[]): Set<string> {
  return new Set(values.map((item) => item.trim().toLowerCase()).filter(Boolean));
}

function setsMatch(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) {
    return false;
  }

  for (const item of left) {
    if (!right.has(item)) {
      return false;
    }
  }

  return true;
}

function coordinatesMatch(
  runtimeLatitude: number | undefined,
  runtimeLongitude: number | undefined,
  legacyLatitude: unknown,
  legacyLongitude: unknown,
): boolean {
  const normalizedLegacyLatitude = normalizeLegacyCoordinate(legacyLatitude);
  const normalizedLegacyLongitude = normalizeLegacyCoordinate(legacyLongitude);

  if (runtimeLatitude === undefined || runtimeLongitude === undefined) {
    return normalizedLegacyLatitude === null && normalizedLegacyLongitude === null;
  }

  return normalizedLegacyLatitude === runtimeLatitude && normalizedLegacyLongitude === runtimeLongitude;
}

function detectMissingBiteshipKeys(settings: BiteshipRuntimeSettings): BiteshipHealthMissingKey[] {
  return BITESHIP_HEALTH_KEYS.filter((key) => {
    if (key === "biteship.api_key") return settings.apiKeySource !== "runtime_config";
    if (key === "biteship.enabled_couriers") return settings.enabledCouriers.length === 0;
    if (key === "biteship.origin_area_id") return !settings.originAreaId;
    if (key === "biteship.origin_postal_code") return !settings.originPostalCode;
    if (key === "biteship.origin_latitude") return settings.originLatitude === undefined;
    return settings.originLongitude === undefined;
  });
}

async function loadLegacySettingsDrift(
  adminClient: IntegrationConfigAdminClient,
  runtimeSettings: BiteshipRuntimeSettings,
): Promise<BiteshipLegacyDrift> {
  try {
    const { data, error } = await adminClient
      .from("settings")
      .select(LEGACY_SETTINGS_COLUMNS)
      .eq("id", 1)
      .maybeSingle();

    if (error || !data) {
      return UNKNOWN_BITESHIP_LEGACY_DRIFT;
    }

    return {
      enabledCouriers: !setsMatch(
        normalizeRuntimeCourierSet(runtimeSettings.enabledCouriers),
        normalizeLegacyCourierSet(data.enabled_couriers),
      ),
      originArea: runtimeSettings.originAreaId !== normalizeLegacyString(data.origin_area_id),
      originPostalCode: runtimeSettings.originPostalCode !== normalizeLegacyString(data.origin_postal_code),
      originCoordinates: !coordinatesMatch(
        runtimeSettings.originLatitude,
        runtimeSettings.originLongitude,
        data.origin_latitude,
        data.origin_longitude,
      ),
    };
  } catch {
    return UNKNOWN_BITESHIP_LEGACY_DRIFT;
  }
}

async function buildBiteshipIntegrationHealth(
  adminClient: IntegrationConfigAdminClient,
): Promise<BiteshipIntegrationHealth> {
  const runtimeSettings = await resolveBiteshipRuntimeSettings(adminClient);
  const missingKeys = detectMissingBiteshipKeys(runtimeSettings);

  return {
    provider: "biteship",
    apiKeyConfigured: runtimeSettings.apiKeyConfigured,
    apiKeySource: runtimeSettings.apiKeySource,
    requiredConfigComplete: missingKeys.length === 0,
    missingKeys,
    legacyDrift: await loadLegacySettingsDrift(adminClient, runtimeSettings),
    diagnostics: runtimeSettings.diagnostics,
  };
}

async function buildSummaryResponseData(
  adminClient: IntegrationConfigAdminClient,
  keys: string[] | null,
  data: unknown,
): Promise<Record<string, unknown>> {
  const responseData: Record<string, unknown> = {
    rows: withoutUnsafeResponseFields(data),
  };

  if (hasRequestedBiteshipKey(keys)) {
    responseData.health = {
      biteship: await buildBiteshipIntegrationHealth(adminClient),
    };
  }

  return responseData;
}

function withoutUnsafeResponseFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(withoutUnsafeResponseFields);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (key === "runtime_value" || key === "secret" || key === "p_secret_value") {
      continue;
    }

    sanitized[key] = withoutUnsafeResponseFields(nestedValue);
  }

  return sanitized;
}

function safeLogError(logError: (message: string, error?: unknown) => void, message: string): void {
  logError(message, { message: "Operation failed" });
}

async function loadProfileRole(
  adminClient: IntegrationConfigAdminClient,
  userId: string,
): Promise<{ role: string | null; lookupFailed: boolean }> {
  const { data, error } = await adminClient.from("profiles").select("role").eq("id", userId).single();

  return {
    role: data?.role ?? null,
    lookupFailed: !!error,
  };
}

async function requireAdminCaller(
  req: Request,
  authClient: IntegrationConfigAuthClient,
  adminClient: IntegrationConfigAdminClient,
): Promise<UserRecord> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new HttpError(401, "Missing or invalid Authorization header");
  }

  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) {
    throw new HttpError(401, "Missing or invalid Authorization header");
  }

  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  const caller = authData.user;

  if (authError || !caller) {
    throw new HttpError(401, "Invalid or expired token");
  }

  const callerProfile = await loadProfileRole(adminClient, caller.id);
  if (callerProfile.lookupFailed || callerProfile.role !== "admin") {
    throw new HttpError(403, "Only admin can manage integration config");
  }

  return caller;
}

export function createIntegrationConfigHandler(dependencies: IntegrationConfigHandlerDependencies) {
  const logError = dependencies.logError ?? (() => undefined);

  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    if (req.method !== "POST") {
      return jsonResponse({ error: "Method Not Allowed" }, 405);
    }

    try {
      const authClient = dependencies.getAuthClient();
      const adminClient = dependencies.getAdminClient();
      const caller = await requireAdminCaller(req, authClient, adminClient);
      const body = await readRequestBody(req);

      if (!isIntegrationConfigAction(body.action)) {
        throw new HttpError(400, "Unsupported integration config action");
      }

      if (body.action === "summary") {
        const keys = normalizeKeys(body.keys);
        const { data, error } = await adminClient.rpc("list_integration_config_summary", {
          p_key_names: keys,
        });

        if (error) {
          safeLogError(logError, "[integration-config] summary RPC failed");
          throw new HttpError(500, "Integration config operation failed");
        }

        return jsonResponse({ data: await buildSummaryResponseData(adminClient, keys, data) });
      }

      if (body.action === "rotateSecret") {
        const key = requireString(body.key, "key");
        const secret = requireString(body.secret, "secret");
        const reason = requireString(body.reason, "reason");
        const { data, error } = await adminClient.rpc("rotate_integration_config_secret", {
          p_key_name: key,
          p_secret_value: secret,
          p_actor_id: caller.id,
          p_reason: reason,
          p_source: ADMIN_SOURCE,
          p_request_id: getRequestId(req),
        });

        if (error) {
          safeLogError(logError, "[integration-config] rotateSecret RPC failed");
          throw new HttpError(500, "Integration config operation failed");
        }

        return jsonResponse({ data: withoutUnsafeResponseFields(firstRow(data)) });
      }

      if (body.action === "updateValue") {
        const key = requireString(body.key, "key");
        const value = requireJsonValue(body);
        const reason = requireString(body.reason, "reason");
        const { data, error } = await adminClient.rpc("update_integration_config_value", {
          p_key_name: key,
          p_value: value,
          p_actor_id: caller.id,
          p_reason: reason,
          p_source: ADMIN_SOURCE,
          p_request_id: getRequestId(req),
        });

        if (error) {
          safeLogError(logError, "[integration-config] updateValue RPC failed");
          throw new HttpError(500, "Integration config operation failed");
        }

        return jsonResponse({ data: withoutUnsafeResponseFields(firstRow(data)) });
      }

      const { data, error } = await adminClient.rpc("list_integration_config_audit", {
        p_key_name: nullableString(body.key),
        p_limit: normalizeLimit(body.limit),
      });

      if (error) {
        safeLogError(logError, "[integration-config] audit RPC failed");
        throw new HttpError(500, "Integration config operation failed");
      }

      return jsonResponse({ data: withoutUnsafeResponseFields(data) });
    } catch (error) {
      if (error instanceof HttpError) {
        return jsonResponse({ error: error.message }, error.status);
      }

      safeLogError(logError, "[integration-config] Internal error");
      return jsonResponse({ error: "Internal server error" }, 500);
    }
  };
}
