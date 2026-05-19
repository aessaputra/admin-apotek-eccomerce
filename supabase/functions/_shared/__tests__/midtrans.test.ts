import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildSnapPayload,
  calculateMidtransGrossAmount,
  isIgnorableMidtransNoop,
  resolveMidtransTransactionRuntimeConfig,
  resolveMidtransWebhookRuntimeConfig,
  verifyMidtransTransaction,
} from "../midtrans.ts";
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

  it("uses persisted order gross amount instead of recomputing from current item rows", () => {
    const payload = buildSnapPayload(
      {
        ...baseOrder,
        gross_amount: 65000,
        order_items: [
          ...baseOrder.order_items!,
          {
            product_id: "unselected-product-left-in-cart",
            quantity: 1,
            price_at_purchase: 40000,
            products: {
              name: "Unselected Product",
              categories: { name: "Healthcare" },
            },
          },
        ],
      },
      authUser,
    );

    expect(payload.transaction_details.gross_amount).toBe(65000);
    expect(calculateMidtransGrossAmount({
      ...baseOrder,
      order_items: [
        ...baseOrder.order_items!,
        {
          product_id: "unselected-product-left-in-cart",
          quantity: 1,
          price_at_purchase: 40000,
          products: {
            name: "Unselected Product",
            categories: { name: "Healthcare" },
          },
        },
      ],
    })).toBe(105000);
  });
});

describe("isIgnorableMidtransNoop", () => {
  it("treats duplicate payment transitions as ignorable only when the order status already matches", () => {
    expect(
      isIgnorableMidtransNoop(
        "settlement",
        "settlement",
        "processing",
        "processing",
      ),
    ).toBe(true);

    expect(
      isIgnorableMidtransNoop(
        "settlement",
        "cancel",
        "processing",
        "cancelled",
      ),
    ).toBe(false);
  });

  it("keeps the legacy payment-only fallback when order status is unavailable", () => {
    expect(isIgnorableMidtransNoop("settlement", "cancel")).toBe(true);
    expect(isIgnorableMidtransNoop("pending", "settlement")).toBe(false);
  });
});


const makeSignature = async (
  orderId: string,
  statusCode: string,
  grossAmount: string,
  serverKey: string,
) => {
  const hashBuffer = await crypto.subtle.digest(
    "SHA-512",
    new TextEncoder().encode(`${orderId}${statusCode}${grossAmount}${serverKey}`),
  );

  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const createRuntimeRows = () => [
  {
    key_name: "midtrans.server_key",
    value_kind: "secret",
    is_secret: true,
    is_required: true,
    is_runtime_required: true,
    version_id: "server-active-version-id",
    version_number: 10,
    status: "active",
    runtime_value: "midtrans-active-sentinel-key",
    masked_value: "midt*****************key",
    value_fingerprint: "active-fingerprint",
    updated_at: "2026-05-19T00:00:00.000Z",
  },
  {
    key_name: "midtrans.server_key",
    value_kind: "secret",
    is_secret: true,
    is_required: true,
    is_runtime_required: true,
    version_id: "server-grace-version-id",
    version_number: 9,
    status: "grace",
    runtime_value: "midtrans-grace-sentinel-key",
    masked_value: "midt****************key",
    value_fingerprint: "grace-fingerprint",
    updated_at: "2026-05-18T00:00:00.000Z",
  },
  {
    key_name: "midtrans.is_production",
    value_kind: "boolean",
    is_secret: false,
    is_required: true,
    is_runtime_required: true,
    version_id: "production-active-version-id",
    version_number: 4,
    status: "active",
    runtime_value: false,
    masked_value: "false",
    value_fingerprint: "production-active-fingerprint",
    updated_at: "2026-05-19T00:00:00.000Z",
  },
  {
    key_name: "midtrans.is_production",
    value_kind: "boolean",
    is_secret: false,
    is_required: true,
    is_runtime_required: true,
    version_id: "production-grace-version-id",
    version_number: 3,
    status: "grace",
    runtime_value: true,
    masked_value: "true",
    value_fingerprint: "production-grace-fingerprint",
    updated_at: "2026-05-18T00:00:00.000Z",
  },
];

describe("Midtrans runtime config resolution", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("matches a grace signature and keeps the grace key and mode for status verification", async () => {
    const payload = {
      order_id: "MIDTRANS-GRACE-ORDER",
      status_code: "200",
      gross_amount: "150000.00",
      signature_key: await makeSignature(
        "MIDTRANS-GRACE-ORDER",
        "200",
        "150000.00",
        "midtrans-grace-sentinel-key",
      ),
    };
    const adminClient = {
      rpc: vi.fn(async (name: string, args?: Record<string, unknown>) => {
        if (name === "get_midtrans_payment_config_binding") {
          return { data: [], error: null };
        }

        const keyNames = args?.p_key_names as string[] | undefined;
        return {
          data: createRuntimeRows().filter((row) =>
            !keyNames || keyNames.includes(row.key_name)
          ),
          error: null,
        };
      }),
    };
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ transaction_status: "settlement" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const resolution = await resolveMidtransWebhookRuntimeConfig(
      adminClient,
      payload,
    );
    await verifyMidtransTransaction(payload.order_id, resolution.config.serverKey, {
      isProduction: resolution.config.isProduction,
    });

    expect(resolution.signatureValid).toBe(true);
    expect(resolution.config).toMatchObject({
      source: "grace",
      serverKey: "midtrans-grace-sentinel-key",
      isProduction: true,
      serverKeyVersionNumber: 9,
      isProductionVersionNumber: 3,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.midtrans.com/v2/MIDTRANS-GRACE-ORDER/status",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Basic ${btoa("midtrans-grace-sentinel-key:")}`,
        }),
      }),
    );
  });


  it("fails closed for active transaction config when runtime rows are missing", async () => {
    const adminClient = {
      rpc: vi.fn(async (name: string) => {
        if (name === "get_midtrans_payment_config_binding") {
          return { data: [], error: null };
        }

        return { data: [], error: null };
      }),
    };

    await expect(
      resolveMidtransTransactionRuntimeConfig(
        adminClient,
        "UNBOUND-PAYMENT-ORDER",
      ),
    ).rejects.toThrow("Midtrans runtime config unavailable");
  });

  it("does not use provider env fallback while selecting pre-signature webhook candidates", async () => {
    const env = {
      get: vi.fn(() => "midtrans-env-fallback-key-must-not-be-used"),
    };
    const adminClient = {
      rpc: vi.fn(async (name: string) => {
        if (name === "get_midtrans_payment_config_binding") {
          return { data: [], error: null };
        }

        return { data: [], error: null };
      }),
    };

    await expect(
      resolveMidtransWebhookRuntimeConfig(
        adminClient,
        {
          order_id: "MIDTRANS-PRESIGNATURE-ORDER",
          status_code: "200",
          gross_amount: "150000.00",
          signature_key: "invalid-signature",
        },
      ),
    ).rejects.toThrow("Midtrans runtime config unavailable");
    expect(env.get).not.toHaveBeenCalled();
  });

  it("uses transaction-bound config versions before active or grace candidates", async () => {
    const payload = {
      order_id: "MIDTRANS-BOUND-ORDER",
      status_code: "200",
      gross_amount: "150000.00",
      signature_key: await makeSignature(
        "MIDTRANS-BOUND-ORDER",
        "200",
        "150000.00",
        "midtrans-bound-sentinel-key",
      ),
    };
    const adminClient = {
      rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
        if (name === "get_midtrans_payment_config_binding") {
          return {
            data: [{
              payment_id: "payment-bound",
              midtrans_order_id: "MIDTRANS-BOUND-ORDER",
              server_key_version_number: 6,
              is_production_version_number: 2,
            }],
            error: null,
          };
        }

        const keyNames = args.p_key_names as string[];
        if (keyNames.includes("midtrans.server_key")) {
          expect(args.p_version_numbers).toEqual({ "midtrans.server_key": 6 });
          return {
            data: [{
              ...createRuntimeRows()[0],
              version_id: "server-bound-version-id",
              version_number: 6,
              status: "retired",
              runtime_value: "midtrans-bound-sentinel-key",
            }],
            error: null,
          };
        }

        expect(args.p_version_numbers).toEqual({ "midtrans.is_production": 2 });
        return {
          data: [{
            ...createRuntimeRows()[2],
            version_id: "production-bound-version-id",
            version_number: 2,
            status: "retired",
            runtime_value: false,
          }],
          error: null,
        };
      }),
    };

    const resolution = await resolveMidtransWebhookRuntimeConfig(
      adminClient,
      payload,
    );

    expect(resolution.signatureValid).toBe(true);
    expect(resolution.config).toMatchObject({
      source: "bound",
      serverKey: "midtrans-bound-sentinel-key",
      isProduction: false,
      serverKeyVersionNumber: 6,
      isProductionVersionNumber: 2,
    });
  });
});
