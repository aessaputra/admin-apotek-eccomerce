import { describe, expect, it } from "vitest";

import {
  buildBiteshipOrderDestinationFields,
  fetchOrderShippingAddress,
} from "../biteship-order-helpers.ts";
import type { Order, OrderAddress } from "../types.ts";

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
    phone_number: "0811111111",
    street_address: "Jl. Pembeli No. 2",
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

describe("fetchOrderShippingAddress", () => {
  it("fetches address data explicitly through shipping_address_id", async () => {
    const address: OrderAddress = {
      id: "address-1",
      phone_number: "0811111111",
      street_address: "Jl. Pembeli No. 2",
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
        "id, phone_number, street_address, latitude, longitude",
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
      buildBiteshipOrderDestinationFields(
        {
          ...baseOrder,
          courier_code: "grab",
          courier_service: "instant",
          addresses: {
            ...baseOrder.addresses!,
            latitude: null,
            longitude: null,
          },
        },
      ),
    ).toThrow(
      "Destination coordinate is required for instant courier grab:instant on order order-1",
    );
  });

  it("allows regular courier payloads without destination coordinate", () => {
    const payload = buildBiteshipOrderDestinationFields(
      {
        ...baseOrder,
        addresses: {
          ...baseOrder.addresses!,
          latitude: null,
          longitude: null,
        },
      },
    );

    expect(payload.destination_area_id).toBe("DEST-AREA-ID");
    expect(payload).not.toHaveProperty("destination_coordinate");
  });

  it("includes destination_coordinate for instant courier payloads when address has coordinates", () => {
    const payload = buildBiteshipOrderDestinationFields(
      {
        ...baseOrder,
        courier_code: "grab",
        courier_service: "instant",
      },
    );

    expect(payload.destination_coordinate).toEqual({
      latitude: -6.2088,
      longitude: 106.8456,
    });
  });
});
