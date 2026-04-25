export type BiteshipPostalCodeField =
  | "origin_postal_code"
  | "destination_postal_code";

function buildInvalidPostalCodeError(field: BiteshipPostalCodeField): Error {
  return new Error(`${field} must be a valid 5-digit Indonesian postal code.`);
}

export function parseBiteshipPostalCode(
  value: string | number | null | undefined,
  field: BiteshipPostalCodeField,
): number {
  if (typeof value === "string") {
    const normalizedValue = value.trim();

    if (!/^\d{5}$/.test(normalizedValue)) {
      throw buildInvalidPostalCodeError(field);
    }

    const parsedValue = Number(normalizedValue);
    if (parsedValue < 10000 || parsedValue > 99999) {
      throw buildInvalidPostalCodeError(field);
    }

    return parsedValue;
  }

  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 10000 ||
    value > 99999
  ) {
    throw buildInvalidPostalCodeError(field);
  }

  return value;
}

export function tryParseBiteshipPostalCode(
  value: string | number | null | undefined,
  field: BiteshipPostalCodeField,
): number | null {
  try {
    return parseBiteshipPostalCode(value, field);
  } catch {
    return null;
  }
}
