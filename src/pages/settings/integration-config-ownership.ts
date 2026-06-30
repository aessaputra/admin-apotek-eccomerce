import { RUNTIME_CONFIG_KEYS, type RuntimeConfigKey } from "./integration-config-client";

export type IntegrationConfigOwner = "payment" | "shipping" | "technical";

export const INTEGRATION_CONFIG_OWNERSHIP = {
  payment: ["midtrans.server_key", "midtrans.is_production"],
  shipping: [
    "biteship.api_key",
    "biteship.webhook_secret",
    "biteship.enabled_couriers",
    "biteship.origin_postal_code",
    "biteship.origin_area_id",
    "biteship.origin_latitude",
    "biteship.origin_longitude",
    "shop.shipper_name",
    "shop.shipper_phone",
    "shop.shipper_email",
    "shop.address",
    "shop.organization",
  ],
  technical: ["push.expo_access_token", "cors.allowed_origins"],
} as const satisfies Record<IntegrationConfigOwner, readonly RuntimeConfigKey[]>;

export const SECRET_RUNTIME_CONFIG_KEYS = [
  "midtrans.server_key",
  "biteship.api_key",
  "biteship.webhook_secret",
  "push.expo_access_token",
] as const satisfies readonly RuntimeConfigKey[];

const ownerByKey = new Map<RuntimeConfigKey, IntegrationConfigOwner>(
  Object.entries(INTEGRATION_CONFIG_OWNERSHIP).flatMap(([owner, keys]) =>
    keys.map((key) => [key, owner as IntegrationConfigOwner] as const)
  )
);

const ownedKeys = Object.values(INTEGRATION_CONFIG_OWNERSHIP).flat();

if (new Set(ownedKeys).size !== ownedKeys.length) {
  throw new Error("Integration config keys must have only one primary Settings owner.");
}

if (ownedKeys.length !== RUNTIME_CONFIG_KEYS.length) {
  throw new Error("Integration config ownership must cover every runtime config key.");
}

export function getPrimaryOwnerForIntegrationConfigKey(key: RuntimeConfigKey): IntegrationConfigOwner {
  const owner = ownerByKey.get(key);

  if (!owner) {
    throw new Error(`Integration config key ${key} does not have a primary Settings owner.`);
  }

  return owner;
}

export function isSecretRuntimeConfigKey(key: RuntimeConfigKey): boolean {
  return SECRET_RUNTIME_CONFIG_KEYS.includes(key as (typeof SECRET_RUNTIME_CONFIG_KEYS)[number]);
}
