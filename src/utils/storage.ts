export const PRODUCT_IMAGES_BUCKET = "product-images";

/**
 * Extracts the storage file path from a Supabase Storage public URL.
 * URL format: https://<project>.supabase.co/storage/v1/object/public/<bucket>/<path>
 * Returns the path within the bucket, or null if not a valid storage URL.
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
  return match ? match[1] : null;
}
