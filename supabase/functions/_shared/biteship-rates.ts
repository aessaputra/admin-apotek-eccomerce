export interface RatesOriginSettings {
  enabled_couriers: string | null;
  origin_area_id: string | null;
  origin_postal_code: string | null;
  origin_latitude: number | null;
  origin_longitude: number | null;
}

const INSTANT_CAPABLE_COMPANIES = new Set([
  "gojek",
  "grab",
  "lalamove",
  "borzo",
  "paxel",
  "rara",
  "dash_express",
]);

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

function hasStoreOriginCoordinates(settings: RatesOriginSettings): boolean {
  return (
    typeof settings.origin_latitude === "number" &&
    Number.isFinite(settings.origin_latitude) &&
    typeof settings.origin_longitude === "number" &&
    Number.isFinite(settings.origin_longitude)
  );
}

function getRequiredOriginPostalCode(settings: RatesOriginSettings): number {
  const postalCode = settings.origin_postal_code?.trim() ?? "";
  if (!/^\d{5}$/.test(postalCode)) {
    throw new Error(
      "Missing origin_postal_code in settings table. Configure a valid 5-digit Indonesian shipping origin postal code before requesting Biteship rates.",
    );
  }

  return Number(postalCode);
}

function getStandardOriginFields(
  settings: RatesOriginSettings,
): Record<string, string | number> {
  const originAreaId = settings.origin_area_id?.trim() ?? "";
  if (originAreaId) {
    return { origin_area_id: originAreaId };
  }

  if (hasStoreOriginCoordinates(settings)) {
    return {
      origin_latitude: settings.origin_latitude!,
      origin_longitude: settings.origin_longitude!,
    };
  }

  return {
    origin_postal_code: getRequiredOriginPostalCode(settings),
  };
}

function hasInstantCapableCouriers(enabledCouriers: string | null): boolean {
  if (!enabledCouriers) {
    return false;
  }

  return enabledCouriers
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .some((value) => {
      const [companyCode] = value.split(":");
      return companyCode ? INSTANT_CAPABLE_COMPANIES.has(companyCode) : false;
    });
}

export function shouldUseCoordinateOriginForRates(
  settings: RatesOriginSettings,
  payload: Record<string, unknown>,
  couriers: string | null,
): boolean {
  return (
    hasStoreOriginCoordinates(settings) &&
    hasInstantCapableCouriers(couriers) &&
    hasDestinationCoordinates(payload)
  );
}

export function buildRatesRequestPayloads(
  settings: RatesOriginSettings,
  payload: Record<string, unknown>,
  couriers: string,
): Record<string, unknown>[] {
  const trimmedCouriers = couriers.trim();
  if (!trimmedCouriers) {
    return [];
  }

  const shouldUseCoordinateOrigin = shouldUseCoordinateOriginForRates(
    settings,
    payload,
    trimmedCouriers,
  );

  return [
    {
      ...payload,
      ...(shouldUseCoordinateOrigin
        ? {
            origin_latitude: settings.origin_latitude!,
            origin_longitude: settings.origin_longitude!,
          }
        : getStandardOriginFields(settings)),
      couriers: trimmedCouriers,
    },
  ];
}
