import { describe, expect, it } from "vitest";

import { buildSnapPayload, calculateMidtransGrossAmount } from "../midtrans.ts";
import type { AuthUser, Order } from "../types.ts";

const authUser: AuthUser = {
  id: "user-1",
  email: "customer@example.com",
};

const baseOrder: Order = {
  id: "order-1",
  user_id: "user-1",
  status: "pending",
  payment_status: "pending",
  total_amount: 65000,
  shipping_cost: 15000,
  midtrans_order_id: "MID-ORDER-1",
  profiles: {
    id: "profile-1",
    full_name: "Jane Customer",
    phone_number: "08129999999",
  },
  addresses: {
    id: "address-1",
    receiver_name: "Budi Penerima",
    phone_number: "08121111111",
    street_address: "Jl. Mawar No. 10",
    address_note: "Blok B lantai 2",
    city: "Jakarta Selatan",
    province: "DKI Jakarta",
    postal_code: "12345",
    country_code: "ID",
  },
  order_items: [
    {
      product_id: "product-1",
      quantity: 2,
      price_at_purchase: 25000,
      products: {
        name: "Vitamin C",
        categories: { name: "Healthcare" },
      },
    },
  ],
};

describe("calculateMidtransGrossAmount", () => {
  it("adds line item totals and shipping cost", () => {
    expect(calculateMidtransGrossAmount(baseOrder)).toBe(65000);
  });
});

describe("buildSnapPayload", () => {
  it("includes shipping and billing address mapped from shipping address", () => {
    const payload = buildSnapPayload(baseOrder, authUser);

    expect(payload.customer_details).toMatchObject({
      first_name: "Jane",
      last_name: "Customer",
      email: "customer@example.com",
      phone: "08129999999",
      shipping_address: {
        first_name: "Budi",
        last_name: "Penerima",
        email: "customer@example.com",
        phone: "08121111111",
        address: "Jl. Mawar No. 10",
        city: "Jakarta Selatan",
        postal_code: "12345",
        country_code: "IDN",
      },
      billing_address: {
        first_name: "Budi",
        last_name: "Penerima",
        email: "customer@example.com",
        phone: "08121111111",
        address: "Jl. Mawar No. 10",
        city: "Jakarta Selatan",
        postal_code: "12345",
        country_code: "IDN",
      },
    });
  });

  it("does not merge optional address_note into Midtrans address lines", () => {
    const payload = buildSnapPayload(baseOrder, authUser);

    expect(payload.customer_details.shipping_address?.address).toBe(
      "Jl. Mawar No. 10",
    );
    expect(payload.customer_details.billing_address?.address).toBe(
      "Jl. Mawar No. 10",
    );
  });

  it("omits address blocks when shipping address is unavailable", () => {
    const payload = buildSnapPayload(
      {
        ...baseOrder,
        addresses: null,
      },
      authUser,
    );

    expect(payload.customer_details.shipping_address).toBeUndefined();
    expect(payload.customer_details.billing_address).toBeUndefined();
  });

  it("falls back to profile name for address person name when receiver_name is missing", () => {
    const payload = buildSnapPayload(
      {
        ...baseOrder,
        addresses: {
          ...baseOrder.addresses!,
          receiver_name: null,
        },
      },
      authUser,
    );

    expect(payload.customer_details.shipping_address).toMatchObject({
      first_name: "Jane",
      last_name: "Customer",
    });
  });

  it("falls back to profile name for address person name when receiver_name is blank", () => {
    const payload = buildSnapPayload(
      {
        ...baseOrder,
        addresses: {
          ...baseOrder.addresses!,
          receiver_name: "   ",
        },
      },
      authUser,
    );

    expect(payload.customer_details.shipping_address).toMatchObject({
      first_name: "Jane",
      last_name: "Customer",
    });
  });
});
