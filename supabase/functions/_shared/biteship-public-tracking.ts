function normalizeRequiredPathSegment(
  value: string,
  errorMessage: string,
  options?: { lowercase?: boolean },
): string {
  const normalizedValue = options?.lowercase
    ? value.trim().toLowerCase()
    : value.trim();

  if (!normalizedValue) {
    throw new Error(errorMessage);
  }

  return encodeURIComponent(normalizedValue);
}

export function buildTrackingEndpoint(trackingId: string): string {
  const encodedTrackingId = normalizeRequiredPathSegment(
    trackingId,
    "Missing tracking ID for Biteship tracking",
  );

  return `/v1/trackings/${encodedTrackingId}`;
}

export function buildPublicTrackingEndpoint(
  waybillId: string,
  courierCode: string,
): string {
  const encodedWaybillId = normalizeRequiredPathSegment(
    waybillId,
    "Missing waybill number for public tracking",
  );
  const encodedCourierCode = normalizeRequiredPathSegment(
    courierCode,
    "Missing courier code for public tracking",
    { lowercase: true },
  );

  return `/v1/trackings/${encodedWaybillId}/couriers/${encodedCourierCode}`;
}

export function buildOrderEndpoint(orderId: string): string {
  const encodedOrderId = normalizeRequiredPathSegment(
    orderId,
    "Missing Biteship order ID for order retrieval",
  );

  return `/v1/orders/${encodedOrderId}`;
}
