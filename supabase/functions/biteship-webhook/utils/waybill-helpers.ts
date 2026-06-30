const WAYBILL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{4,63}$/;

export function normalizeWaybillNumber(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim();
  if (!normalizedValue) {
    return null;
  }

  return WAYBILL_PATTERN.test(normalizedValue) ? normalizedValue : null;
}
