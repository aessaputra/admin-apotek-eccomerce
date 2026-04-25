const CATEGORY_TOKEN_TARGET_LENGTH = 8;
const PRODUCT_TOKEN_TARGET_LENGTH = 16;
const SKU_MIN_LENGTH = 4;
const SKU_MAX_LENGTH = 50;
const SKU_PATTERN = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;

function normalizeToken(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase();
}

function truncatePhraseToken(value: string, maxLength: number): string {
  const normalized = normalizeToken(value);
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;

  const parts = normalized.split("-").filter(Boolean);
  const tokens: string[] = [];
  let totalLength = 0;

  for (const part of parts) {
    const nextLength = tokens.length === 0 ? part.length : totalLength + 1 + part.length;
    if (nextLength > maxLength) break;
    tokens.push(part);
    totalLength = nextLength;
  }

  if (tokens.length > 0) return tokens.join("-").replace(/^-+|-+$/g, "");

  return normalized.slice(0, maxLength).replace(/^-+|-+$/g, "");
}

function generateBase36Suffix(): string {
  const max = 36 ** 4;
  const randomSource = globalThis.crypto;
  const value = randomSource
    ? Math.floor((randomSource.getRandomValues(new Uint32Array(1))[0] / 2 ** 32) * max)
    : Math.floor(Math.random() * max);

  return value.toString(36).toUpperCase().padStart(4, "0");
}

export function normalizeSku(input: string): string {
  if (typeof input !== "string") return "";

  return normalizeToken(input);
}

export function isValidSku(input: string): boolean {
  return (
    typeof input === "string" &&
    input.length >= SKU_MIN_LENGTH &&
    input.length <= SKU_MAX_LENGTH &&
    SKU_PATTERN.test(input)
  );
}

export function isDuplicateSkuError(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
  const messageText = error instanceof Error
    ? error.message
    : typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : "";

  return code === "23505" || /duplicate key|products_sku|sku/i.test(messageText);
}

export function generateSkuCandidate({
  categorySlugOrName,
  productName,
}: {
  categorySlugOrName: string;
  productName: string;
}): string {
  const categoryToken = truncatePhraseToken(categorySlugOrName, CATEGORY_TOKEN_TARGET_LENGTH) || "PRD";
  const productToken = truncatePhraseToken(productName, PRODUCT_TOKEN_TARGET_LENGTH) || "ITEM";
  const candidate = `${categoryToken}-${productToken}-${generateBase36Suffix()}`;

  return candidate.length <= SKU_MAX_LENGTH ? candidate : candidate.slice(0, SKU_MAX_LENGTH);
}
