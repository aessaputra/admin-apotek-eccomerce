import { corsHeaders } from "../_shared/cors.ts";
import { resolveRequestId, withRequestIdResponse } from "../_shared/request-id.ts";

const JSON_HEADERS = { ...corsHeaders, "Content-Type": "application/json" };
const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type ShippingOptionPayload = {
  courier_code?: string;
  service_code?: string;
  price?: number;
  estimated_delivery?: string | null;
};

type CreateCheckoutOrderRequest = {
  shipping_address_id?: string;
  destination_area_id?: string | null;
  destination_postal_code?: number | null;
  shipping_option?: ShippingOptionPayload;
  checkout_idempotency_key?: string;
  selected_cart_item_ids?: unknown;
};

type CheckoutAggregateResult = {
  order_id?: string;
  total_amount?: number;
  item_count?: number;
  checkout_idempotency_key?: string;
};

type CustomerPolicyProfile = {
  is_banned?: boolean | null;
};

type CustomerPolicySelectQuery = {
  eq: (column: "id", value: string) => {
    single: () => Promise<{ data: CustomerPolicyProfile | null; error: CheckoutRpcError | null }>;
  };
};

type ProfilesTableQuery = {
  select: (columns: "is_banned") => CustomerPolicySelectQuery;
};

export interface CheckoutRpcError {
  message?: string;
}

export interface CheckoutAdminClient {
  from: (table: "profiles") => ProfilesTableQuery;
  rpc: (
    fn: "create_checkout_order_aggregate",
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: CheckoutRpcError | null }>;
}

export interface CreateCheckoutOrderHandlerDependencies {
  getAuthenticatedUserId: (req: Request) => Promise<string>;
  getAdminClient: () => CheckoutAdminClient;
  logError?: (message: string, context?: Record<string, string>) => void;
}

export class HttpError extends Error {
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

function normalizeOptionalString(value: unknown): string | null {
  const normalized = normalizeString(value);
  return normalized || null;
}

function normalizeOptionalInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function normalizePositiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

async function isCustomerBanned(
  adminClient: CheckoutAdminClient,
  userId: string,
): Promise<boolean> {
  const { data, error } = await adminClient.from("profiles").select("is_banned").eq("id", userId).single();

  if (error) {
    throw new HttpError(500, "Customer policy could not be verified");
  }

  return data?.is_banned === true;
}

function normalizeSelectedCartItemIds(body: CreateCheckoutOrderRequest): string[] {
  if (!Object.prototype.hasOwnProperty.call(body, "selected_cart_item_ids")) {
    throw new HttpError(400, "selected_cart_item_ids is required");
  }

  if (!Array.isArray(body.selected_cart_item_ids)) {
    throw new HttpError(400, "selected_cart_item_ids must be an array");
  }

  if (body.selected_cart_item_ids.length === 0) {
    throw new HttpError(400, "Pilih minimal satu produk untuk checkout");
  }

  const selectedCartItemIds: string[] = [];
  const seenIds = new Set<string>();

  for (const rawId of body.selected_cart_item_ids) {
    const selectedCartItemId = normalizeString(rawId);

    if (!selectedCartItemId || !CANONICAL_UUID_PATTERN.test(selectedCartItemId)) {
      throw new HttpError(400, "selected_cart_item_ids contains invalid cart item id");
    }

    if (seenIds.has(selectedCartItemId)) {
      throw new HttpError(400, "selected_cart_item_ids contains duplicate cart item id");
    }

    seenIds.add(selectedCartItemId);
    selectedCartItemIds.push(selectedCartItemId);
  }

  return [...selectedCartItemIds].sort();
}

export function createCheckoutOrderHandler(dependencies: CreateCheckoutOrderHandlerDependencies) {
  const logError = dependencies.logError ??
    ((message: string, context?: Record<string, string>) => console.error("[create-checkout-order] safe_failure", {
      action: message,
      ...context,
    }));

  return async (req: Request) => {
    const requestId = resolveRequestId(req.headers);

    const handleRequest = async (): Promise<Response> => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    if (req.method !== "POST") {
      return jsonResponse({ error: "Method Not Allowed" }, 405);
    }

    try {
      const userId = await dependencies.getAuthenticatedUserId(req);
      const body = (await req.json()) as CreateCheckoutOrderRequest;

      const selectedCartItemIds = normalizeSelectedCartItemIds(body);
      const shippingAddressId = normalizeString(body.shipping_address_id);
      const destinationAreaId = normalizeOptionalString(body.destination_area_id);
      const destinationPostalCode = normalizeOptionalInteger(body.destination_postal_code);
      const checkoutIdempotencyKey = normalizeString(body.checkout_idempotency_key);
      const courierCode = normalizeString(body.shipping_option?.courier_code);
      const courierService = normalizeString(body.shipping_option?.service_code);
      const shippingPrice = normalizePositiveNumber(body.shipping_option?.price);
      const shippingEtd = normalizeOptionalString(body.shipping_option?.estimated_delivery);

      if (!shippingAddressId) {
        throw new HttpError(400, "shipping_address_id is required");
      }

      if (!checkoutIdempotencyKey) {
        throw new HttpError(400, "checkout_idempotency_key is required");
      }

      if (!courierCode || !courierService || shippingPrice === null) {
        throw new HttpError(400, "shipping_option is invalid");
      }

      if (!destinationAreaId && destinationPostalCode === null) {
        throw new HttpError(
          400,
          "destination_area_id or destination_postal_code is required",
        );
      }

      const adminClient = dependencies.getAdminClient();
      if (await isCustomerBanned(adminClient, userId)) {
        throw new HttpError(403, "Customer account is not allowed to create checkout orders");
      }

      const { data, error } = await adminClient.rpc("create_checkout_order_aggregate", {
        p_user_id: userId,
        p_shipping_address_id: shippingAddressId,
        p_destination_area_id: destinationAreaId,
        p_destination_postal_code: destinationPostalCode,
        p_courier_code: courierCode,
        p_courier_service: courierService,
        p_shipping_price: shippingPrice,
        p_shipping_etd: shippingEtd,
        p_checkout_idempotency_key: checkoutIdempotencyKey,
        p_selected_cart_item_ids: selectedCartItemIds,
      });

      if (error) {
        logError("[create-checkout-order] checkout_rpc_failed", { action: "checkout_rpc_failed", requestId });
        throw new HttpError(500, "Checkout order could not be created");
      }

      const row = (Array.isArray(data) ? data[0] : data) as CheckoutAggregateResult | null;

      if (
        !row?.order_id ||
        typeof row.total_amount !== "number" ||
        typeof row.item_count !== "number" ||
        typeof row.checkout_idempotency_key !== "string"
      ) {
        throw new HttpError(500, "Checkout aggregate returned invalid payload");
      }

      return jsonResponse({
        order_id: row.order_id,
        total_amount: row.total_amount,
        item_count: row.item_count,
        checkout_idempotency_key: row.checkout_idempotency_key,
      });
    } catch (error: unknown) {
      if (error instanceof HttpError) {
        return jsonResponse({ error: error.message }, error.status);
      }

      logError("[create-checkout-order] internal_error", { action: "internal_error", requestId });
      return jsonResponse({ error: "Internal server error" }, 500);
    }
    };

    return withRequestIdResponse(await handleRequest(), requestId);
  };
}
