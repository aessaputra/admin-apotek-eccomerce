import type {
  BaseRecord,
  DataProvider,
  GetOneParams,
  GetOneResponse,
} from "@refinedev/core";
import { dataProvider as supabaseDataProvider } from "@refinedev/supabase";
import { supabaseClient } from "./supabase-client";
import { ORDER_READ_RESOURCE } from "../constants/resources";
import { getStoragePathFromReference, MEDIA_BUCKET } from "../utils/storage";

const baseDataProvider = supabaseDataProvider(supabaseClient);

function mapOrdersReadResource(resource: string): string {
  return resource === "orders" ? ORDER_READ_RESOURCE : resource;
}

async function getOrderItems(orderId: string | number) {
  const { data, error } = await supabaseClient
    .from("order_items")
    .select("*, products(name)")
    .eq("order_id", String(orderId));

  if (error) {
    throw error;
  }

  return data ?? [];
}

async function deleteCategoryLogo(logoUrl: string | null | undefined): Promise<void> {
  if (!logoUrl) return;
  const path = getStoragePathFromReference(logoUrl, MEDIA_BUCKET);
  if (!path) return;
  await supabaseClient.storage.from(MEDIA_BUCKET).remove([path]);
}

async function deleteProductImages(productImages: { url: string }[]): Promise<void> {
  const deletions = (productImages || []).map(async (img) => {
    const path = getStoragePathFromReference(img.url, MEDIA_BUCKET);
    if (path) {
      await supabaseClient.storage.from(MEDIA_BUCKET).remove([path]);
    }
  });
  await Promise.allSettled(deletions);
}

async function deleteBannerMediaIfUnreferenced(
  mediaPath: string | null | undefined,
  deletingIds: string[]
): Promise<void> {
  if (!mediaPath) return;

  const deletingIdSet = new Set(deletingIds);
  const { data, error } = await supabaseClient
    .from("home_banners")
    .select("id")
    .eq("media_path", mediaPath);

  if (error) {
    throw error;
  }

  const rows = Array.isArray(data) ? (data as Array<{ id?: string | number }>) : [];
  const hasRemainingReference = rows.some((row) => {
    const id = typeof row.id === "string" || typeof row.id === "number" ? String(row.id) : "";
    return id.length > 0 && !deletingIdSet.has(id);
  });

  if (hasRemainingReference) {
    return;
  }

  await supabaseClient.storage.from(MEDIA_BUCKET).remove([mediaPath]);
}

export const dataProvider: DataProvider = {
  ...baseDataProvider,
  getList: async (params) => {
    // Keep the admin-facing Refine resource named `orders`, but serve reads from
    // the denormalized compatibility view built on top of orders/payments/shipments.
    return baseDataProvider.getList({
      ...params,
      resource: mapOrdersReadResource(params.resource),
    });
  },
  getMany: async (params) => {
    return baseDataProvider.getMany({
      ...params,
      resource: mapOrdersReadResource(params.resource),
    });
  },
  getOne: async <TData extends BaseRecord = BaseRecord>(
    params: GetOneParams,
  ): Promise<GetOneResponse<TData>> => {
    if (params.resource !== "orders") {
      return baseDataProvider.getOne<TData>(params);
    }

    // Order detail reads come from the same compatibility view, then stitch
    // `order_items` back in because the view intentionally exposes only the
    // denormalized order/payment/shipment fields.
    const [{ data: order }, orderItems] = await Promise.all([
      baseDataProvider.getOne({
        ...params,
        resource: ORDER_READ_RESOURCE,
        meta: { ...params.meta, select: "*" },
      }),
      getOrderItems(params.id),
    ]);

    return {
      data: {
        ...(order as BaseRecord),
        order_items: orderItems,
      } as unknown as TData,
    };
  },
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
    if (params.resource === "home_banners") {
      try {
        const { data } = await baseDataProvider.getOne({
          resource: "home_banners",
          id: params.id,
          meta: params.meta,
        });
        const mediaPath = (data as { media_path?: string | null })?.media_path;
        await deleteBannerMediaIfUnreferenced(mediaPath, [String(params.id)]);
      } catch (error) {
        void error;
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
    if (params.resource === "home_banners") {
      try {
        const { data } = await baseDataProvider.getMany({
          resource: "home_banners",
          ids: params.ids,
          meta: params.meta,
        });
        const items = Array.isArray(data) ? data : [];
        const deletingIds = params.ids.map((id) => String(id));
        const uniqueMediaPaths = Array.from(
          new Set(
            items
              .map((item) => (item as { media_path?: string | null })?.media_path)
              .filter((value): value is string => typeof value === "string" && value.length > 0)
          )
        );

        await Promise.allSettled(
          uniqueMediaPaths.map((mediaPath) => deleteBannerMediaIfUnreferenced(mediaPath, deletingIds))
        );
      } catch (error) {
        void error;
      }
    }
    return baseDataProvider.deleteMany(params);
  },
};
