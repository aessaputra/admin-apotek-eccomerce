import { supabaseClient } from "../../providers/supabase-client";
import { getFunctionsErrorMessage } from "../../utils/functions-error";

export const RUNTIME_CONFIG_KEYS = [
  "midtrans.server_key",
  "midtrans.is_production",
  "biteship.api_key",
  "biteship.origin_postal_code",
  "biteship.origin_area_id",
  "biteship.origin_latitude",
  "biteship.origin_longitude",
  "biteship.enabled_couriers",
  "shop.shipper_name",
  "shop.shipper_phone",
  "shop.shipper_email",
  "shop.address",
  "shop.organization",
  "push.expo_access_token",
  "cors.allowed_origins",
] as const;

export type RuntimeConfigKey = (typeof RUNTIME_CONFIG_KEYS)[number];

export type IntegrationConfigValueKind = "secret" | "boolean" | "string" | "number" | "json" | "string_array" | "text_array";

export interface IntegrationConfigSummaryRow {
  key_name: RuntimeConfigKey;
  display_name: string | null;
  description: string | null;
  value_kind: IntegrationConfigValueKind;
  is_secret: boolean;
  is_required: boolean;
  is_runtime_required: boolean;
  version_id: string | null;
  version_number: number | null;
  status: string | null;
  masked_value: string | null;
  value_fingerprint: string | null;
  non_secret_value: unknown;
  updated_by: string | null;
  updated_at: string | null;
}

export type BiteshipApiKeySource = "runtime_config" | "missing";

export type BiteshipHealthMissingKey =
  | "biteship.api_key"
  | "biteship.enabled_couriers"
  | "biteship.origin_area_id"
  | "biteship.origin_postal_code"
  | "biteship.origin_latitude"
  | "biteship.origin_longitude";

export interface BiteshipIntegrationHealth {
  provider: "biteship";
  apiKeyConfigured: boolean;
  apiKeySource: BiteshipApiKeySource;
  requiredConfigComplete: boolean;
  missingKeys: BiteshipHealthMissingKey[];
  legacyDrift: {
    enabledCouriers: boolean | null;
    originArea: boolean | null;
    originPostalCode: boolean | null;
    originCoordinates: boolean | null;
  };
  diagnostics: string[];
}

export interface IntegrationConfigSummaryResult {
  rows: IntegrationConfigSummaryRow[];
  health?: {
    biteship?: BiteshipIntegrationHealth;
  };
}

export interface IntegrationConfigRotateResult {
  key_name: RuntimeConfigKey;
  version_id: string;
  version_number: number;
  masked_value: string | null;
  value_fingerprint: string | null;
  updated_at: string | null;
}

export interface IntegrationConfigUpdateResult {
  key_name: RuntimeConfigKey;
  version_id: string;
  version_number: number;
  updated_value: unknown;
  updated_at: string | null;
}

export interface IntegrationConfigAuditRow {
  id: string;
  key_name: RuntimeConfigKey | string;
  version_id: string | null;
  action: string;
  actor_id: string | null;
  actor_role: string | null;
  source: string | null;
  request_id: string | null;
  reason: string | null;
  old_version_number: number | null;
  new_version_number: number | null;
  old_masked_value: string | null;
  new_masked_value: string | null;
  value_fingerprint: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export type IntegrationConfigRequest =
  | { action: "summary"; keys?: RuntimeConfigKey[] }
  | { action: "rotateSecret"; key: RuntimeConfigKey; secret: string; reason: string }
  | { action: "updateValue"; key: RuntimeConfigKey; value: unknown; reason: string }
  | { action: "audit"; key?: RuntimeConfigKey; limit?: number };

interface GatewayResponse<T> {
  data?: T;
  error?: string;
}

function createBrowserRequestId(): string {
  if (typeof crypto?.randomUUID === "function") {
    return crypto.randomUUID();
  }

  const randomValues = new Uint8Array(16);
  if (typeof crypto?.getRandomValues === "function") {
    crypto.getRandomValues(randomValues);
    return `req-${Array.from(randomValues, (value) => value.toString(16).padStart(2, "0")).join("")}`;
  }

  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function shouldSendRequestId(body: IntegrationConfigRequest): boolean {
  return body.action === "rotateSecret" || body.action === "updateValue";
}

export async function invokeIntegrationConfig<T>(body: IntegrationConfigRequest): Promise<T> {
  const { data, error } = await supabaseClient.functions.invoke<GatewayResponse<T>>("integration-config", {
    body,
    ...(shouldSendRequestId(body) ? { headers: { "x-request-id": createBrowserRequestId() } } : {}),
  });

  if (error) {
    throw new Error(await getFunctionsErrorMessage(error, "Integration config request failed"));
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  return data?.data as T;
}

function normalizeSummaryResult(
  result: IntegrationConfigSummaryResult | IntegrationConfigSummaryRow[]
): IntegrationConfigSummaryResult {
  if (Array.isArray(result)) {
    return { rows: result };
  }

  return result;
}

export const integrationConfigClient = {
  summary: (keys?: RuntimeConfigKey[]) =>
    invokeIntegrationConfig<IntegrationConfigSummaryResult | IntegrationConfigSummaryRow[]>({ action: "summary", keys })
      .then(normalizeSummaryResult),
  rotateSecret: (key: RuntimeConfigKey, secret: string, reason: string) =>
    invokeIntegrationConfig<IntegrationConfigRotateResult>({ action: "rotateSecret", key, secret, reason }),
  updateValue: (key: RuntimeConfigKey, value: unknown, reason: string) =>
    invokeIntegrationConfig<IntegrationConfigUpdateResult>({ action: "updateValue", key, value, reason }),
  audit: (key?: RuntimeConfigKey, limit = 50) =>
    invokeIntegrationConfig<IntegrationConfigAuditRow[]>({ action: "audit", key, limit }),
};
