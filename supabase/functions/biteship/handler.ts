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
import { resolveRequestId, withRequestIdResponse } from "../_shared/request-id.ts";
import type { RuntimeConfigAdminClient } from "../_shared/runtime-config.ts";

const BITESHIP_API_URL = "https://api.biteship.com";
const BITESHIP_CONFIG_INCOMPLETE = "BITESHIP_CONFIG_INCOMPLETE";
const DRAFT_ORDER_AUTHORIZATION_ERROR = "Unauthorized";
const BITESHIP_PROVIDER_UNAVAILABLE = "BITESHIP_PROVIDER_UNAVAILABLE";

declare const Deno:
  | { env: { get: (key: string) => string | undefined } }
  | undefined;

export interface BiteshipAdminClient extends RuntimeConfigAdminClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

function getProviderCode(data: unknown): string {
  if (!isRecord(data)) {
    return "";
  }

  const code = data.code;
  if (typeof code === "number" && Number.isFinite(code)) {
    return String(code);
  }

  return typeof code === "string" ? code.trim() : "";
}

function isCourierTrackingUnavailable(data: unknown): boolean {
  return ["40003001", "40003002"].includes(getProviderCode(data));
}

function createPublicTrackingUnavailableResponse(
  requestPayload: Record<string, unknown> | undefined,
): Response {
  const trackingId =
    typeof requestPayload?.tracking_id === "string"
      ? requestPayload.tracking_id.trim()
      : "";
  const waybillId =
    typeof requestPayload?.waybill_id === "string"
      ? requestPayload.waybill_id.trim()
      : "";
  const courierCode =
    typeof requestPayload?.courier_code === "string"
      ? requestPayload.courier_code.trim()
      : "";
  const orderId =
    typeof requestPayload?.order_id === "string"
      ? requestPayload.order_id.trim()
      : undefined;

  return new Response(
    JSON.stringify({
      id: trackingId || waybillId,
      waybill_id: waybillId,
      status: "confirmed",
      message: "Courier tracking is not available yet.",
      tracking_unavailable: true,
      order_id: orderId,
      courier: { company: courierCode || "unknown" },
      history: [],
    }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
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

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
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

function createDraftOrderAuthorizationErrorResponse(): Response {
  return new Response(JSON.stringify({ error: DRAFT_ORDER_AUTHORIZATION_ERROR }), {
    status: 403,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function createBiteshipProviderErrorResponse(status: number): Response {
  return new Response(
    JSON.stringify({ error: BITESHIP_PROVIDER_UNAVAILABLE, status }),
    {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}

function getSafeBiteshipEndpointLabel(action: string, endpoint: string): string {
  switch (action) {
    case "rates":
      return "/v1/rates/couriers";
    case "maps":
      return "/v1/maps/areas";
    case "track":
      return "/v1/track";
    case "track_public":
      return "/v1/public-track";
    case "draft_order":
      return "/v1/draft_orders";
    case "create_order":
      return "/v1/orders";
    case "couriers":
      return "/v1/couriers";
    default: {
      const [pathOnly] = endpoint.split("?", 1);
      return pathOnly || "unknown";
    }
  }
}

function getServiceRoleKey(): string {
  if (typeof Deno === "undefined") {
    return "";
  }

  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ?? "";
}

function isServiceRoleBearerToken(token: string): boolean {
  const serviceRoleKey = getServiceRoleKey();
  return serviceRoleKey.length > 0 && token === serviceRoleKey;
}

async function loadCallerProfileRole(
  adminClient: BiteshipAdminClient,
  userId: string,
): Promise<string | null> {
  const { data, error } = await adminClient
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();

  if (error || !isRecord(data)) {
    return null;
  }

  return typeof data.role === "string" ? data.role : null;
}

async function canCreateDraftOrder(
  adminClient: BiteshipAdminClient,
  userId: string,
  isServiceRoleBearer: boolean,
): Promise<boolean> {
  if (isServiceRoleBearer) {
    return true;
  }

  const role = await loadCallerProfileRole(adminClient, userId);
  return role === "admin";
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
    const requestId = resolveRequestId(req.headers);

    const handleRequest = async (): Promise<Response> => {
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

    const isServiceRoleBearer = isServiceRoleBearerToken(token);
    let userId = "";
    if (!isServiceRoleBearer) {
      try {
        userId = await verifyUserId(token);
        if (!userId) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } catch {
        console.error("[biteship] jwt_verification_failed", {
          action: "authenticate_request",
          errorCategory: "unauthorized",
          requestId,
        });
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
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
    const isDraftOrderAction = action === "draft_order";
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

    if (isServiceRoleBearer && !isDraftOrderAction) {
      return createDraftOrderAuthorizationErrorResponse();
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
        .select("id, user_id, biteship_tracking_id, waybill_number, courier_code, status")
        .eq("id", orderId)
        .eq("user_id", userId)
        .single();

      if (orderError || !order) {
        return new Response(JSON.stringify({ error: "Order not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const trackingId =
        typeof order.biteship_tracking_id === "string"
          ? order.biteship_tracking_id.trim()
          : "";

      if (trackingId) {
        const waybillId =
          typeof order.waybill_number === "string"
            ? order.waybill_number.trim()
            : "";
        const courierCode =
          typeof order.courier_code === "string" ? order.courier_code.trim() : "";

        publicTrackingPayload = {
          order_id: order.id,
          tracking_id: trackingId,
          waybill_id: waybillId,
          courier_code: courierCode,
        };
      } else {
        const waybillId =
          typeof order.waybill_number === "string"
            ? order.waybill_number.trim()
            : "";
        const courierCode =
          typeof order.courier_code === "string" ? order.courier_code.trim() : "";

        if (!waybillId) {
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

        if (!courierCode) {
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
          waybill_id: waybillId,
          courier_code: courierCode,
        };
      }
    }

    if (isDraftOrderAction) {
      const isAuthorized = await canCreateDraftOrder(
        getAdminClientOnce(),
        userId,
        isServiceRoleBearer,
      );

      if (!isAuthorized) {
        return createDraftOrderAuthorizationErrorResponse();
      }
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
    const needsRuntimeSettings = isRatesAction || isDraftOrderAction;

    if (needsRuntimeSettings) {
      try {
        runtimeSettings = await resolveRuntimeSettings(getAdminClientOnce());
      } catch {
        console.error("[biteship] biteship_runtime_settings_unavailable", {
          action: "resolve_runtime_settings",
          errorCategory: "runtime_config_unavailable",
          requestId,
        });
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
        console.log("[biteship] provider_call", {
          action: "rates",
          endpoint: getSafeBiteshipEndpointLabel("rates", endpoint),
          group: rateRequest.group,
          method: "POST",
          provider: "biteship",
          requestId,
        });

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
            console.error("[biteship] biteship_provider_unavailable", {
              action: "rates",
              group: rateRequest.group,
              requestId,
              status: biteshipResponse.status,
              responseType: isRecord(rateResponseData) ? "object" : typeof rateResponseData,
            });
            failedRateResponses.push({
              group: rateRequest.group,
              couriers: rateRequest.couriers,
              status: biteshipResponse.status,
              error: BITESHIP_PROVIDER_UNAVAILABLE,
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
          failedRateResponses.push({
            group: rateRequest.group,
            couriers: rateRequest.couriers,
            status: isAbortError(error) ? 504 : 502,
            error: isAbortError(error)
              ? "Biteship rates request timed out."
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

    if (isDraftOrderAction) {
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
        const trackingId =
          typeof requestPayload?.tracking_id === "string"
            ? requestPayload.tracking_id.trim()
            : "";
        endpoint = trackingId
          ? buildTrackingEndpoint(trackingId)
          : buildPublicTrackingEndpoint(
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

    console.log("[biteship] provider_call", {
      action,
      endpoint: getSafeBiteshipEndpointLabel(action, endpoint),
      method,
      provider: "biteship",
      requestId,
    });

    // 8. Add timeout to prevent hanging
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    fetchOptions.signal = controller.signal;

    let biteshipResponse: Response;
    try {
      biteshipResponse = await fetchFn(biteshipUrl, fetchOptions);
    } catch (error: unknown) {
      if (isAbortError(error)) {
        console.error("[biteship] biteship_provider_unavailable", {
          action,
          errorCategory: "provider_timeout",
          requestId,
          status: 504,
        });
        return createBiteshipProviderErrorResponse(504);
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }

    const data: unknown = await biteshipResponse.json();

    if (!biteshipResponse.ok) {
      if (
        action === "track_public" &&
        biteshipResponse.status === 400 &&
        isCourierTrackingUnavailable(data)
      ) {
        console.warn("[biteship] public_tracking_unavailable", {
          action,
          errorCategory: "tracking_not_ready",
          requestId,
          status: biteshipResponse.status,
        });
        return createPublicTrackingUnavailableResponse(requestPayload);
      }

      console.error("[biteship] biteship_provider_unavailable", {
        action,
        requestId,
        status: biteshipResponse.status,
        responseType: isRecord(data) ? "object" : typeof data,
      });
      return createBiteshipProviderErrorResponse(biteshipResponse.status);
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

    if (action === "track_public" && isRecord(data)) {
      const providerWaybillId = getNestedString(data, ["waybill_id"])?.trim();
      const fallbackWaybillId =
        getNestedString(data, ["waybill"])?.trim() ||
        (typeof requestPayload?.waybill_id === "string"
          ? requestPayload.waybill_id.trim()
          : "");

      if (!providerWaybillId && fallbackWaybillId) {
        responseData = {
          ...data,
          waybill_id: fallbackWaybillId,
        };
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
    } catch (_error: unknown) {
      console.error("[biteship] internal_error", {
        action: "request_failed",
        errorCategory: "unexpected_failure",
        requestId,
      });

      return new Response(JSON.stringify({ error: "Internal server error" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }
    };

    return withRequestIdResponse(await handleRequest(), requestId);
  };
}
