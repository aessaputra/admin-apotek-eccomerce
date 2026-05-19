import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildBiteshipOrderDestinationFields,
  fetchOrderShippingAddress,
} from "../biteship-order-helpers.ts";
import {
  buildBiteshipOrderPayloadFromSnapshot,
  buildBiteshipOrderPayload,
  createBiteshipOrder,
  ensureBiteshipOrderConfigSnapshot,
  persistBiteshipShipment,
  resolveBiteshipApiKeyFromRuntimeConfig,
  type BiteshipOrderConfigSnapshot,
  type StoreSettings,
} from "../biteship.ts";
import { CONFIG_KEYS, type RuntimeConfigRow } from "../runtime-config.ts";
import type { Order, OrderAddress } from "../types.ts";

const getSupabaseAdminClientMock = vi.hoisted(() => vi.fn());

vi.mock("../supabase.ts", () => ({
  getSupabaseAdminClient: getSupabaseAdminClientMock,
}));

const baseOrder: Order = {
  id: "order-1",
  status: "paid",
  payment_status: "settlement",
  total_amount: 25000,
  shipping_address_id: "address-1",
  destination_area_id: "DEST-AREA-ID",
  destination_postal_code: 12345,
  courier_code: "jne",
  courier_service: "reg",
  profiles: {
    full_name: "Jane Doe",
  },
  addresses: {
    id: "address-1",
    receiver_name: "Penerima Utama",
    phone_number: "0811111111",
    street_address: "Jl. Pembeli No. 2",
    address_note: "Blok A2 dekat pos satpam",
    city: "Jakarta Selatan",
    province: "DKI Jakarta",
    postal_code: "12345",
    country_code: "ID",
    area_id: "DEST-AREA-ID",
    latitude: -6.2088,
    longitude: 106.8456,
  },
  order_items: [
    {
      product_id: "product-1",
      quantity: 1,
      price_at_purchase: 25000,
      products: {
        name: "Vitamin C",
        description: "Botol 100 tablet",
        weight: 100,
      },
    },
  ],
};

const baseSettings: StoreSettings = {
  store_name: "Apotek Sehat",
  phone_number: "0812222222",
  email: "ops@example.com",
  organization: "Apotek Sehat",
  store_address: "Jl. Toko No. 1",
  enabled_couriers: "jne:reg,grab:instant,gojek",
  origin_postal_code: "12345",
  origin_latitude: -6.145632,
  origin_longitude: 106.226614,
  origin_area_id: "STORE-AREA-ID",
};

const baseSnapshot: BiteshipOrderConfigSnapshot = {
  id: "snapshot-1",
  order_id: "order-1",
  shipment_id: null,
  provider: "biteship",
  origin_area_id: "SNAPSHOT-AREA-ID",
  origin_postal_code: "54321",
  origin_latitude: -6.311111,
  origin_longitude: 106.911111,
  courier_codes: ["jne"],
  courier_service: "reg",
  shipper_name: "Snapshot Sender",
  shipper_phone: "0899999999",
  shipper_email: "snapshot@example.com",
  shipper_address: "Jl. Snapshot No. 9",
  shipper_organization: "Snapshot Pharmacy",
  config_version_ids: {
    "biteship.origin_postal_code": {
      version_id: "version-origin-postal",
      version_number: 4,
    },
    "biteship.origin_area_id": {
      version_id: "version-origin-area",
      version_number: 5,
    },
    "biteship.origin_latitude": {
      version_id: "version-origin-latitude",
      version_number: 6,
    },
    "biteship.origin_longitude": {
      version_id: "version-origin-longitude",
      version_number: 7,
    },
    "biteship.enabled_couriers": {
      version_id: "version-enabled-couriers",
      version_number: 2,
    },
    "shop.shipper_name": {
      version_id: "version-shipper-name",
      version_number: 3,
    },
    "shop.shipper_phone": {
      version_id: "version-shipper-phone",
      version_number: 3,
    },
    "shop.shipper_email": {
      version_id: "version-shipper-email",
      version_number: 3,
    },
    "shop.address": {
      version_id: "version-shop-address",
      version_number: 3,
    },
    "shop.organization": {
      version_id: "version-shop-organization",
      version_number: 3,
    },
  },
  snapshot_source: "webhook_side_effects",
  created_by: null,
  created_at: "2026-05-18T00:00:00.000Z",
};

function createRuntimeConfigRow(
  keyName: string,
  runtimeValue: string | string[],
  versionNumber: number,
  valueKind: RuntimeConfigRow["value_kind"] = Array.isArray(runtimeValue) ? "text_array" : "text",
): RuntimeConfigRow {
  return {
    key_name: keyName,
    value_kind: valueKind,
    is_secret: false,
    is_required: true,
    is_runtime_required: true,
    version_id: `version-${keyName.replaceAll(".", "-")}`,
    version_number: versionNumber,
    status: "active",
    runtime_value: runtimeValue,
    masked_value: null,
    value_fingerprint: null,
    updated_at: "2026-05-18T00:00:00.000Z",
  };
}

function createSettingsQueryMock(settings: StoreSettings) {
  const maybeSingle = vi.fn(async () => ({ data: settings, error: null }));
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  return { from: vi.fn(() => ({ select })) };
}

describe("fetchOrderShippingAddress", () => {
  it("fetches address data explicitly through shipping_address_id", async () => {
    const address: OrderAddress = {
      id: "address-1",
      receiver_name: "Penerima Utama",
      phone_number: "0811111111",
      street_address: "Jl. Pembeli No. 2",
      address_note: "Blok A2 dekat pos satpam",
      city: "Jakarta Selatan",
      province: "DKI Jakarta",
      postal_code: "12345",
      country_code: "ID",
      area_id: "DEST-AREA-ID",
      latitude: -6.2088,
      longitude: 106.8456,
    };

    const maybeSingle = async () => ({ data: address, error: null });
    const eq = (column: string, value: string) => {
      expect(column).toBe("id");
      expect(value).toBe("address-1");
      return { maybeSingle };
    };
    const select = (columns: string) => {
      expect(columns).toBe(
        "id, receiver_name, phone_number, street_address, address_note, city, province, postal_code, country_code, area_id, latitude, longitude",
      );
      return { eq };
    };
    const from = (table: string) => {
      expect(table).toBe("addresses");
      return { select };
    };

    const adminClient = { from };

    await expect(
      fetchOrderShippingAddress(adminClient, {
        id: "order-1",
        shipping_address_id: "address-1",
      }),
    ).resolves.toEqual(address);
  });
});

describe("buildBiteshipOrderPayload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses immutable snapshot origin and shipper fields instead of rotated live settings", () => {
    const payload = buildBiteshipOrderPayloadFromSnapshot(baseOrder, baseSnapshot);

    expect(payload.origin_area_id).toBe("SNAPSHOT-AREA-ID");
    expect(payload.shipper_contact_name).toBe("Snapshot Sender");
    expect(payload.shipper_contact_phone).toBe("0899999999");
    expect(payload.shipper_contact_email).toBe("snapshot@example.com");
    expect(payload.shipper_organization).toBe("Snapshot Pharmacy");
    expect(payload.origin_address).toBe("Jl. Snapshot No. 9");
    expect(payload.courier_company).toBe("jne");
    expect(payload.courier_type).toBe("reg");
    expect(JSON.stringify(payload)).not.toContain("ROTATED");
  });

  it("fails retryably when a snapshot is partial before building a Biteship payload", () => {
    expect(() =>
      buildBiteshipOrderPayloadFromSnapshot(baseOrder, {
        ...baseSnapshot,
        origin_latitude: null,
      }),
    ).toThrow("Biteship config snapshot for order order-1 is incomplete: origin_latitude is required");
  });

  it.each([
    ["empty metadata object", {}],
    ["missing version_number", { version_id: "version-origin-area" }],
    ["empty version_id", { version_id: " ", version_number: 5 }],
    ["non-positive version_number", { version_id: "version-origin-area", version_number: 0 }],
  ])(
    "fails retryably when snapshot version metadata has %s",
    (_caseName, metadata) => {
      expect(() =>
        buildBiteshipOrderPayloadFromSnapshot(baseOrder, {
          ...baseSnapshot,
          config_version_ids: {
            ...baseSnapshot.config_version_ids,
            [CONFIG_KEYS.biteshipOriginAreaId]: metadata,
          },
        }),
      ).toThrow(
        `Biteship config snapshot for order order-1 is incomplete: config_version_ids.${CONFIG_KEYS.biteshipOriginAreaId} must include a non-empty version_id and positive integer version_number`,
      );
    },
  );

  it("creates snapshots from versioned runtime origin metadata instead of rotated live settings", async () => {
    const originAreaKey = "biteship.origin_area_id";
    const originLatitudeKey = "biteship.origin_latitude";
    const originLongitudeKey = "biteship.origin_longitude";
    const runtimeRows = [
      createRuntimeConfigRow(CONFIG_KEYS.biteshipOriginPostalCode, "11111", 4),
      createRuntimeConfigRow(originAreaKey, "CONFIG-AREA-ID", 5),
      createRuntimeConfigRow(originLatitudeKey, "-6.311111", 6),
      createRuntimeConfigRow(originLongitudeKey, "106.911111", 7),
      createRuntimeConfigRow(CONFIG_KEYS.biteshipEnabledCouriers, ["jne:reg"], 8),
      createRuntimeConfigRow(CONFIG_KEYS.shopShipperName, "Runtime Sender", 9),
      createRuntimeConfigRow(CONFIG_KEYS.shopShipperPhone, "0813333333", 10),
      createRuntimeConfigRow(CONFIG_KEYS.shopShipperEmail, "runtime@example.com", 11),
      createRuntimeConfigRow(CONFIG_KEYS.shopAddress, "Jl. Runtime No. 10", 12),
      createRuntimeConfigRow(CONFIG_KEYS.shopOrganization, "Runtime Pharmacy", 13),
    ];
    const rowsByKey = new Map(runtimeRows.map((row) => [row.key_name, row]));
    const createSnapshotArgs: Record<string, unknown>[] = [];
    const adminClient = {
      rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
        if (name === "get_biteship_order_config_snapshot") {
          return { data: [], error: null };
        }

        if (name === "get_runtime_integration_config_versions") {
          const keyName = ((args.p_key_names as string[]) ?? [])[0];
          const row = rowsByKey.get(keyName);
          return { data: row ? [row] : [], error: null };
        }

        expect(name).toBe("create_biteship_order_config_snapshot");
        createSnapshotArgs.push(args);
        return {
          data: [{
            id: "snapshot-created",
            order_id: args.p_order_id,
            shipment_id: args.p_shipment_id,
            provider: "biteship",
            origin_area_id: args.p_origin_area_id,
            origin_postal_code: args.p_origin_postal_code,
            origin_latitude: args.p_origin_latitude,
            origin_longitude: args.p_origin_longitude,
            courier_codes: args.p_courier_codes,
            courier_service: args.p_courier_service,
            shipper_name: args.p_shipper_name,
            shipper_phone: args.p_shipper_phone,
            shipper_email: args.p_shipper_email,
            shipper_address: args.p_shipper_address,
            shipper_organization: args.p_shipper_organization,
            config_version_ids: args.p_config_version_ids,
            snapshot_source: args.p_snapshot_source,
            created_by: args.p_created_by,
            created_at: "2026-05-18T00:00:00.000Z",
          }],
          error: null,
        };
      }),
    };
    getSupabaseAdminClientMock.mockResolvedValue(
      createSettingsQueryMock({
        ...baseSettings,
        origin_area_id: "ROTATED-LIVE-AREA-ID",
        origin_latitude: -1.234567,
        origin_longitude: 101.765432,
      }),
    );

    const snapshot = await ensureBiteshipOrderConfigSnapshot(adminClient, baseOrder);

    expect(snapshot).toMatchObject({
      origin_area_id: "CONFIG-AREA-ID",
      origin_postal_code: "11111",
      origin_latitude: -6.311111,
      origin_longitude: 106.911111,
      shipper_name: "Runtime Sender",
    });
    expect(createSnapshotArgs[0]).toMatchObject({
      p_origin_area_id: "CONFIG-AREA-ID",
      p_origin_latitude: -6.311111,
      p_origin_longitude: 106.911111,
    });
    expect(createSnapshotArgs[0].p_config_version_ids).toMatchObject({
      [originAreaKey]: expect.objectContaining({ version_number: 5 }),
      [originLatitudeKey]: expect.objectContaining({ version_number: 6 }),
      [originLongitudeKey]: expect.objectContaining({ version_number: 7 }),
      [CONFIG_KEYS.biteshipOriginPostalCode]: expect.objectContaining({ version_number: 4 }),
      [CONFIG_KEYS.biteshipEnabledCouriers]: expect.objectContaining({ version_number: 8 }),
    });
    expect(JSON.stringify(createSnapshotArgs[0])).not.toContain("ROTATED-LIVE");
  });

  it("fails with a clear error when instant courier orders have no destination coordinate", () => {
    expect(() =>
      buildBiteshipOrderDestinationFields({
        ...baseOrder,
        courier_code: "grab",
        courier_service: "instant",
        addresses: {
          ...baseOrder.addresses!,
          latitude: null,
          longitude: null,
        },
      }),
    ).toThrow(
      "Destination coordinate is required for instant courier grab:instant on order order-1",
    );
  });

  it("allows regular courier payloads without destination coordinate", () => {
    const payload = buildBiteshipOrderDestinationFields({
      ...baseOrder,
      addresses: {
        ...baseOrder.addresses!,
        latitude: null,
        longitude: null,
      },
    });

    expect(payload.destination_area_id).toBe("DEST-AREA-ID");
    expect(payload.destination_note).toBe("Blok A2 dekat pos satpam");
    expect(payload).not.toHaveProperty("destination_coordinate");
  });

  it("omits destination_note when address_note is blank", () => {
    const payload = buildBiteshipOrderDestinationFields({
      ...baseOrder,
      addresses: {
        ...baseOrder.addresses!,
        address_note: "   ",
      },
    });

    expect(payload).not.toHaveProperty("destination_note");
  });

  it("includes destination_coordinate for instant courier payloads when address has coordinates", () => {
    const payload = buildBiteshipOrderDestinationFields({
      ...baseOrder,
      courier_code: "grab",
      courier_service: "instant",
    });

    expect(payload.destination_coordinate).toEqual({
      latitude: -6.2088,
      longitude: 106.8456,
    });
    expect(payload).not.toHaveProperty("destination_area_id");
    expect(payload).not.toHaveProperty("destination_postal_code");
  });

  it("builds coordinate-only location fields for instant-capable courier companies", () => {
    const payload = buildBiteshipOrderPayload(
      {
        ...baseOrder,
        courier_code: "gojek",
        courier_service: "regular",
      },
      baseSettings,
    );

    expect(payload.origin_coordinate).toEqual({
      latitude: -6.145632,
      longitude: 106.226614,
    });
    expect(payload.destination_coordinate).toEqual({
      latitude: -6.2088,
      longitude: 106.8456,
    });
    expect(payload).not.toHaveProperty("origin_area_id");
    expect(payload).not.toHaveProperty("origin_postal_code");
    expect(payload).not.toHaveProperty("destination_area_id");
    expect(payload).not.toHaveProperty("destination_postal_code");
  });

  it("fails before Biteship call when instant origin coordinates are missing", () => {
    expect(() =>
      buildBiteshipOrderPayload(
        {
          ...baseOrder,
          courier_code: "grab",
          courier_service: "instant",
        },
        {
          ...baseSettings,
          origin_latitude: null,
          origin_longitude: null,
        },
      ),
    ).toThrow(
      "Origin coordinate is required for instant Biteship orders. Configure origin_latitude and origin_longitude in settings table before creating instant courier orders.",
    );
  });

  it("builds standard payloads with origin and destination area ids when present", () => {
    const payload = buildBiteshipOrderPayload(baseOrder, baseSettings);

    expect(payload.origin_area_id).toBe("STORE-AREA-ID");
    expect(payload.destination_area_id).toBe("DEST-AREA-ID");
    expect(payload).not.toHaveProperty("origin_coordinate");
    expect(payload).not.toHaveProperty("destination_coordinate");
    expect(payload).not.toHaveProperty("origin_postal_code");
    expect(payload).not.toHaveProperty("destination_postal_code");
  });

  it("uses strict postal fallback for standard payloads only when area ids are absent", () => {
    const payload = buildBiteshipOrderPayload(
      {
        ...baseOrder,
        destination_area_id: null,
        destination_postal_code: 54321,
      },
      {
        ...baseSettings,
        origin_area_id: null,
        origin_postal_code: "12345",
      },
    );

    expect(payload.origin_postal_code).toBe(12345);
    expect(payload.destination_postal_code).toBe(54321);
    expect(payload).not.toHaveProperty("origin_area_id");
    expect(payload).not.toHaveProperty("destination_area_id");
    expect(payload).not.toHaveProperty("origin_coordinate");
    expect(payload).not.toHaveProperty("destination_coordinate");
  });

  it("uses strict destination postal parsing when area id is unavailable", () => {
    const payload = buildBiteshipOrderDestinationFields({
      ...baseOrder,
      destination_area_id: null,
      destination_postal_code: 12345,
    });

    expect(payload.destination_postal_code).toBe(12345);
  });

  it("rejects invalid destination postal values when building fallback payloads", () => {
    expect(() =>
      buildBiteshipOrderDestinationFields({
        ...baseOrder,
        destination_area_id: null,
        destination_postal_code: 0,
      }),
    ).toThrow("destination_postal_code must be a valid 5-digit Indonesian postal code.");
  });

  it("prefers receiver_name from shipping address for destination contact name", () => {
    const payload = buildBiteshipOrderDestinationFields(baseOrder);

    expect(payload.destination_contact_name).toBe("Penerima Utama");
  });

  it("falls back to profile full_name when receiver_name is missing", () => {
    const payload = buildBiteshipOrderDestinationFields({
      ...baseOrder,
      addresses: {
        ...baseOrder.addresses!,
        receiver_name: null,
      },
    });

    expect(payload.destination_contact_name).toBe("Jane Doe");
  });

  it("falls back to profile full_name when receiver_name is blank", () => {
    const payload = buildBiteshipOrderDestinationFields({
      ...baseOrder,
      addresses: {
        ...baseOrder.addresses!,
        receiver_name: "   ",
      },
    });

    expect(payload.destination_contact_name).toBe("Jane Doe");
  });
});

describe("persistBiteshipShipment", () => {
  it("persists origin_area_id when provided for standard shipments", async () => {
    const upsert = vi.fn(async (payload: Record<string, unknown>) => {
      expect(payload.origin_area_id).toBe("STORE-AREA-ID");
      return { error: null };
    });
    const insert = vi.fn(async () => ({ error: null }));
    const from = vi.fn((table: string) => {
      if (table === "shipments") {
        return { upsert };
      }

      expect(table).toBe("order_activities");
      return { insert };
    });
    const adminClient = { from } as Parameters<typeof persistBiteshipShipment>[0];

    await persistBiteshipShipment(adminClient, {
      orderId: "order-1",
      biteshipOrderId: "biteship-1",
      trackingId: "tracking-1",
      waybillNumber: "waybill-1",
      actorType: "system",
      originAreaId: " STORE-AREA-ID ",
      metadata: { source: "test" },
    });

    expect(upsert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledTimes(1);
  });
});

describe("Biteship runtime API key", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("loads the Biteship API key through runtime config without using env fallback", async () => {
    const apiKeySentinel = "runtime-biteship-key-sentinel";
    const adminClient = {
      rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
        expect(name).toBe("get_runtime_integration_config_versions");
        expect(args).toEqual({
          p_key_names: [CONFIG_KEYS.biteshipApiKey],
          p_version_numbers: {},
          p_include_grace: false,
        });
        return {
          data: [createRuntimeConfigRow(
            CONFIG_KEYS.biteshipApiKey,
            apiKeySentinel,
            3,
            "secret",
          )],
          error: null,
        };
      }),
    };
    const env = { get: vi.fn(() => "env-biteship-key-must-not-be-used") };

    const apiKey = await resolveBiteshipApiKeyFromRuntimeConfig(adminClient, env);

    expect(apiKey).toBe(apiKeySentinel);
    expect(env.get).not.toHaveBeenCalled();
  });

  it("fails closed with a safe error when the runtime Biteship API key is missing", async () => {
    const adminClient = {
      rpc: vi.fn(async () => ({ data: [], error: null })),
    };
    const env = { get: vi.fn(() => "env-biteship-key-must-not-be-used") };

    await expect(
      resolveBiteshipApiKeyFromRuntimeConfig(adminClient, env),
    ).rejects.toThrow("Biteship runtime config unavailable");
    expect(env.get).not.toHaveBeenCalled();
  });

  it("authorizes order creation with the runtime API key without storing it in the snapshot payload", async () => {
    const apiKeySentinel = "runtime-biteship-key-sentinel";
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        Authorization: `biteship_test.${apiKeySentinel}`,
      });
      expect(String(init?.body)).not.toContain(apiKeySentinel);
      expect(String(init?.body)).toContain("Snapshot Sender");
      expect(String(init?.body)).not.toContain("api_key");
      return new Response(JSON.stringify({
        success: true,
        id: "biteship-order-1",
        status: "confirmed",
        courier: {
          tracking_id: "tracking-1",
          waybill_id: "waybill-1",
          company: "jne",
          type: "reg",
        },
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createBiteshipOrder(baseOrder, apiKeySentinel, baseSnapshot),
    ).resolves.toMatchObject({ id: "biteship-order-1" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
