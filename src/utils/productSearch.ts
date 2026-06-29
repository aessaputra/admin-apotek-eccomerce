export const PRODUCT_SEARCH_FIELDS = ["name", "sku"] as const;
export const PRODUCT_SEARCH_MAX_LENGTH = 100;

export type ProductSearchField = (typeof PRODUCT_SEARCH_FIELDS)[number];

export type ProductSearchFilter = {
  operator: "or";
  value: Array<{
    field: ProductSearchField;
    operator: "contains";
    value: string;
  }>;
};

function escapeProductSearchValue(value: string): string {
  return value.replace(/[%_,()'"\\]/g, "\\$&");
}

export function normalizeProductSearchInput(input: string | null | undefined): string | null {
  if (typeof input !== "string") return null;

  const trimmed = input.trim();
  if (!trimmed) return null;

  const limited = trimmed.slice(0, PRODUCT_SEARCH_MAX_LENGTH);
  const escaped = escapeProductSearchValue(limited);

  return escaped.length > 0 ? escaped : null;
}

export function buildProductSearchFilter(input: string | null | undefined): ProductSearchFilter | null {
  const normalized = normalizeProductSearchInput(input);
  if (!normalized) return null;

  return {
    operator: "or",
    value: PRODUCT_SEARCH_FIELDS.map((field) => ({
      field,
      operator: "contains",
      value: normalized,
    })),
  };
}
