/**
 * Converts a string to a URL-safe slug.
 * - Lowercase, trim whitespace
 * - Replace non-word chars (except spaces, hyphens) with empty
 * - Replace spaces/underscores with single hyphen
 * - Remove leading/trailing hyphens
 */
export function slugify(str: string): string {
  if (!str || typeof str !== "string") return "";
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
