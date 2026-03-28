import type { DataProvider } from "@refinedev/core";
import { dataProvider as supabaseDataProvider } from "@refinedev/supabase";
import { supabaseClient } from "./supabase-client";
import { getStoragePathFromPublicUrl, MEDIA_BUCKET } from "../utils/storage";

const baseDataProvider = supabaseDataProvider(supabaseClient);

async function deleteCategoryLogo(logoUrl: string | null | undefined): Promise<void> {
  if (!logoUrl) return;
  const path = getStoragePathFromPublicUrl(logoUrl, MEDIA_BUCKET);
  if (!path) return;
  await supabaseClient.storage.from(MEDIA_BUCKET).remove([path]);
}

async function deleteProductImages(productImages: { url: string }[]): Promise<void> {
  const deletions = (productImages || []).map(async (img) => {
    const path = getStoragePathFromPublicUrl(img.url, MEDIA_BUCKET);
    if (path) {
      await supabaseClient.storage.from(MEDIA_BUCKET).remove([path]);
    }
  });
  await Promise.allSettled(deletions);
}

export const dataProvider: DataProvider = {
  ...baseDataProvider,
  deleteOne: async (params) => {
    if (params.resource === "categories") {
      try {
        const { data } = await baseDataProvider.getOne({
          resource: "categories",
          id: params.id,
          meta: params.meta,
        });
        const logoUrl = (data as { logo_url?: string })?.logo_url;
        await deleteCategoryLogo(logoUrl);
      } catch {
        // Continue with delete even if logo fetch/remove fails (e.g. RLS, orphaned URL)
      }
    }
    if (params.resource === "products") {
      try {
        const { data } = await baseDataProvider.getOne({
          resource: "products",
          id: params.id,
          meta: { select: "*, product_images(*)" },
        });
        const images = (data as { product_images?: { url: string }[] })?.product_images ?? [];
        await deleteProductImages(images);
      } catch {
        // Continue with delete even if fetch/remove fails
      }
    }
    return baseDataProvider.deleteOne(params);
  },
  deleteMany: async (params) => {
    if (params.resource === "categories") {
      try {
        const { data } = await baseDataProvider.getMany({
          resource: "categories",
          ids: params.ids,
          meta: params.meta,
        });
        const items = Array.isArray(data) ? data : [];
        await Promise.allSettled(
          items.map((item) => {
            const logoUrl = (item as { logo_url?: string })?.logo_url;
            return deleteCategoryLogo(logoUrl);
          })
        );
      } catch {
        // Continue with delete even if logo fetch/remove fails
      }
    }
    if (params.resource === "products") {
      try {
        const { data } = await baseDataProvider.getMany({
          resource: "products",
          ids: params.ids,
          meta: { select: "*, product_images(*)" },
        });
        const items = Array.isArray(data) ? data : [];
        await Promise.allSettled(
          items.map((item) => {
            const images = (item as { product_images?: { url: string }[] })?.product_images ?? [];
            return deleteProductImages(images);
          })
        );
      } catch {
        // Continue with delete even if fetch/remove fails
      }
    }
    return baseDataProvider.deleteMany(params);
  },
};
