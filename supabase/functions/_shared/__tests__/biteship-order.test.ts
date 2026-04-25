import { describe, expect, it, vi } from "vitest";

import {
  buildBiteshipOrderDestinationFields,
  fetchOrderShippingAddress,
} from "../biteship-order-helpers.ts";
import {
  buildBiteshipOrderPayload,
  persistBiteshipShipment,
  type StoreSettings,
} from "../biteship.ts";
import type { Order, OrderAddress } from "../types.ts";

vi.mock("../supabase.ts", () => ({
  getSupabaseAdminClient: vi.fn(),
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
