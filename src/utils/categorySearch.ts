export const CATEGORY_SEARCH_FIELDS = ["name", "slug"] as const;
export const CATEGORY_SEARCH_MAX_LENGTH = 100;

export type CategorySearchField = (typeof CATEGORY_SEARCH_FIELDS)[number];

export type CategorySearchFilter = {
  operator: "or";
  value: Array<{
    field: CategorySearchField;
    operator: "contains";
    value: string;
  }>;
};

function escapeCategorySearchValue(value: string): string {
  return value.replace(/[%_,()'"\\]/g, "\\$&");
}

export function normalizeCategorySearchInput(input: string | null | undefined): string | null {
  if (typeof input !== "string") return null;

  const trimmed = input.trim();
  if (!trimmed) return null;

  const limited = trimmed.slice(0, CATEGORY_SEARCH_MAX_LENGTH);
  const escaped = escapeCategorySearchValue(limited);

  return escaped.length > 0 ? escaped : null;
}

export function buildCategorySearchFilter(input: string | null | undefined): CategorySearchFilter | null {
  const normalized = normalizeCategorySearchInput(input);
  if (!normalized) return null;

  return {
    operator: "or",
    value: CATEGORY_SEARCH_FIELDS.map((field) => ({
      field,
      operator: "contains",
      value: normalized,
    })),
  };
}
