export const INSTANT_CAPABLE_COURIER_COMPANIES = new Set([
  "gojek",
  "grab",
  "lalamove",
  "paxel",
  "borzo",
  "rara",
  "dash_express",
]);

function normalizeCourierIdentifier(value: string | null | undefined): string {
  return value?.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") ?? "";
}

export function normalizeBiteshipCourierCompanies(couriers: string | null): string[] {
  if (!couriers) {
    return [];
  }

  const normalizedCompanies = new Set<string>();

  for (const rawCourier of couriers.split(",")) {
    const [companyCode] = rawCourier.trim().toLowerCase().split(":");
    const normalizedCompanyCode = normalizeCourierIdentifier(companyCode);
    if (normalizedCompanyCode) {
      normalizedCompanies.add(normalizedCompanyCode);
    }
  }

  return Array.from(normalizedCompanies);
}

export function isInstantCapableBiteshipCourierCompany(
  courierCode: string | null | undefined,
): boolean {
  return INSTANT_CAPABLE_COURIER_COMPANIES.has(
    normalizeCourierIdentifier(courierCode),
  );
}

export function isInstantBiteshipServiceIdentifier(
  serviceIdentifier: string | null | undefined,
): boolean {
  const normalizedServiceIdentifier = normalizeCourierIdentifier(serviceIdentifier);

  return (
    normalizedServiceIdentifier === "instant" ||
    normalizedServiceIdentifier === "same_day" ||
    normalizedServiceIdentifier === "sameday"
  );
}

export function shouldUseInstantBiteshipContract(
  courierCode: string | null | undefined,
  serviceIdentifier: string | null | undefined,
): boolean {
  return (
    isInstantCapableBiteshipCourierCompany(courierCode) ||
    isInstantBiteshipServiceIdentifier(serviceIdentifier)
  );
}
