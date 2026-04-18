import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5";
import { corsHeaders } from "../_shared/cors.ts";
import { getSupabaseAdminClient } from "../_shared/supabase.ts";

declare const Deno: {
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
  env: {
    get: (key: string) => string | undefined;
  };
};

const JSON_HEADERS = { ...corsHeaders, "Content-Type": "application/json" };
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

const JWKS = createRemoteJWKSet(
  new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`),
);
const JWT_ISSUER = `${supabaseUrl}/auth/v1`;

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
};

type CheckoutAggregateResult = {
  order_id?: string;
  total_amount?: number;
  item_count?: number;
  checkout_idempotency_key?: string;
};

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

async function getAuthenticatedUserId(req: Request): Promise<string> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new HttpError(401, "Missing or invalid Authorization header");
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    throw new HttpError(401, "Missing or invalid Authorization header");
  }

  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: JWT_ISSUER,
      audience: "authenticated",
    });

    const userId = payload.sub ?? "";
    if (!userId) {
      throw new HttpError(401, "Unauthorized");
    }

    return userId;
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }

    throw new HttpError(401, "Unauthorized");
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method Not Allowed" }, 405);
  }

  try {
    const userId = await getAuthenticatedUserId(req);
    const body = (await req.json()) as CreateCheckoutOrderRequest;

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

    const adminClient = getSupabaseAdminClient();
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
    });

    if (error) {
      throw new HttpError(500, error.message || "Failed to create checkout order");
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

    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[create-checkout-order] Internal error:", message);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
