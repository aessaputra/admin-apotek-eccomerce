export const CUSTOMER_SEARCH_FIELDS = ["full_name", "phone_number", "email"] as const;
export const CUSTOMER_SEARCH_MAX_LENGTH = 100;

export type CustomerSearchField = (typeof CUSTOMER_SEARCH_FIELDS)[number];

export type CustomerSearchFilter = {
  operator: "or";
  value: Array<{
    field: CustomerSearchField;
    operator: "contains";
    value: string;
  }>;
};

function escapeCustomerSearchValue(value: string): string {
  return value.replace(/[%_,()'"\\]/g, "\\$&");
}

export function normalizeCustomerSearchInput(input: string | null | undefined): string | null {
  if (typeof input !== "string") return null;

  const trimmed = input.trim();
  if (!trimmed) return null;

  const limited = trimmed.slice(0, CUSTOMER_SEARCH_MAX_LENGTH);
  const escaped = escapeCustomerSearchValue(limited);

  return escaped.length > 0 ? escaped : null;
}

export function buildCustomerSearchFilter(input: string | null | undefined): CustomerSearchFilter | null {
  const normalized = normalizeCustomerSearchInput(input);
  if (!normalized) return null;

  return {
    operator: "or",
    value: CUSTOMER_SEARCH_FIELDS.map((field) => ({
      field,
      operator: "contains",
      value: normalized,
    })),
  };
}
