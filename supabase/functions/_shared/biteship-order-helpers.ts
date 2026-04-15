import type { Order, OrderAddress } from "./types.ts";

type BiteshipOrderDestinationFields = {
  destination_contact_name: string;
  destination_contact_phone: string;
  destination_address: string;
  destination_note?: string;
  destination_coordinate?: {
    latitude: number;
    longitude: number;
  };
} & (
  | {
      destination_area_id: string;
      destination_postal_code?: number;
    }
  | {
      destination_area_id?: string;
      destination_postal_code: number;
    }
);

function getRequiredTrimmedValue(
  value: string | null | undefined,
  fieldLabel: string,
  orderId: string,
): string {
  const normalizedValue = value?.trim();

  if (!normalizedValue) {
    throw new Error(`${fieldLabel} is required for Biteship order ${orderId}.`);
  }

  return normalizedValue;
}

function getPreferredRecipientName(order: Order): string | null | undefined {
  const receiverName = order.addresses?.receiver_name?.trim();
  if (receiverName) {
    return receiverName;
  }

  return order.profiles?.full_name;
}

function toFiniteCoordinate(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getDestinationCoordinate(order: Order): {
  latitude: number;
  longitude: number;
} | null {
  const latitude = toFiniteCoordinate(order.addresses?.latitude);
  const longitude = toFiniteCoordinate(order.addresses?.longitude);

  if (latitude === null || longitude === null) {
    return null;
  }

  return { latitude, longitude };
}

function getOptionalTrimmedValue(
  value: string | null | undefined,
): string | null {
  const normalizedValue = value?.trim();

  return normalizedValue ? normalizedValue : null;
}

function requiresDestinationCoordinate(order: Order): boolean {
  return order.courier_service?.trim().toLowerCase() === "instant";
}

export function buildBiteshipOrderDestinationFields(
  order: Order,
): BiteshipOrderDestinationFields {
  const destinationCoordinate = getDestinationCoordinate(order);

  if (requiresDestinationCoordinate(order) && !destinationCoordinate) {
    throw new Error(
      `Destination coordinate is required for instant courier ${order.courier_code}:${order.courier_service} on order ${order.id}. Ensure the shipping address has latitude and longitude.`,
    );
  }

  return {
    destination_contact_name: getRequiredTrimmedValue(
      getPreferredRecipientName(order),
      "Destination contact name",
      order.id,
    ),
    destination_contact_phone: getRequiredTrimmedValue(
      order.addresses?.phone_number,
      "Destination contact phone",
      order.id,
    ),
    destination_address: getRequiredTrimmedValue(
      order.addresses?.street_address,
      "Destination address",
      order.id,
    ),
    ...(getOptionalTrimmedValue(order.addresses?.address_note)
      ? {
          destination_note: getOptionalTrimmedValue(
            order.addresses?.address_note,
          )!,
        }
      : {}),
    ...(order.destination_area_id
      ? { destination_area_id: order.destination_area_id }
      : { destination_postal_code: Number(order.destination_postal_code) }),
    ...(destinationCoordinate
      ? { destination_coordinate: destinationCoordinate }
      : {}),
  };
}

export async function fetchOrderShippingAddress(
  adminClient: {
    from: (table: string) => {
      select: (columns: string) => {
        eq: (
          column: string,
          value: string,
        ) => {
          maybeSingle: () => Promise<{
            data: OrderAddress | null;
            error: { message: string } | null;
          }>;
        };
      };
    };
  },
  order: Pick<Order, "id" | "shipping_address_id">,
): Promise<OrderAddress | null> {
  const shippingAddressId = order.shipping_address_id?.trim();
  if (!shippingAddressId) {
    return null;
  }

  const { data, error } = await adminClient
    .from("addresses")
    .select(
      "id, receiver_name, phone_number, street_address, address_note, city, province, postal_code, country_code, area_id, latitude, longitude",
    )
    .eq("id", shippingAddressId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to fetch shipping address ${shippingAddressId} for order ${order.id}: ${error.message}`,
    );
  }

  return data ?? null;
}
