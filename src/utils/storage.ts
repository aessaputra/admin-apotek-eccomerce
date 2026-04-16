export const MEDIA_BUCKET = "media";

/** Max file size untuk upload gambar (5MB) */
export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

/** MIME types yang diizinkan untuk upload gambar */
export const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

/**
 * Sanitasi nama file untuk mencegah path traversal dan karakter berbahaya.
 * @see https://owasp.org/www-community/attacks/Path_Traversal
 */
export function sanitizeFilename(filename: string): string {
  if (!filename || typeof filename !== "string") return "image";
  const base = filename.replace(/^.*[\\/]/, "").replace(/[^a-zA-Z0-9.-]/g, "_");
  return base.slice(0, 100) || "image";
}

export interface ValidateImageResult {
  valid: boolean;
  error?: string;
}

/**
 * Validasi file gambar sebelum upload: ukuran dan MIME type.
 * @see https://supabase.com/docs/guides/storage
 */
export function validateImageFile(file: File): ValidateImageResult {
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    return {
      valid: false,
      error: `Ukuran file maksimal 5MB. File ini: ${(file.size / 1024 / 1024).toFixed(2)}MB`,
    };
  }
  const type = file.type?.toLowerCase();
  if (!type || !ALLOWED_IMAGE_TYPES.includes(type as (typeof ALLOWED_IMAGE_TYPES)[number])) {
    return {
      valid: false,
      error: "Format file harus JPG, PNG, WebP, atau GIF",
    };
  }
  return { valid: true };
}

/**
 * Validates path to prevent path traversal attacks.
 * @see https://owasp.org/www-community/attacks/Path_Traversal
 */
export function isStoragePathSafe(path: string): boolean {
  return (
    path.length > 0 &&
    !path.includes("..") &&
    !path.startsWith("/") &&
    !path.includes("//")
  );
}

function normalizeStoragePath(value: string): string | null {
  const trimmedValue = value.trim();
  return trimmedValue && isStoragePathSafe(trimmedValue) ? trimmedValue : null;
}

/**
 * Extracts the storage file path from a Supabase Storage public URL.
 * URL format: https://<project>.supabase.co/storage/v1/object/public/<bucket>/<path>
 * Returns the path within the bucket, or null if not a valid storage URL.
 * Rejects paths containing ".." or "//" to prevent path traversal.
 */
export function getStoragePathFromPublicUrl(
  publicUrl: string,
  bucket: string
): string | null {
  if (!publicUrl || typeof publicUrl !== "string") return null;
  const pattern = new RegExp(
    `/storage/v1/object/public/${bucket.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/(.+)`
  );
  const match = publicUrl.match(pattern);
  const path = match ? match[1] : null;
  return path ? normalizeStoragePath(path) : null;
}

export function getStoragePathFromReference(
  value: string | null | undefined,
  bucket: string
): string | null {
  if (!value || typeof value !== "string") return null;

  return getStoragePathFromPublicUrl(value, bucket) ?? normalizeStoragePath(value);
}

export function getPublicUrlFromStoragePath(
  path: string,
  bucket: string
): string | null {
  if (!path || typeof path !== "string") return null;

  const normalizedPath = normalizeStoragePath(path);
  if (!normalizedPath) return null;

  const baseUrl = import.meta.env.VITE_SUPABASE_URL;
  if (!baseUrl) return null;

  return `${baseUrl}/storage/v1/object/public/${bucket}/${normalizedPath}`;
}

export function resolveStoragePublicUrl(
  value: string | null | undefined,
  bucket: string
): string | null {
  if (!value || typeof value !== "string") return null;

  const trimmedValue = value.trim();
  if (!trimmedValue) return null;

  if (trimmedValue.startsWith("http://") || trimmedValue.startsWith("https://")) {
    return trimmedValue;
  }

  return getPublicUrlFromStoragePath(trimmedValue, bucket);
}
