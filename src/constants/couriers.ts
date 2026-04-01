export interface CourierOption {
  value: string;
  label: string;
  description: string;
}

export interface CourierServiceOption {
  key: string;
  companyCode: string;
  companyLabel: string;
  serviceCode: string;
  serviceLabel: string;
  description: string;
}

export const BITESHIP_COURIER_OPTIONS: CourierOption[] = [
  { value: "jne", label: "JNE", description: "Jalur Nugraha Ekakurir - Regular & express delivery" },
  { value: "jnt", label: "J&T Express", description: "J&T Express - Nationwide courier service" },
  { value: "sicepat", label: "SiCepat", description: "SiCepat Express - Fast delivery service" },
  { value: "anteraja", label: "AnterAja", description: "AnterAja - Logistics by Adaro" },
  { value: "pos", label: "POS Indonesia", description: "POS Indonesia - National postal service" },
  { value: "ninja", label: "Ninja Xpress", description: "Ninja Xpress - Same day & regular delivery" },
  { value: "ide", label: "ID Express", description: "ID Express - Express delivery service" },
  { value: "sap", label: "SAP Express", description: "SAP Express - Express courier" },
  { value: "rpx", label: "RPX Holdings", description: "RPX Holdings - Premium logistics" },
  { value: "sentral", label: "Sentral Cargo", description: "Sentral Cargo - Cargo & logistics" },
  { value: "wahana", label: "Wahana Prestasi Logistik", description: "Wahana - Express cargo service" },
  { value: "lion", label: "Lion Parcel", description: "Lion Parcel - Air cargo delivery" },
  { value: "ncs", label: "NCS Express", description: "Nusantara Card Semesta - Express delivery" },
  { value: "tiki", label: "TIKI", description: "Titipan Kilat - Express courier" },
  { value: "rex", label: "REX Express", description: "Royal Express Indonesia" },
  { value: "first", label: "First Logistics", description: "First Logistics - Express delivery" },
  { value: "star", label: "Star Cargo", description: "Star Cargo - Cargo & logistics" },
  { value: "pandu", label: "Pandu Logistics", description: "Pandu Logistics - Nationwide delivery" },
  { value: "gojek", label: "GoSend", description: "Gojek - Instant & same day delivery" },
  { value: "grab", label: "GrabExpress", description: "Grab - Instant & same day delivery" },
  { value: "lalamove", label: "Lalamove", description: "Lalamove - On-demand delivery" },
  { value: "borzo", label: "Borzo", description: "Borzo - Same day courier" },
  { value: "deliveree", label: "Deliveree", description: "Deliveree - On-demand logistics" },
];

const COURIER_OPTION_BY_CODE = new Map(
  BITESHIP_COURIER_OPTIONS.map((courier) => [courier.value, courier] as const)
);

export const BITESHIP_FALLBACK_COURIER_SERVICES: CourierServiceOption[] = [
  {
    key: "gojek:instant",
    companyCode: "gojek",
    companyLabel: "GoSend",
    serviceCode: "instant",
    serviceLabel: "Instant",
    description: "On Demand Instant (bike) (1 - 3 hours)",
  },
  {
    key: "gojek:same_day",
    companyCode: "gojek",
    companyLabel: "GoSend",
    serviceCode: "same_day",
    serviceLabel: "Same Day",
    description: "On Demand within 8 hours (bike) (6 - 8 hours)",
  },
  {
    key: "grab:instant",
    companyCode: "grab",
    companyLabel: "GrabExpress",
    serviceCode: "instant",
    serviceLabel: "Instant",
    description: "On Demand Instant (bike) (1 - 3 hours)",
  },
  {
    key: "grab:same_day",
    companyCode: "grab",
    companyLabel: "GrabExpress",
    serviceCode: "same_day",
    serviceLabel: "Same Day",
    description: "On Demand within 8 hours (bike) (6 - 8 hours)",
  },
  {
    key: "grab:instant_car",
    companyCode: "grab",
    companyLabel: "GrabExpress",
    serviceCode: "instant_car",
    serviceLabel: "Instant Car",
    description: "Grab Car Express",
  },
];

export function normalizeCourierSelection(value: string): string | null {
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
    return normalizedCompanyCode;
  }

  const normalizedServiceCode = serviceParts.join(":").trim();
  if (!normalizedServiceCode) {
    return null;
  }

  return `${normalizedCompanyCode}:${normalizedServiceCode}`;
}

export function getCourierSelectionCompany(value: string): string | null {
  const normalizedValue = normalizeCourierSelection(value);
  if (!normalizedValue) {
    return null;
  }

  const [companyCode] = normalizedValue.split(":");
  return companyCode ?? null;
}

export function getFallbackCourierOption(companyCode: string): CourierOption {
  const normalizedCompanyCode = companyCode.trim().toLowerCase();
  const fallbackCourier = COURIER_OPTION_BY_CODE.get(normalizedCompanyCode);

  if (fallbackCourier) {
    return fallbackCourier;
  }

  return {
    value: normalizedCompanyCode,
    label: normalizedCompanyCode.toUpperCase(),
    description: normalizedCompanyCode,
  };
}

/**
 * Convert comma-separated courier string to array.
 */
export function parseCouriers(couriersString: string | null | undefined): string[] {
  if (!couriersString) return [];

  const selections = new Set<string>();
  for (const courier of couriersString.split(",")) {
    const normalizedSelection = normalizeCourierSelection(courier);
    if (normalizedSelection) {
      selections.add(normalizedSelection);
    }
  }

  return Array.from(selections);
}

/**
 * Convert courier array to comma-separated string for storage.
 */
export function serializeCouriers(couriers: string[]): string | null {
  return couriers.length > 0 ? couriers.join(",") : null;
}
