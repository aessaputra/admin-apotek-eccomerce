/// <reference types="https://esm.sh/@supabase/functions-js/src/edge-runtime.d.ts" />

import { getSupabaseAdminClient } from './supabase.ts';

const DEFAULT_ORIGIN_POSTAL_CODE = 42183;

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
  origin_postal_code?: number;
  origin_coordinate?: { latitude: number; longitude: number };
  destination_contact_name: string;
  destination_contact_phone: string;
  destination_address: string;
  destination_coordinate?: { latitude: number; longitude: number };
  courier_company: string;
  courier_type: string;
  delivery_type: 'now' | 'scheduled';
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

export interface StoreSettings {
  store_name: string;
  phone_number: string;
  email: string;
  organization: string;
  store_address: string;
  enabled_couriers: string | null;
  origin_postal_code: number;
  origin_latitude: number | null;
  origin_longitude: number | null;
  origin_area_id: string | null;
}

interface EnabledCourierServiceSelection {
  companyCode: string;
  serviceCode: string | '*';
}

interface BiteshipRatePricing {
  courier_code?: string;
  courier_service_code?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeEnabledCourierSelection(value: string): EnabledCourierServiceSelection | null {
  const trimmedValue = value.trim().toLowerCase();
  if (!trimmedValue) {
    return null;
  }

  const [companyCode, ...serviceParts] = trimmedValue.split(':');
  const normalizedCompanyCode = companyCode.trim();
  if (!normalizedCompanyCode) {
    return null;
  }

  if (serviceParts.length === 0) {
    return { companyCode: normalizedCompanyCode, serviceCode: '*' };
  }

  const normalizedServiceCode = serviceParts.join(':').trim();
  if (!normalizedServiceCode) {
    return null;
  }

  return { companyCode: normalizedCompanyCode, serviceCode: normalizedServiceCode };
}

function parseEnabledCourierServices(
  value: string | null | undefined,
): EnabledCourierServiceSelection[] {
  if (!value) {
    return [];
  }

  const selections = new Map<string, EnabledCourierServiceSelection>();
  for (const rawSelection of value.split(',')) {
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
      selection.serviceCode === '*'
        ? selection.companyCode
        : `${selection.companyCode}:${selection.serviceCode}`,
    )
    .join(',');
}

export function getEnabledCouriers(settings: StoreSettings): string {
  const selections = parseEnabledCourierServices(settings.enabled_couriers);
  if (selections.length === 0) {
    return '';
  }

  return Array.from(new Set(selections.map((selection) => selection.companyCode))).join(',');
}

export function filterRatesByEnabledServices(
  responseData: unknown,
  settings: StoreSettings,
): unknown {
  const enabledSelections = parseEnabledCourierServices(settings.enabled_couriers);
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
    const companyServices = allowedServicesByCompany.get(selection.companyCode) ?? new Set<string>();
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

    return allowedServices.has('*') || allowedServices.has(serviceCode);
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

  const enabledSelections = parseEnabledCourierServices(settings.enabled_couriers);
  if (enabledSelections.length === 0) {
    return false;
  }

  return enabledSelections.some((selection) => {
    return (
      selection.companyCode === normalizedCompanyCode &&
      (selection.serviceCode === '*' || selection.serviceCode === normalizedServiceCode)
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
      'Missing shop shipper configuration. Ensure store_name, phone_number, email, organization, and store_address are set in settings table.',
    );
  }
}

interface OrderProduct {
  name: string;
  description?: string;
  weight?: number;
}

interface OrderItem {
  products?: OrderProduct;
  price_at_purchase?: number;
  quantity?: number;
}

interface Order {
  id: string;
  tracking_id?: string | null;
  origin_area_id: string;
  destination_area_id: string | null;
  destination_postal_code?: number | null;
  courier_code: string;
  courier_service: string;
  order_items?: OrderItem[];
  profiles?: {
    full_name?: string;
  };
  addresses?: {
    phone_number?: string;
    street_address?: string;
    latitude?: string | null;
    longitude?: string | null;
  };
}

export async function getStoreSettings(): Promise<StoreSettings> {
  const adminClient = getSupabaseAdminClient();
  const { data, error } = await adminClient
    .from('settings')
    .select(
      'store_name, phone_number, email, organization, store_address, enabled_couriers, origin_postal_code, origin_latitude, origin_longitude, origin_area_id',
    )
    .eq('id', 1)
    .maybeSingle();

  if (error) {
    console.error('[getStoreSettings] Database error:', error);
    throw new Error(`Failed to fetch store settings: ${error.message}`);
  }

  if (!data) {
    throw new Error('Store settings not found (expected row with id=1)');
  }

  return {
    store_name: data.store_name || '',
    phone_number: data.phone_number || '',
    email: data.email || '',
    organization: data.organization || '',
    store_address: data.store_address || '',
    enabled_couriers: serializeEnabledCourierServices(parseEnabledCourierServices(data.enabled_couriers)),
    origin_postal_code: data.origin_postal_code ?? DEFAULT_ORIGIN_POSTAL_CODE,
    origin_latitude: data.origin_latitude,
    origin_longitude: data.origin_longitude,
    origin_area_id: data.origin_area_id,
  };
}

export const createBiteshipOrder = async (
  order: Order,
  apiKey: string,
): Promise<BiteshipOrderResponse> => {
  const BITESHIP_BASE_URL = 'https://api.biteship.com/v1';

  if (!order.destination_area_id && !order.destination_postal_code) {
    throw new Error('Missing destination_area_id and destination_postal_code on order');
  }
  if (!order.courier_code) throw new Error('Missing courier_code on order');
  if (!order.courier_service) throw new Error('Missing courier_service on order');

  const settings = await getStoreSettings();
  assertCompleteStoreSettings(settings);
  if (!isCourierServiceEnabled(settings, order.courier_code, order.courier_service)) {
    throw new Error(`Disabled courier service: ${order.courier_code}:${order.courier_service}`);
  }
  const shipperName = settings.store_name;
  const shipperPhone = settings.phone_number;
  const shipperEmail = settings.email;
  const shipperOrganization = settings.organization;
  const shopAddress = settings.store_address;
  const originPostalCode = settings.origin_postal_code ?? DEFAULT_ORIGIN_POSTAL_CODE;
  const originLatitude = settings.origin_latitude;
  const originLongitude = settings.origin_longitude;

  const items: BiteshipOrderItem[] = (order.order_items || []).map(
    (item: OrderItem): BiteshipOrderItem => ({
      name: item.products?.name || 'Product',
      description: item.products?.description || '',
      value: Math.round(Number(item.price_at_purchase)),
      quantity: Number(item.quantity),
      weight: Number(item.products?.weight || 200),
    }),
  );

  const payload: BiteshipOrderPayload = {
    shipper_contact_name: shipperName,
    shipper_contact_phone: shipperPhone,
    shipper_contact_email: shipperEmail,
    shipper_organization: shipperOrganization,
    origin_contact_name: shipperName,
    origin_contact_phone: shipperPhone,
    origin_address: shopAddress,
    origin_postal_code: originPostalCode,
    ...(originLatitude !== null && originLongitude !== null
       ? {
           origin_coordinate: {
             latitude: originLatitude,
             longitude: originLongitude,
           },
         }
       : {}),

    destination_contact_name: order.profiles?.full_name || 'Customer',
    destination_contact_phone: order.addresses?.phone_number || shipperPhone,
    destination_address: order.addresses?.street_address || 'Alamat Tujuan',
    ...(order.destination_area_id
      ? { destination_area_id: order.destination_area_id }
      : { destination_postal_code: Number(order.destination_postal_code) }),

    ...(order.addresses?.latitude && order.addresses?.longitude
      ? {
          destination_coordinate: {
            latitude: Number(order.addresses.latitude),
            longitude: Number(order.addresses.longitude),
          },
        }
      : {}),

    courier_company: order.courier_code,
    courier_type: order.courier_service,
    delivery_type: 'now',
    items: items,
  };

  console.log(`[biteship] Creating order for order ${order.id}`);

  const authPrefix =
    apiKey.startsWith('biteship_live.') || apiKey.startsWith('biteship_test.')
      ? ''
      : 'biteship_test.';
  const authKey = `${authPrefix}${apiKey}`;

  const response = await fetch(`${BITESHIP_BASE_URL}/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authKey,
    },
    body: JSON.stringify(payload),
  });

  const result = await response.json();

  if (!response.ok) {
    console.error(`[biteship] API Error:`, JSON.stringify(result));
    throw new Error(result.message || 'Failed to create Biteship order');
  }

  return result as BiteshipOrderResponse;
};
