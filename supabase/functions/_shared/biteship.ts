/// <reference types="https://esm.sh/@supabase/functions-js/src/edge-runtime.d.ts" />

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

  const shipperName = Deno.env.get('SHOP_SHIPPER_NAME') || 'Apotek Sehat';
  const shipperPhone = Deno.env.get('SHOP_SHIPPER_PHONE') || '08123456789';
  const shipperEmail = Deno.env.get('SHOP_SHIPPER_EMAIL') || '';
  const shipperOrganization = Deno.env.get('SHOP_ORGANIZATION') || '';
  const shopAddress = Deno.env.get('SHOP_ADDRESS') || 'Alamat Toko Apotek';
  const originPostalCode = Number(Deno.env.get('BITESHIP_ORIGIN_POSTAL_CODE') || '42183');
  const originLatitude = Deno.env.get('BITESHIP_ORIGIN_LATITUDE');
  const originLongitude = Deno.env.get('BITESHIP_ORIGIN_LONGITUDE');

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
    ...(originLatitude && originLongitude
      ? {
          origin_coordinate: {
            latitude: Number(originLatitude),
            longitude: Number(originLongitude),
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
