import type {
  BaseRecord,
  DataProvider,
  GetListResponse,
  GetManyResponse,
  GetOneParams,
  GetOneResponse,
} from "@refinedev/core";
import { dataProvider as supabaseDataProvider } from "@refinedev/supabase";
import { supabaseClient } from "./supabase-client";
import { ORDER_READ_RESOURCE } from "../constants/resources";
import { getStoragePathFromReference, MEDIA_BUCKET } from "../utils/storage";

const baseDataProvider = supabaseDataProvider(supabaseClient);
const PRODUCT_READ_RESOURCE = "admin_products";
const OPERATIONAL_METRICS_RESOURCE = "admin_operational_metrics";
const PRODUCT_IMAGE_CLEANUP_SELECT = "id, product_images(url)";

// Explicit column list for product mutations (INSERT/UPDATE RETURNING).
// The `sku` column has column-level SELECT revoked from `authenticated` to
// protect it from customer reads, so `RETURNING *` fails with 42501.
// Mutations list every column except `sku` to avoid the permission error.
const PRODUCT_MUTATION_SELECT =
  "id, category_id, name, slug, description, price, stock, is_active, weight, created_at, updated_at";

type DataProviderGetListParams = Parameters<NonNullable<DataProvider["getList"]>>[0];
type DataProviderGetManyParams = Parameters<NonNullable<DataProvider["getMany"]>>[0];

interface AdminProductRecord extends BaseRecord {
  images?: unknown;
  product_images?: unknown;
  category_name?: string | null;
  category_slug?: string | null;
  categories?: unknown;
}

interface AdminOrderItemRecord {
  product_name?: string | null;
}

interface AdminOrderRecord extends BaseRecord {
  user_id?: string | null;
  shipping_address_id?: string | null;
}

interface AdminOrderCustomerRecord extends BaseRecord {
  full_name?: string | null;
  phone_number?: string | null;
  email?: string | null;
}

interface AdminShippingAddressRecord extends BaseRecord {
  receiver_name?: string | null;
  phone_number?: string | null;
  street_address?: string | null;
  city?: string | null;
  province?: string | null;
  postal_code?: string | null;
  area_name?: string | null;
  address_note?: string | null;
  country_code?: string | null;
}

interface AdminOperationalMetricRecord extends BaseRecord {
  bucket_start: string;
  bucket_end: string;
  order_count: string | number;
  paid_order_count: string | number;
  completed_order_count: string | number;
  revenue: string | number;
}

function mapReadResource(resource: string): string {
  if (resource === "orders") return ORDER_READ_RESOURCE;
  if (resource === "products") return PRODUCT_READ_RESOURCE;
  return resource;
}

function withProductReadMeta<TParams extends { resource: string; meta?: Record<string, unknown> }>(params: TParams): TParams {
  if (params.resource !== "products") return params;

  return {
    ...params,
    meta: { ...params.meta, select: "*" },
  };
}

function normalizeAdminProduct<TData extends BaseRecord = BaseRecord>(record: TData): TData {
  const adminRecord = record as TData & AdminProductRecord;
  const categoryName = adminRecord.category_name;
  const categorySlug = adminRecord.category_slug;

  return {
    ...adminRecord,
    product_images: Array.isArray(adminRecord.product_images)
      ? adminRecord.product_images
      : Array.isArray(adminRecord.images)
        ? adminRecord.images
        : [],
    categories: adminRecord.categories ?? (categoryName || categorySlug
      ? { name: categoryName ?? "", slug: categorySlug ?? undefined }
      : null),
  } as TData;
}

function normalizeAdminProducts<TData extends BaseRecord = BaseRecord>(records: TData[]): TData[] {
  return records.map((record) => normalizeAdminProduct(record));
}

function normalizeOrderItem(row: AdminOrderItemRecord) {
  return {
    ...row,
    products: { name: row.product_name ?? "" },
  };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getFilterValue(filters: DataProviderGetListParams["filters"], field: string): unknown {
  return filters?.find((filter) => "field" in filter && filter.field === field)?.value;
}

function requireStringFilter(filters: DataProviderGetListParams["filters"], field: string): string {
  const value = getFilterValue(filters, field);

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required dashboard metrics filter: ${field}`);
  }

  return value;
}

function normalizeOperationalMetricRecord(row: unknown): AdminOperationalMetricRecord {
  if (!isObjectRecord(row)) {
    throw new Error("Unexpected dashboard metrics response row");
  }

  const bucketStart = row.bucket_start;
  const bucketEnd = row.bucket_end;

  if (typeof bucketStart !== "string" || typeof bucketEnd !== "string") {
    throw new Error("Dashboard metrics response is missing bucket dates");
  }

  return {
    id: bucketStart,
    bucket_start: bucketStart,
    bucket_end: bucketEnd,
    order_count: normalizeMetricNumber(row.order_count),
    paid_order_count: normalizeMetricNumber(row.paid_order_count),
    completed_order_count: normalizeMetricNumber(row.completed_order_count),
    revenue: normalizeMetricNumber(row.revenue),
  };
}

function normalizeMetricNumber(value: unknown): string | number {
  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "string" || typeof value === "number") {
    return value;
  }

  return 0;
}

async function getAdminOperationalMetrics<TData extends BaseRecord = BaseRecord>(
  params: DataProviderGetListParams,
): Promise<GetListResponse<TData>> {
  const { data, error } = await supabaseClient.rpc("admin_operational_metrics", {
    p_granularity: requireStringFilter(params.filters, "granularity"),
    p_start_date: requireStringFilter(params.filters, "start_date"),
    p_end_date: requireStringFilter(params.filters, "end_date"),
  });

  if (error) {
    throw error;
  }

  const rows = Array.isArray(data) ? data.map(normalizeOperationalMetricRecord) : [];

  return {
    data: rows.map((row) => row as unknown as TData),
    total: rows.length,
  };
}

async function getOrderItems(orderId: string | number) {
  const { data, error } = await supabaseClient
    .from("admin_order_items")
    .select("id, order_id, product_id, product_name, quantity, price_at_purchase, product_sku_at_purchase, created_at")
    .eq("order_id", String(orderId));

  if (error) {
    throw error;
  }

  return (data ?? []).map(normalizeOrderItem);
}

async function getOrderCustomer(userId: unknown): Promise<AdminOrderCustomerRecord | null> {
  if (typeof userId !== "string" || userId.length === 0) {
    return null;
  }

  const { data, error } = await supabaseClient
    .from("profiles")
    .select("id, full_name, phone_number, email")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data as AdminOrderCustomerRecord | null;
}

async function getShippingAddress(addressId: unknown): Promise<AdminShippingAddressRecord | null> {
  if (typeof addressId !== "string" || addressId.length === 0) {
    return null;
  }

  const { data, error } = await supabaseClient
    .from("addresses")
    .select("id, receiver_name, phone_number, street_address, city, province, postal_code, area_name, address_note, country_code")
    .eq("id", addressId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data as AdminShippingAddressRecord | null;
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
  create: async (params) => {
    if (params.resource === "products") {
      return baseDataProvider.create({
        ...params,
        meta: { ...params.meta, select: PRODUCT_MUTATION_SELECT },
      });
    }
    return baseDataProvider.create(params);
  },
  update: async (params) => {
    if (params.resource === "products") {
      return baseDataProvider.update({
        ...params,
        meta: { ...params.meta, select: PRODUCT_MUTATION_SELECT },
      });
    }
    return baseDataProvider.update(params);
  },
  getList: async <TData extends BaseRecord = BaseRecord>(
    params: DataProviderGetListParams,
  ): Promise<GetListResponse<TData>> => {
    if (params.resource === OPERATIONAL_METRICS_RESOURCE) {
      return getAdminOperationalMetrics<TData>(params);
    }

    // Keep admin-facing Refine resource names stable, while serving protected
    // order/product reads from admin-safe read models. Mutations still use base tables.
    const result = await baseDataProvider.getList<TData>({
      ...withProductReadMeta(params),
      resource: mapReadResource(params.resource),
    });

    if (params.resource !== "products") {
      return result;
    }

    return {
      ...result,
      data: normalizeAdminProducts(result.data),
    };
  },
  getMany: async <TData extends BaseRecord = BaseRecord>(
    params: DataProviderGetManyParams,
  ): Promise<GetManyResponse<TData>> => {
    const result = await baseDataProvider.getMany<TData>({
      ...withProductReadMeta(params),
      resource: mapReadResource(params.resource),
    });

    if (params.resource !== "products") {
      return result;
    }

    return {
      ...result,
      data: normalizeAdminProducts(result.data),
    };
  },
  getOne: async <TData extends BaseRecord = BaseRecord>(
    params: GetOneParams,
  ): Promise<GetOneResponse<TData>> => {
    if (params.resource === "products") {
      const result = await baseDataProvider.getOne<TData>({
        ...withProductReadMeta(params),
        resource: PRODUCT_READ_RESOURCE,
      });

      return {
        ...result,
        data: normalizeAdminProduct(result.data),
      };
    }

    if (params.resource !== "orders") {
      return baseDataProvider.getOne<TData>(params);
    }

    // Order detail reads come from the same compatibility view, then stitch
    // `order_items` back in because the view intentionally exposes only the
    // denormalized order/payment/shipment fields.
    const [{ data: orderData }, orderItems] = await Promise.all([
      baseDataProvider.getOne({
        ...params,
        resource: ORDER_READ_RESOURCE,
        meta: { ...params.meta, select: "*" },
      }),
      getOrderItems(params.id),
    ]);
    const order = orderData as AdminOrderRecord;
    const [customer, shippingAddress] = await Promise.all([
      getOrderCustomer(order.user_id),
      getShippingAddress(order.shipping_address_id),
    ]);

    return {
      data: {
        ...order,
        customer,
        shipping_address: shippingAddress,
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
          meta: { select: PRODUCT_IMAGE_CLEANUP_SELECT },
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
          meta: { select: PRODUCT_IMAGE_CLEANUP_SELECT },
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
