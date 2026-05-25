import { describe, expect, it, vi } from "vitest";
import {
  createCheckoutOrderHandler,
  HttpError,
  type CheckoutAdminClient,
} from "../handler.ts";

const CART_ITEM_ID_A = "11111111-1111-4111-8111-111111111111";
const CART_ITEM_ID_B = "22222222-2222-4222-8222-222222222222";

const VALID_REQUEST_BODY = {
  shipping_address_id: "address-1",
  destination_area_id: "area-1",
  destination_postal_code: null,
  shipping_option: {
    courier_code: "jne",
    service_code: "reg",
    price: 12000,
    estimated_delivery: "2-3 days",
  },
  checkout_idempotency_key: "checkout-key-1",
  selected_cart_item_ids: [CART_ITEM_ID_B, CART_ITEM_ID_A],
};

function createRequest(
  body: Record<string, unknown>,
  authorization = "Bearer token",
  requestId?: string,
) {
  return new Request("https://example.test/functions/v1/create-checkout-order", {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
      ...(requestId ? { "x-request-id": requestId } : {}),
    },
    body: JSON.stringify(body),
  });
}

function createCheckoutClientMock(options?: {
  data?: unknown;
  error?: { message?: string } | null;
  profile?: { is_banned: boolean } | null;
  profileError?: { message?: string } | null;
}) {
  const profileSingle = vi.fn(async () => ({
    data: options?.profile ?? { is_banned: false },
    error: options?.profileError ?? null,
  }));
  const profilesSelect = vi.fn(() => ({
    eq: vi.fn(() => ({ single: profileSingle })),
  }));
  const from = vi.fn((tableName: string) => {
    if (tableName === "profiles") {
      return { select: profilesSelect };
    }
    throw new Error(`Unexpected table: ${tableName}`);
  });
  const rpc = vi.fn(async () => ({
    data:
      options?.data ??
      [
        {
          order_id: "order-1",
          total_amount: 50000,
          item_count: 2,
          checkout_idempotency_key: "checkout-key-1",
        },
      ],
    error: options?.error ?? null,
  }));

  const client = {
    rpc,
    from,
  } as unknown as CheckoutAdminClient;

  return { client, rpc, from, profileSingle, profilesSelect };
}

function createBodyWithoutSelectedCartItemIds() {
  const body: Record<string, unknown> = { ...VALID_REQUEST_BODY };
  delete body.selected_cart_item_ids;
  return body;
}

function createHandler(options?: {
  client?: CheckoutAdminClient;
  getAuthenticatedUserId?: (req: Request) => Promise<string>;
}) {
  const { client, rpc, from, profileSingle, profilesSelect } = createCheckoutClientMock();
  const selectedClient = options?.client ?? client;
  const getAdminClient = vi.fn(() => selectedClient);
  const getAuthenticatedUserId = vi.fn(
    options?.getAuthenticatedUserId ?? (async () => "user-1"),
  );
  const logError = vi.fn();

  return {
    handler: createCheckoutOrderHandler({
      getAuthenticatedUserId,
      getAdminClient,
      logError,
    }),
    getAdminClient,
    getAuthenticatedUserId,
    logError,
    rpc,
    from,
    profileSingle,
    profilesSelect,
  };
}

describe("createCheckoutOrderHandler", () => {
  it.each([
    {
      name: "missing selected_cart_item_ids",
      body: createBodyWithoutSelectedCartItemIds(),
      error: "selected_cart_item_ids is required",
    },
    {
      name: "null selected_cart_item_ids",
      body: { ...VALID_REQUEST_BODY, selected_cart_item_ids: null },
      error: "selected_cart_item_ids must be an array",
    },
    {
      name: "non-array selected_cart_item_ids",
      body: { ...VALID_REQUEST_BODY, selected_cart_item_ids: CART_ITEM_ID_A },
      error: "selected_cart_item_ids must be an array",
    },
    {
      name: "empty selected_cart_item_ids",
      body: { ...VALID_REQUEST_BODY, selected_cart_item_ids: [] },
      error: "Pilih minimal satu produk untuk checkout",
    },
    {
      name: "non-string selected_cart_item_ids entry",
      body: { ...VALID_REQUEST_BODY, selected_cart_item_ids: [CART_ITEM_ID_A, 123] },
      error: "selected_cart_item_ids contains invalid cart item id",
    },
    {
      name: "blank selected_cart_item_ids entry",
      body: { ...VALID_REQUEST_BODY, selected_cart_item_ids: [CART_ITEM_ID_A, " "] },
      error: "selected_cart_item_ids contains invalid cart item id",
    },
    {
      name: "invalid UUID selected_cart_item_ids entry",
      body: { ...VALID_REQUEST_BODY, selected_cart_item_ids: [CART_ITEM_ID_A, "cart-item-2"] },
      error: "selected_cart_item_ids contains invalid cart item id",
    },
    {
      name: "duplicate selected_cart_item_ids before sorting",
      body: { ...VALID_REQUEST_BODY, selected_cart_item_ids: [CART_ITEM_ID_B, CART_ITEM_ID_A, CART_ITEM_ID_B] },
      error: "selected_cart_item_ids contains duplicate cart item id",
    },
  ])("returns 400 for $name and does not call RPC", async ({ body, error }) => {
    const { handler, getAdminClient, rpc } = createHandler();

    const response = await handler(createRequest(body));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error });
    expect(getAdminClient).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sorts valid selected cart item IDs and forwards them to the checkout RPC", async () => {
    const { handler, rpc } = createHandler();

    const response = await handler(createRequest(VALID_REQUEST_BODY, "Bearer token", "checkout-request-1"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("checkout-request-1");
    expect(rpc).toHaveBeenCalledWith("create_checkout_order_aggregate", {
      p_user_id: "user-1",
      p_shipping_address_id: "address-1",
      p_destination_area_id: "area-1",
      p_destination_postal_code: null,
      p_courier_code: "jne",
      p_courier_service: "reg",
      p_shipping_price: 12000,
      p_shipping_etd: "2-3 days",
      p_checkout_idempotency_key: "checkout-key-1",
      p_selected_cart_item_ids: [CART_ITEM_ID_A, CART_ITEM_ID_B],
    });
  });

  it("returns 401 before RPC when authentication fails", async () => {
    const { handler, getAdminClient, rpc } = createHandler({
      getAuthenticatedUserId: async () => {
        throw new HttpError(401, "Unauthorized");
      },
    });

    const response = await handler(createRequest(VALID_REQUEST_BODY, "Bearer token", "checkout-rpc-1"));
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: "Unauthorized" });
    expect(getAdminClient).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("blocks banned customers before checkout RPC and ignores user-editable request metadata", async () => {
    const { client, rpc, profileSingle } = createCheckoutClientMock({
      profile: { is_banned: true },
    });
    const { handler } = createHandler({ client });

    const response = await handler(createRequest({
      ...VALID_REQUEST_BODY,
      user_metadata: { is_banned: false },
      raw_user_meta_data: { is_banned: false },
    }));
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toEqual({ error: "Customer account is not allowed to create checkout orders" });
    expect(profileSingle).toHaveBeenCalledTimes(1);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("preserves required shipping field validation before RPC", async () => {
    const { handler, getAdminClient, rpc } = createHandler();

    const response = await handler(
      createRequest({
        ...VALID_REQUEST_BODY,
        shipping_address_id: "",
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: "shipping_address_id is required" });
    expect(getAdminClient).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("redacts checkout RPC errors from caller responses", async () => {
    const { client, rpc } = createCheckoutClientMock({
      error: { message: "relation public.cart_items violates create_checkout_order_aggregate policy" },
    });
    const { handler, logError } = createHandler({ client });

    const response = await handler(createRequest(VALID_REQUEST_BODY, "Bearer token", "checkout-rpc-1"));
    const payload = await response.json();
    const payloadText = JSON.stringify(payload);

    expect(response.status).toBe(500);
    expect(payload).toEqual({ error: "Checkout order could not be created" });
    expect(payloadText).not.toContain("cart_items");
    expect(payloadText).not.toContain("create_checkout_order_aggregate");
    expect(payloadText).not.toContain("policy");
    const loggedText = JSON.stringify(logError.mock.calls);
    expect(response.headers.get("x-request-id")).toBe("checkout-rpc-1");
    expect(loggedText).not.toContain("cart_items");
    expect(loggedText).not.toContain("create_checkout_order_aggregate");
    expect(loggedText).not.toContain("policy");
    expect(loggedText).toContain("checkout-rpc-1");
    expect(loggedText).toContain("checkout_rpc_failed");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("replaces unsafe request IDs in checkout error responses and logs", async () => {
    const unsafeRequestId = "x".repeat(129);
    const { client } = createCheckoutClientMock({
      error: { message: "raw database failure" },
    });
    const { handler, logError } = createHandler({ client });

    const response = await handler(createRequest(VALID_REQUEST_BODY, "Bearer token", unsafeRequestId));
    const effectiveRequestId = response.headers.get("x-request-id");
    const loggedText = JSON.stringify(logError.mock.calls);

    expect(response.status).toBe(500);
    expect(effectiveRequestId).toBeTruthy();
    expect(effectiveRequestId).not.toBe(unsafeRequestId);
    expect(loggedText).toContain(String(effectiveRequestId));
    expect(loggedText).not.toContain(unsafeRequestId);
  });

  it("preserves the successful checkout response payload", async () => {
    const { handler } = createHandler();

    const response = await handler(createRequest(VALID_REQUEST_BODY));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      order_id: "order-1",
      total_amount: 50000,
      item_count: 2,
      checkout_idempotency_key: "checkout-key-1",
    });
  });
});
