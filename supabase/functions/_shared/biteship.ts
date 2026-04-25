import { buildBiteshipOrderDestinationFields } from "./biteship-order-helpers.ts";
import { shouldUseInstantBiteshipContract } from "./biteship-courier-contract.ts";
import { parseBiteshipPostalCode, tryParseBiteshipPostalCode } from "./biteship-postal-code.ts";
import { buildOrderEndpoint } from "./biteship-public-tracking.ts";
import { getPersistedBiteshipShipmentStatus } from "./order-status.ts";
import type { Order, OrderItem } from "./types.ts";

interface BiteshipOrderItem {
  name: string;
  description?: string;
  value: number;
  quantity: number;
  weight: number;
  category?: string;
  height?: number;
  length?: number;
  width?: number;
}

type BiteshipOrderPayloadDestination =
  | {
      destination_coordinate: { latitude: number; longitude: number };
      destination_area_id?: never;
      destination_postal_code?: never;
    }
  | {
      destination_area_id: string;
      destination_postal_code?: number;
    }
  | {
      destination_area_id?: string;
      destination_postal_code: number;
    };

type BiteshipOrderPayload = {
  shipper_contact_name: string;
  shipper_contact_phone: string;
  shipper_contact_email: string;
  shipper_organization: string;
  origin_contact_name: string;
  origin_contact_phone: string;
  origin_address: string;
  origin_area_id?: string;
  origin_postal_code?: number;
  origin_coordinate?: { latitude: number; longitude: number };
  destination_contact_name: string;
  destination_contact_phone: string;
  destination_address: string;
  destination_note?: string;
  destination_coordinate?: { latitude: number; longitude: number };
  courier_company: string;
  courier_type: string;
  delivery_type: "now" | "scheduled";
  delivery_date?: string;
  delivery_time?: string;
  items: BiteshipOrderItem[];
  metadata?: Record<string, unknown>;
  reference_id?: string;
} & BiteshipOrderPayloadDestination;

interface BiteshipCourierInfo {
  tracking_id: string;
  waybill_id: string;
  company: string;
  type: string;
}

interface BiteshipOrderResponse {
  success: boolean;
  id: string;
  status: string;
  courier: BiteshipCourierInfo;
}

interface BiteshipApiErrorResponse {
  message?: string;
  error?: string;
  code?: number;
  details?: {
    order_id?: string;
  };
}

export interface StoreSettings {
  store_name: string;
  phone_number: string;
  email: string;
  organization: string;
  store_address: string;
  enabled_couriers: string | null;
  origin_postal_code: string | null;
  origin_latitude: number | null;
  origin_longitude: number | null;
  origin_area_id: string | null;
}

export type ShippingActivityActorType = "admin" | "system";

interface PersistBiteshipShipmentParams {
  orderId: string;
  biteshipOrderId: string;
  trackingId?: string | null;
  waybillNumber?: string | null;
  shipmentStatus?: string | null;
  actorType: ShippingActivityActorType;
  actorId?: string | null;
  originAreaId?: string | null;
  metadata?: Record<string, unknown>;
}

interface SupabaseMutationResult {
  error: unknown | null;
}

interface BiteshipShipmentAdminClient {
  from(table: "shipments"): {
    upsert: (
      payload: Record<string, unknown>,
      options: { onConflict: string },
    ) => Promise<SupabaseMutationResult>;
  };
  from(table: "order_activities"): {
    insert: (payload: Record<string, unknown>) => Promise<SupabaseMutationResult>;
  };
}

async function getSupabaseAdminClient() {
  const supabaseModule = await import("./supabase.ts");

  return supabaseModule.getSupabaseAdminClient();
}

function normalizeStorePostalCode(value: unknown): string | null {
  if (typeof value === "string" || typeof value === "number") {
    const parsedValue = tryParseBiteshipPostalCode(value, "origin_postal_code");
    return parsedValue === null ? null : String(parsedValue);
  }

  return null;
}

function normalizeStoreCoordinate(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const normalizedValue = value.trim();
    if (!normalizedValue) {
      return null;
    }

    const parsedValue = Number(normalizedValue);
    return Number.isFinite(parsedValue) ? parsedValue : null;
  }

  return null;
}

function hasStoreOriginPostalCode(settings: StoreSettings): boolean {
  return normalizeStorePostalCode(settings.origin_postal_code) !== null;
}

export function getRequiredStoreOriginPostalCode(
  settings: StoreSettings,
): string {
  const originPostalCode = normalizeStorePostalCode(
    settings.origin_postal_code,
  );
  if (!originPostalCode) {
    throw new Error(
      "Missing origin_postal_code in settings table. Configure a valid 5-digit Indonesian shipping origin postal code before creating Biteship orders.",
    );
  }

  return originPostalCode;
}

function hasStoreOriginCoordinates(settings: StoreSettings): boolean {
  return (
    settings.origin_latitude !== null && settings.origin_longitude !== null
  );
}

export function assertStoreSettingsHaveRateOrigin(
  settings: StoreSettings,
): void {
  if (
    settings.origin_area_id ||
    hasStoreOriginCoordinates(settings) ||
    hasStoreOriginPostalCode(settings)
  ) {
    return;
  }

  throw new Error(
    "Missing shipping origin configuration. Set origin_area_id, origin coordinates, or origin_postal_code in settings table.",
  );
}

interface EnabledCourierServiceSelection {
  companyCode: string;
  serviceCode: string | "*";
}

interface BiteshipRatePricing {
  courier_code?: string;
  courier_service_code?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeEnabledCourierSelection(
  value: string,
): EnabledCourierServiceSelection | null {
  const trimmedValue = value.trim().toLowerCase();
  if (!trimmedValue) {
    return null;
  }

  const [companyCode, ...serviceParts] = trimmedValue.split(":");
  const normalizedCompanyCode = companyCode.trim();
  if (!normalizedCompanyCode) {
    return null;
  }

  if (serviceParts.length === 0) {
    return { companyCode: normalizedCompanyCode, serviceCode: "*" };
  }

  const normalizedServiceCode = serviceParts.join(":").trim();
  if (!normalizedServiceCode) {
    return null;
  }

  return {
    companyCode: normalizedCompanyCode,
    serviceCode: normalizedServiceCode,
  };
}

function parseEnabledCourierServices(
  value: string | null | undefined,
): EnabledCourierServiceSelection[] {
  if (!value) {
    return [];
  }

  const selections = new Map<string, EnabledCourierServiceSelection>();
  for (const rawSelection of value.split(",")) {
    const normalizedSelection = normalizeEnabledCourierSelection(rawSelection);
    if (!normalizedSelection) {
      continue;
    }

    const selectionKey = `${normalizedSelection.companyCode}:${normalizedSelection.serviceCode}`;
    selections.set(selectionKey, normalizedSelection);
  }

  return Array.from(selections.values());
}

function serializeEnabledCourierServices(
  selections: EnabledCourierServiceSelection[],
): string | null {
  if (selections.length === 0) {
    return null;
  }

  return selections
    .map((selection) =>
      selection.serviceCode === "*"
        ? selection.companyCode
        : `${selection.companyCode}:${selection.serviceCode}`,
    )
    .join(",");
}

export function getEnabledCouriers(settings: StoreSettings): string {
  const selections = parseEnabledCourierServices(settings.enabled_couriers);
  if (selections.length === 0) {
    return "";
  }

  return Array.from(
    new Set(selections.map((selection) => selection.companyCode)),
  ).join(",");
}

export function filterRatesByEnabledServices(
  responseData: unknown,
  settings: StoreSettings,
): unknown {
  const enabledSelections = parseEnabledCourierServices(
    settings.enabled_couriers,
  );
  if (!isRecord(responseData) || !Array.isArray(responseData.pricing)) {
    return responseData;
  }

  if (enabledSelections.length === 0) {
    return {
      ...responseData,
      pricing: [],
    };
  }

  const allowedServicesByCompany = new Map<string, Set<string>>();
  for (const selection of enabledSelections) {
    const companyServices =
      allowedServicesByCompany.get(selection.companyCode) ?? new Set<string>();
    companyServices.add(selection.serviceCode);
    allowedServicesByCompany.set(selection.companyCode, companyServices);
  }

  const filteredPricing = responseData.pricing.filter((item: unknown) => {
    if (!isRecord(item)) {
      return false;
    }

    const pricing = item as BiteshipRatePricing;
    const companyCode = pricing.courier_code?.trim().toLowerCase();
    const serviceCode = pricing.courier_service_code?.trim().toLowerCase();
    if (!companyCode || !serviceCode) {
      return false;
    }

    const allowedServices = allowedServicesByCompany.get(companyCode);
    if (!allowedServices) {
      return false;
    }

    return allowedServices.has("*") || allowedServices.has(serviceCode);
  });

  return {
    ...responseData,
    pricing: filteredPricing,
  };
}

export function isCourierServiceEnabled(
  settings: StoreSettings,
  companyCode: string | null | undefined,
  serviceCode: string | null | undefined,
): boolean {
  const normalizedCompanyCode = companyCode?.trim().toLowerCase();
  const normalizedServiceCode = serviceCode?.trim().toLowerCase();
  if (!normalizedCompanyCode || !normalizedServiceCode) {
    return false;
  }

  const enabledSelections = parseEnabledCourierServices(
    settings.enabled_couriers,
  );
  if (enabledSelections.length === 0) {
    return false;
  }

  return enabledSelections.some((selection) => {
    return (
      selection.companyCode === normalizedCompanyCode &&
      (selection.serviceCode === "*" ||
        selection.serviceCode === normalizedServiceCode)
    );
  });
}

export function assertCompleteStoreSettings(settings: StoreSettings): void {
  if (
    !settings.store_name ||
    !settings.phone_number ||
    !settings.email ||
    !settings.organization ||
    !settings.store_address
  ) {
    throw new Error(
      "Missing shop shipper configuration. Ensure store_name, phone_number, email, organization, and store_address are set in settings table.",
    );
  }

  getRequiredStoreOriginPostalCode(settings);
}

function assertCompleteStoreShipperSettings(settings: StoreSettings): void {
  if (
    !settings.store_name ||
    !settings.phone_number ||
    !settings.email ||
    !settings.organization ||
    !settings.store_address
  ) {
    throw new Error(
      "Missing shop shipper configuration. Ensure store_name, phone_number, email, organization, and store_address are set in settings table.",
    );
  }
}

function getStoreOriginCoordinates(settings: StoreSettings): {
  latitude: number;
  longitude: number;
} | null {
  if (
    typeof settings.origin_latitude !== "number" ||
    !Number.isFinite(settings.origin_latitude) ||
    typeof settings.origin_longitude !== "number" ||
    !Number.isFinite(settings.origin_longitude)
  ) {
    return null;
  }

  return {
    latitude: settings.origin_latitude,
    longitude: settings.origin_longitude,
  };
}

function getStandardOrderOriginFields(
  settings: StoreSettings,
): { origin_area_id: string } | { origin_postal_code: number } {
  const originAreaId = settings.origin_area_id?.trim() ?? "";
  if (originAreaId) {
    return { origin_area_id: originAreaId };
  }

  return {
    origin_postal_code: parseBiteshipPostalCode(
      getRequiredStoreOriginPostalCode(settings),
      "origin_postal_code",
    ),
  };
}

function getInstantOrderOriginFields(settings: StoreSettings): {
  origin_coordinate: { latitude: number; longitude: number };
} {
  const originCoordinates = getStoreOriginCoordinates(settings);
  if (!originCoordinates) {
    throw new Error(
      "Origin coordinate is required for instant Biteship orders. Configure origin_latitude and origin_longitude in settings table before creating instant courier orders.",
    );
  }

  return { origin_coordinate: originCoordinates };
}

export function shouldUseInstantBiteshipOrderContract(order: Order): boolean {
  return shouldUseInstantBiteshipContract(
    order.courier_code,
    order.courier_service,
  );
}

export function getStandardBiteshipShipmentOriginAreaId(
  order: Order,
  settings: StoreSettings,
): string | null {
  if (shouldUseInstantBiteshipOrderContract(order)) {
    return null;
  }

  return settings.origin_area_id?.trim() || null;
}

function getRequiredOrderItemName(
  item: OrderItem,
  orderId: string,
  itemIndex: number,
): string {
  const productName = item.products?.name?.trim();

  if (!productName) {
    throw new Error(
      `Missing product name for item ${itemIndex + 1} in order ${orderId}. Product name is required before creating a Biteship order.`,
    );
  }

  return productName;
}

function getRequiredOrderItemWeight(
  item: OrderItem,
  orderId: string,
  itemIndex: number,
): number {
  const rawWeight = item.products?.weight;
  const parsedWeight = Number(rawWeight);

  if (!Number.isFinite(parsedWeight) || parsedWeight <= 0) {
    const productName = item.products?.name?.trim() || `Item ${itemIndex + 1}`;
    throw new Error(
      `Missing product weight for "${productName}" in order ${orderId}. Set a product weight greater than 0 gram before creating a Biteship order.`,
    );
  }

  return parsedWeight;
}

export async function getStoreSettings(): Promise<StoreSettings> {
  const adminClient = await getSupabaseAdminClient();
  const { data, error } = await adminClient
    .from("settings")
    .select(
      "store_name, phone_number, email, organization, store_address, enabled_couriers, origin_postal_code, origin_latitude, origin_longitude, origin_area_id",
    )
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    console.error("[getStoreSettings] Database error:", error);
    throw new Error(`Failed to fetch store settings: ${error.message}`);
  }

  if (!data) {
    throw new Error("Store settings not found (expected row with id=1)");
  }

  return {
    store_name: data.store_name || "",
    phone_number: data.phone_number || "",
    email: data.email || "",
    organization: data.organization || "",
    store_address: data.store_address || "",
    enabled_couriers: serializeEnabledCourierServices(
      parseEnabledCourierServices(data.enabled_couriers),
    ),
    origin_postal_code: normalizeStorePostalCode(data.origin_postal_code),
    origin_latitude: normalizeStoreCoordinate(data.origin_latitude),
    origin_longitude: normalizeStoreCoordinate(data.origin_longitude),
    origin_area_id: data.origin_area_id,
  };
}

export async function persistBiteshipShipment(
  adminClient: BiteshipShipmentAdminClient,
  params: PersistBiteshipShipmentParams,
): Promise<void> {
  const normalizedTrackingId = params.trackingId?.trim() || null;
  const normalizedWaybillNumber = params.waybillNumber?.trim() || null;
  const shipmentPayload: Record<string, unknown> = {
    order_id: params.orderId,
    provider: "biteship",
    status: getPersistedBiteshipShipmentStatus(params.shipmentStatus),
    biteship_order_id: params.biteshipOrderId,
    biteship_tracking_id: normalizedTrackingId,
    latest_biteship_payload: params.metadata ?? {},
    updated_at: new Date().toISOString(),
  };

  if (normalizedWaybillNumber) {
    shipmentPayload.waybill_number = normalizedWaybillNumber;
    shipmentPayload.waybill_source = "system";
  }

  const normalizedOriginAreaId = params.originAreaId?.trim() || null;
  if (normalizedOriginAreaId) {
    shipmentPayload.origin_area_id = normalizedOriginAreaId;
  }

  const { error: updateError } = await adminClient
    .from("shipments")
    .upsert(shipmentPayload, { onConflict: "order_id" });

  if (updateError) {
    throw updateError;
  }

  const activityPayload: Record<string, unknown> = {
    order_id: params.orderId,
    action: "shipping_created",
    actor_type: params.actorType,
    metadata: {
      biteship_order_id: params.biteshipOrderId,
      tracking_id: normalizedTrackingId,
      waybill_number: normalizedWaybillNumber,
      waybill_source: normalizedWaybillNumber ? "system" : null,
      ...(params.metadata ?? {}),
    },
  };

  if (params.actorType === "admin" && params.actorId) {
    activityPayload.actor_id = params.actorId;
  }

  const { error: activityError } = await adminClient
    .from("order_activities")
    .insert(activityPayload);

  if (activityError) {
    console.error("[biteship] Failed to log shipping activity:", activityError);
  }
}

function assertBiteshipOrderMatchesRequest(
  order: Order,
  biteshipOrder: BiteshipOrderResponse,
): void {
  const responseCompany = biteshipOrder.courier?.company?.trim().toLowerCase();
  const responseService = biteshipOrder.courier?.type?.trim().toLowerCase();
  const requestedCompany = order.courier_code?.trim().toLowerCase();
  const requestedService = order.courier_service?.trim().toLowerCase();

  if (
    requestedCompany &&
    responseCompany &&
    requestedCompany !== responseCompany
  ) {
    throw new Error(
      `Biteship duplicate reference returned courier company ${responseCompany}, expected ${requestedCompany}`,
    );
  }

  if (
    requestedService &&
    responseService &&
    requestedService !== responseService
  ) {
    throw new Error(
      `Biteship duplicate reference returned courier service ${responseService}, expected ${requestedService}`,
    );
  }
}

async function retrieveBiteshipOrder(
  orderId: string,
  authKey: string,
): Promise<BiteshipOrderResponse> {
  const response = await fetch(
    `https://api.biteship.com${buildOrderEndpoint(orderId)}`,
    {
      method: "GET",
      headers: {
        Authorization: authKey,
      },
    },
  );

  const result = (await response.json()) as BiteshipOrderResponse &
    BiteshipApiErrorResponse;

  if (!response.ok) {
    throw new Error(
      result.message || result.error || "Failed to retrieve Biteship order",
    );
  }

  return result;
}

export function buildBiteshipOrderPayload(
  order: Order,
  settings: StoreSettings,
): BiteshipOrderPayload {
  if (!order.courier_code) throw new Error("Missing courier_code on order");
  if (!order.courier_service)
    throw new Error("Missing courier_service on order");

  const usesInstantContract = shouldUseInstantBiteshipOrderContract(order);
  if (
    !usesInstantContract &&
    !order.destination_area_id &&
    !order.destination_postal_code
  ) {
    throw new Error(
      "Missing destination_area_id and destination_postal_code on order",
    );
  }

  assertCompleteStoreShipperSettings(settings);
  if (
    !isCourierServiceEnabled(
      settings,
      order.courier_code,
      order.courier_service,
    )
  ) {
    throw new Error(
      `Disabled courier service: ${order.courier_code}:${order.courier_service}`,
    );
  }
  const shipperName = settings.store_name;
  const shipperPhone = settings.phone_number;
  const shipperEmail = settings.email;
  const shipperOrganization = settings.organization;
  const shopAddress = settings.store_address;
  const originFields = usesInstantContract
    ? getInstantOrderOriginFields(settings)
    : getStandardOrderOriginFields(settings);

  const items: BiteshipOrderItem[] = (order.order_items || []).map(
    (item: OrderItem, index: number): BiteshipOrderItem => ({
      name: getRequiredOrderItemName(item, order.id, index),
      description: item.products?.description || "",
      value: Math.round(Number(item.price_at_purchase)),
      quantity: Number(item.quantity),
      weight: getRequiredOrderItemWeight(item, order.id, index),
    }),
  );
  const destinationFields = buildBiteshipOrderDestinationFields(order);

  const payload: BiteshipOrderPayload = {
    shipper_contact_name: shipperName,
    shipper_contact_phone: shipperPhone,
    shipper_contact_email: shipperEmail,
    shipper_organization: shipperOrganization,
    origin_contact_name: shipperName,
    origin_contact_phone: shipperPhone,
    origin_address: shopAddress,
    ...originFields,

    ...destinationFields,

    courier_company: order.courier_code,
    courier_type: order.courier_service,
    delivery_type: "now",
    items: items,
    reference_id: order.midtrans_order_id || order.id,
    metadata: {
      order_id: order.id,
      midtrans_order_id: order.midtrans_order_id || null,
      source: "webhook_side_effects",
    },
  };

  return payload;
}

export const createBiteshipOrder = async (
  order: Order,
  apiKey: string,
): Promise<BiteshipOrderResponse> => {
  const BITESHIP_BASE_URL = "https://api.biteship.com/v1";
  const settings = await getStoreSettings();
  const payload = buildBiteshipOrderPayload(order, settings);

  console.log(`[biteship] Creating order for order ${order.id}`);

  const authPrefix =
    apiKey.startsWith("biteship_live.") || apiKey.startsWith("biteship_test.")
      ? ""
      : "biteship_test.";
  const authKey = `${authPrefix}${apiKey}`;

  const response = await fetch(`${BITESHIP_BASE_URL}/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authKey,
    },
    body: JSON.stringify(payload),
  });

  const result = (await response.json()) as BiteshipOrderResponse &
    BiteshipApiErrorResponse;

  if (!response.ok) {
    console.error(`[biteship] API Error:`, JSON.stringify(result));

    if (result.code === 40002060 && result.details?.order_id) {
      console.warn(
        `[biteship] Reusing existing order for duplicate reference_id on order ${order.id}`,
      );
      const existingOrder = await retrieveBiteshipOrder(
        result.details.order_id,
        authKey,
      );
      assertBiteshipOrderMatchesRequest(order, existingOrder);
      return existingOrder;
    }

    throw new Error(
      result.message || result.error || "Failed to create Biteship order",
    );
  }

  const biteshipOrder = result as BiteshipOrderResponse;
  assertBiteshipOrderMatchesRequest(order, biteshipOrder);
  return biteshipOrder;
};
