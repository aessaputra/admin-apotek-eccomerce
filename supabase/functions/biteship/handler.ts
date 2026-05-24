import {
  assertCompleteStoreSettings,
  filterRatesByEnabledServices,
  getEnabledCouriers,
  getBiteshipAuthorizationHeader,
  getRequiredStoreOriginPostalCode,
  persistBiteshipShipment,
  isCourierServiceEnabled,
  resolveBiteshipApiKeyFromRuntimeConfig,
  resolveBiteshipRuntimeSettings,
  type BiteshipRuntimeSettings,
  type StoreSettings,
} from "../_shared/biteship.ts";
import {
  buildPublicTrackingEndpoint,
  buildTrackingEndpoint,
} from "../_shared/biteship-public-tracking.ts";
import { parseBiteshipPostalCode } from "../_shared/biteship-postal-code.ts";
import {
  buildMergedRatesResponse,
  buildRatesRequestPayloads,
  type RatesExecutionFailure,
  type RatesExecutionSuccess,
} from "../_shared/biteship-rates.ts";
import { corsHeaders } from "../_shared/cors.ts";
import type { RuntimeConfigAdminClient } from "../_shared/runtime-config.ts";

const BITESHIP_API_URL = "https://api.biteship.com";
const BITESHIP_CONFIG_INCOMPLETE = "BITESHIP_CONFIG_INCOMPLETE";

export interface BiteshipAdminClient extends RuntimeConfigAdminClient {
  from: (table: string) => any;
}

export interface BiteshipHandlerDependencies {
  fetchFn?: typeof fetch;
  getAdminClient: () => BiteshipAdminClient;
  resolveAuthHeader?: (adminClient: BiteshipAdminClient) => Promise<string>;
  resolveRuntimeSettings?: (
    adminClient: BiteshipAdminClient,
  ) => Promise<BiteshipRuntimeSettings>;
  verifyUserId: (token: string) => Promise<string>;
}

// Validate maps input to prevent injection attacks
function validateMapsInput(input: unknown): {
  valid: boolean;
  error?: string;
  sanitized?: string;
} {
  // Must be a string
  if (typeof input !== "string") {
    return { valid: false, error: "Input must be a string" };
  }

  const trimmed = input.trim();

  // Must not be empty
  if (trimmed.length === 0) {
    return { valid: false, error: "Input cannot be empty" };
  }

  // Maximum length: 100 characters
  if (trimmed.length > 100) {
    return {
      valid: false,
      error: "Input exceeds maximum length of 100 characters",
    };
  }

  // Reject suspicious patterns that could indicate injection attempts
  const suspiciousPatterns = [
    /<script/i, // XSS attempts
    /javascript:/i, // JavaScript protocol
    /on\w+=/i, // Event handlers
    /[<>]/, // HTML tags
    /\$\{/, // Template literal injection
    /[%][0-9a-f]{2}/i, // URL encoding abuse
  ];

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(trimmed)) {
      return { valid: false, error: "Input contains invalid characters" };
    }
  }

  return { valid: true, sanitized: trimmed };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getNestedString(data: unknown, path: string[]): string | undefined {
  let current: unknown = data;

  for (const key of path) {
    if (!isRecord(current) || !(key in current)) {
      return undefined;
    }
    current = current[key];
  }

  return typeof current === "string" ? current : undefined;
}

function getLoggablePayload(payload: unknown): unknown {
  if (!isRecord(payload)) {
    return payload;
  }

  const {
    token: _token,
    auth: _auth,
    authorization: _authorization,
    api_key: _apiKey,
    ...safePayload
  } = payload;

  return safePayload;
}

async function resolveBiteshipAuthKey(
  adminClient: BiteshipAdminClient,
): Promise<string> {
  const apiKey = await resolveBiteshipApiKeyFromRuntimeConfig(adminClient);
  return getBiteshipAuthorizationHeader(apiKey);
}

function isBiteshipRuntimeConfigError(error: unknown): boolean {
  return error instanceof Error && error.name === "BiteshipRuntimeConfigError";
}

function withServerShipperAndOriginFields(
  payload: Record<string, unknown>,
  settings: StoreSettings,
): Record<string, unknown> {
  const {
    shipper_contact_name: _shipperContactName,
    shipper_contact_phone: _shipperContactPhone,
    shipper_contact_email: _shipperContactEmail,
    shipper_organization: _shipperOrganization,
    origin_contact_name: _originContactName,
    origin_contact_phone: _originContactPhone,
    origin_address: _originAddress,
    origin_area_id: _originAreaId,
    origin_postal_code: _originPostalCode,
    origin_latitude: _originLatitude,
    origin_longitude: _originLongitude,
    origin_coordinate: _originCoordinate,
    ...safePayload
  } = payload;

  return {
    ...safePayload,
    shipper_contact_name: settings.store_name,
    shipper_contact_phone: settings.phone_number,
    shipper_contact_email: settings.email,
    shipper_organization: settings.organization,
    origin_contact_name: settings.store_name,
    origin_contact_phone: settings.phone_number,
    origin_address: settings.store_address,
    origin_postal_code: parseBiteshipPostalCode(
      getRequiredStoreOriginPostalCode(settings),
      "origin_postal_code",
    ),
  };
}

function withoutClientOriginFields(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const {
    origin_area_id: _originAreaId,
    origin_postal_code: _originPostalCode,
    origin_latitude: _originLatitude,
    origin_longitude: _originLongitude,
    origin_coordinate: _originCoordinate,
    ...safePayload
  } = payload;

  return safePayload;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const trimmedValue = value.trim();
    if (!trimmedValue) {
      return null;
    }

    const parsedValue = Number(trimmedValue);
    return Number.isFinite(parsedValue) ? parsedValue : null;
  }

  return null;
}

function hasDestinationCoordinates(payload: Record<string, unknown>): boolean {
  return (
    toFiniteNumber(payload.destination_latitude) !== null &&
    toFiniteNumber(payload.destination_longitude) !== null
  );
}

function toRuntimeStoreSettings(
  runtimeSettings: BiteshipRuntimeSettings,
): StoreSettings {
  return {
    store_name: runtimeSettings.shipperName,
    phone_number: runtimeSettings.shipperPhone,
    email: runtimeSettings.shipperEmail,
    organization: runtimeSettings.shipperOrganization,
    store_address: runtimeSettings.shipperAddress,
    enabled_couriers: runtimeSettings.enabledCouriers.join(",") || null,
    origin_postal_code: runtimeSettings.originPostalCode || null,
    origin_latitude: runtimeSettings.originLatitude ?? null,
    origin_longitude: runtimeSettings.originLongitude ?? null,
    origin_area_id: runtimeSettings.originAreaId || null,
  };
}

function uniqueDiagnostics(diagnostics: string[]): string[] {
  return Array.from(new Set(diagnostics));
}

function isRatesRuntimeDiagnostic(diagnostic: string): boolean {
  return (
    diagnostic.startsWith("biteship.api_key") ||
    diagnostic.startsWith("biteship.enabled_couriers") ||
    diagnostic.startsWith("biteship.origin_") ||
    diagnostic.includes("Biteship rates require") ||
    diagnostic.includes("Biteship couriers require")
  );
}

function getActionRuntimeDiagnostics(
  runtimeSettings: BiteshipRuntimeSettings,
  action: "rates" | "draft_order",
): string[] {
  const diagnostics = runtimeSettings.diagnostics.filter((diagnostic) => {
    if (action === "rates") {
      return isRatesRuntimeDiagnostic(diagnostic);
    }

    return true;
  });

  if (runtimeSettings.enabledCouriers.length === 0) {
    diagnostics.push("biteship.enabled_couriers current version missing or empty");
  }

  if (action === "draft_order" && !runtimeSettings.originPostalCode) {
    diagnostics.push("biteship.origin_postal_code current version missing");
  }

  return uniqueDiagnostics(diagnostics);
}

function getBlockingRuntimeDiagnostics(
  runtimeSettings: BiteshipRuntimeSettings,
  action: "rates" | "draft_order",
): string[] {
  return getActionRuntimeDiagnostics(runtimeSettings, action);
}

function createBiteshipConfigErrorResponse(diagnostics: string[]): Response {
  return new Response(
    JSON.stringify({
      error: BITESHIP_CONFIG_INCOMPLETE,
      message: "Biteship runtime configuration is incomplete.",
      diagnostics: uniqueDiagnostics(diagnostics),
    }),
    {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}

export function createBiteshipHandler(
  dependencies: BiteshipHandlerDependencies,
): (req: Request) => Promise<Response> {
  const {
    fetchFn = fetch,
    getAdminClient,
    resolveAuthHeader = resolveBiteshipAuthKey,
    resolveRuntimeSettings = resolveBiteshipRuntimeSettings,
    verifyUserId,
  } = dependencies;

  return async (req: Request) => {
    let adminClient: BiteshipAdminClient | undefined;
    const getAdminClientOnce = () => {
      adminClient ??= getAdminClient();
      return adminClient;
    };
    // 1. Handle CORS Preflight
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Missing or invalid Authorization header" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      return new Response(
        JSON.stringify({ error: "Missing or invalid Authorization header" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    let userId: string;
    try {
      userId = await verifyUserId(token);
      if (!userId) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } catch (error: unknown) {
      console.error("[biteship] JWT verification failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 4. Parse request
    const requestBody: unknown = await req.json();
    const action =
      isRecord(requestBody) && typeof requestBody.action === "string"
        ? requestBody.action
        : "";
    const payload =
      isRecord(requestBody) && isRecord(requestBody.payload)
        ? requestBody.payload
        : undefined;

    if (!action) {
      return new Response(JSON.stringify({ error: "Action is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isRatesAction = action === "rates";
    const isCreateOrderAction = action === "create_order";
    const isTrackAction = action === "track";
    const isTrackPublicAction = action === "track_public";
    let publicTrackingPayload: Record<string, unknown> | undefined;

    // 5. Validate action-specific requirements before fetching settings
    if (isCreateOrderAction) {
      return new Response(
        JSON.stringify({
          error:
            "Direct create_order is disabled. Biteship orders are created automatically after payment settlement.",
        }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (isTrackAction) {
      return new Response(
        JSON.stringify({
          error:
            "Direct track is disabled. Use the protected order-manager sync flow instead.",
        }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (isTrackPublicAction) {
      const orderId =
        isRecord(payload) && typeof payload.order_id === "string"
          ? payload.order_id.trim()
          : "";

      if (!orderId) {
        return new Response(JSON.stringify({ error: "order_id is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const adminClient = getAdminClientOnce();
      const { data: order, error: orderError } = await adminClient
        .from("order_read_model")
        .select("id, user_id, waybill_number, courier_code, status")
        .eq("id", orderId)
        .eq("user_id", userId)
        .single();

      if (orderError || !order) {
        return new Response(JSON.stringify({ error: "Order not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!order.waybill_number?.trim()) {
        return new Response(
          JSON.stringify({
            error: "Waybill number is not available for this order yet",
          }),
          {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      if (!order.courier_code?.trim()) {
        return new Response(
          JSON.stringify({
            error: "Courier code is not available for this order",
          }),
          {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      publicTrackingPayload = {
        order_id: order.id,
        waybill_id: order.waybill_number,
        courier_code: order.courier_code,
      };
    }

    // 7. Build Biteship request
    let endpoint = "";
    let method = "POST";
    let requestPayload = isRecord(payload) ? payload : undefined;
    if (publicTrackingPayload) {
      requestPayload = publicTrackingPayload;
    }

    let settings: StoreSettings | undefined;
    let runtimeSettings: BiteshipRuntimeSettings | undefined;
    const needsRuntimeSettings = isRatesAction || action === "draft_order";

    if (needsRuntimeSettings) {
      try {
        runtimeSettings = await resolveRuntimeSettings(getAdminClientOnce());
      } catch (error: unknown) {
        console.error("[biteship] Failed to resolve runtime settings:", error);
        return createBiteshipConfigErrorResponse(
          ["Biteship runtime config unavailable"],
        );
      }

      const actionRuntimeSettings = isRatesAction ? "rates" : "draft_order";
      const blockingDiagnostics = getBlockingRuntimeDiagnostics(
        runtimeSettings,
        actionRuntimeSettings,
      );
      if (blockingDiagnostics.length > 0) {
        return createBiteshipConfigErrorResponse(blockingDiagnostics);
      }

      settings = toRuntimeStoreSettings(runtimeSettings);
    }

    if (isRatesAction) {
      const safePayload = isRecord(requestPayload) ? requestPayload : {};
      const ratesPayload = withoutClientOriginFields(safePayload);
      const enabledCouriers = getEnabledCouriers(settings!);

      const destinationAreaId =
        typeof ratesPayload.destination_area_id === "string"
          ? ratesPayload.destination_area_id.trim()
          : "";
      const rawDestinationPostalCode =
        ratesPayload.destination_postal_code ?? ratesPayload.destination_postalcode;
      const hasDestinationAreaId = destinationAreaId.length > 0;
      let hasDestinationPostalCode = false;

      if (rawDestinationPostalCode !== null && rawDestinationPostalCode !== undefined) {
        try {
          ratesPayload.destination_postal_code = parseBiteshipPostalCode(
            typeof rawDestinationPostalCode === "string" ||
              typeof rawDestinationPostalCode === "number"
              ? rawDestinationPostalCode
              : undefined,
            "destination_postal_code",
          );
          hasDestinationPostalCode = true;
        } catch (error: unknown) {
          return new Response(
            JSON.stringify({
              error:
                error instanceof Error
                  ? error.message
                  : "destination_postal_code must be valid.",
            }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }
      }

      if (
        !hasDestinationAreaId &&
        !hasDestinationPostalCode &&
        !hasDestinationCoordinates(ratesPayload)
      ) {
        return new Response(
          JSON.stringify({
            error:
              "Missing destination location for rates. Provide destination_area_id or destination_postal_code for standard couriers, or destination_latitude and destination_longitude for instant couriers. Check addresses.postal_code/subdistrict mapping.",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      if (!enabledCouriers) {
        return createBiteshipConfigErrorResponse([
          "biteship.enabled_couriers current version missing or empty",
        ]);
      }

      const requestedCouriers = enabledCouriers;

      const ratesRequestResult = buildRatesRequestPayloads(
        settings!,
        ratesPayload,
        requestedCouriers,
      );

      if (ratesRequestResult.requests.length === 0) {
        const emptyRatesResponse = buildMergedRatesResponse(
          [],
          [],
          ratesRequestResult.skipped,
        );
        return new Response(JSON.stringify(emptyRatesResponse.body), {
          status: emptyRatesResponse.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const endpoint = "/v1/rates/couriers";
      const biteshipUrl = `${BITESHIP_API_URL}${endpoint}`;
      let authKey: string;
      try {
        authKey = await resolveAuthHeader(getAdminClientOnce());
      } catch (error: unknown) {
        if (isBiteshipRuntimeConfigError(error)) {
          return createBiteshipConfigErrorResponse(
            ["Biteship runtime config unavailable"],
          );
        }

        throw error;
      }

      const successfulRateResponses: RatesExecutionSuccess[] = [];
      const failedRateResponses: RatesExecutionFailure[] = [];

      for (const rateRequest of ratesRequestResult.requests) {
        console.log(
          `[biteship] rates ${rateRequest.group} payload:`,
          JSON.stringify(getLoggablePayload(rateRequest.payload)),
        );
        console.log(`[biteship] Calling: POST ${biteshipUrl}`);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        try {
          const biteshipResponse = await fetchFn(biteshipUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              authorization: authKey,
            },
            body: JSON.stringify(rateRequest.payload),
            signal: controller.signal,
          });

          const rateResponseData: unknown = await biteshipResponse.json();

          if (!biteshipResponse.ok) {
            console.error(
              `[biteship] Biteship API error — action: rates, group: ${rateRequest.group}, status: ${biteshipResponse.status}, payload: ${JSON.stringify(getLoggablePayload(rateRequest.payload))}, body: ${JSON.stringify(rateResponseData)}`,
            );
            failedRateResponses.push({
              group: rateRequest.group,
              couriers: rateRequest.couriers,
              status: biteshipResponse.status,
              error: rateResponseData,
            });
            continue;
          }

          successfulRateResponses.push({
            group: rateRequest.group,
            couriers: rateRequest.couriers,
            status: biteshipResponse.status,
            data: filterRatesByEnabledServices(rateResponseData, settings!),
          });
        } catch (error: unknown) {
          const isAbortError =
            error instanceof DOMException && error.name === "AbortError";
          failedRateResponses.push({
            group: rateRequest.group,
            couriers: rateRequest.couriers,
            status: isAbortError ? 504 : 502,
            error: isAbortError
              ? "Biteship rates request timed out."
              : error instanceof Error
                ? error.message
                : "Biteship rates request failed.",
          });
        } finally {
          clearTimeout(timeout);
        }
      }

      const mergedRateResponse = buildMergedRatesResponse(
        successfulRateResponses,
        failedRateResponses,
        ratesRequestResult.skipped,
      );
      return new Response(JSON.stringify(mergedRateResponse.body), {
        status: mergedRateResponse.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "create_order") {
      try {
        assertCompleteStoreSettings(settings!);
      } catch (error: unknown) {
        return new Response(
          JSON.stringify({
            error:
              error instanceof Error
                ? error.message
                : "Missing shop shipper configuration.",
          }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const safePayload = isRecord(requestPayload) ? requestPayload : {};
      const courierCompany = getNestedString(safePayload, ["courier_company"]);
      const courierType = getNestedString(safePayload, ["courier_type"]);
      if (
        courierCompany &&
        courierType &&
        !isCourierServiceEnabled(settings!, courierCompany, courierType)
      ) {
        return new Response(
          JSON.stringify({
            error: "Selected courier service is disabled in settings.",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      requestPayload = withServerShipperAndOriginFields(safePayload, settings!);
    }

    if (action === "draft_order") {
      try {
        assertCompleteStoreSettings(settings!);
      } catch (error: unknown) {
        return new Response(
          JSON.stringify({
            error:
              error instanceof Error
                ? error.message
                : "Missing shipping configuration.",
          }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const safePayload = isRecord(requestPayload) ? requestPayload : {};
      requestPayload = {
        items: [],
        ...withServerShipperAndOriginFields(safePayload, settings!),
      };
    }

    switch (action) {
      case "rates":
        endpoint = "/v1/rates/couriers";
        break;
      case "draft_order":
        endpoint = "/v1/draft_orders";
        break;
      case "create_order":
        endpoint = "/v1/orders";
        break;
      case "track":
        endpoint = buildTrackingEndpoint(
          typeof payload?.tracking_id === "string" ? payload.tracking_id : "",
        );
        method = "GET";
        break;
      case "track_public": {
        endpoint = buildPublicTrackingEndpoint(
          typeof requestPayload?.waybill_id === "string"
            ? requestPayload.waybill_id
            : "",
          typeof requestPayload?.courier_code === "string"
            ? requestPayload.courier_code
            : "",
        );
        method = "GET";
        break;
      }
      case "maps": {
        // Validate input before building URL
        const validation = validateMapsInput(payload?.input);
        if (!validation.valid) {
          return new Response(JSON.stringify({ error: validation.error }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        endpoint = `/v1/maps/areas?input=${encodeURIComponent(validation.sanitized!)}&type=single`;
        method = "GET";
        break;
      }
      case "couriers":
        endpoint = "/v1/couriers";
        method = "GET";
        break;
      default:
        return new Response(
          JSON.stringify({ error: "Invalid action specified" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
    }

    const biteshipUrl = `${BITESHIP_API_URL}${endpoint}`;
    let authKey: string;
    try {
      authKey = await resolveAuthHeader(getAdminClientOnce());
    } catch (error: unknown) {
      if (isBiteshipRuntimeConfigError(error)) {
        return createBiteshipConfigErrorResponse(
          ["Biteship runtime config unavailable"],
        );
      }

      throw error;
    }

    const fetchOptions: RequestInit = {
      method: method,
      headers: {
        "Content-Type": "application/json",
        authorization: authKey,
      },
    };

    if (method !== "GET" && requestPayload) {
      fetchOptions.body = JSON.stringify(requestPayload);
    }

    if (action === "rates") {
      console.log(
        "[biteship] rates payload:",
        JSON.stringify(getLoggablePayload(requestPayload)),
      );
    }

    console.log(`[biteship] Calling: ${method} ${biteshipUrl}`);

    // 8. Add timeout to prevent hanging
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    fetchOptions.signal = controller.signal;

    const biteshipResponse = await fetchFn(biteshipUrl, fetchOptions);
    clearTimeout(timeout);

    const data: unknown = await biteshipResponse.json();

    if (!biteshipResponse.ok) {
      console.error(
        `[biteship] Biteship API error — action: ${action}, status: ${biteshipResponse.status}, payload: ${JSON.stringify(getLoggablePayload(requestPayload))}, body: ${JSON.stringify(data)}`,
      );
      return new Response(JSON.stringify({ error: data }), {
        status: biteshipResponse.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let responseData = data;
    if (action === "create_order") {
      const biteshipOrderId = getNestedString(data, ["id"]);
      const waybillId = getNestedString(data, ["courier", "waybill_id"]);
      const trackingId = getNestedString(data, ["courier", "tracking_id"]);

      responseData = {
        ...(isRecord(data) ? data : {}),
        biteship_order_id: biteshipOrderId,
        waybill_id: waybillId,
        waybill_number: waybillId,
        tracking_id: trackingId,
      };

      if (requestPayload?.order_id && biteshipOrderId) {
        const adminClient = getAdminClientOnce();
        try {
          await persistBiteshipShipment(adminClient, {
            orderId: String(requestPayload.order_id),
            biteshipOrderId,
            trackingId,
            waybillNumber: waybillId,
            actorType: "system",
            metadata: {
              source: "biteship_proxy",
              tracking_id: trackingId,
            },
          });
        } catch {
          return new Response(
            JSON.stringify({
              error: "Failed to update order shipping details",
            }),
            {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }
      }
    }

    if (action === "couriers") {
      const couriers =
        isRecord(data) && Array.isArray(data.couriers) ? data.couriers : [];
      return new Response(JSON.stringify(couriers), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "rates") {
      responseData = filterRatesByEnabledServices(responseData, settings!);
    }

    return new Response(JSON.stringify(responseData), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";

      // Log full error internally for debugging
      console.error("[biteship] Internal error:", {
        message,
        error: String(error),
      });

      // Return generic error message to client - never leak internal error details
      return new Response(JSON.stringify({ error: "Internal server error" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }
  };
}
