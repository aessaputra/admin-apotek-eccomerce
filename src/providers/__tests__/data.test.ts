import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const getList = vi.fn();
  const getOne = vi.fn();
  const getMany = vi.fn();
  const deleteOne = vi.fn();
  const deleteMany = vi.fn();
  const remove = vi.fn();
  const storageFrom = vi.fn(() => ({ remove }));
  const orderItemsEq = vi.fn();
  const orderItemsSelect = vi.fn(() => ({
    eq: orderItemsEq,
  }));
  const bannerSelectEq = vi.fn();
  const from = vi.fn((table: string) => {
    if (table === "admin_order_items") {
      return {
        select: orderItemsSelect,
      };
    }

    return {
      select: vi.fn(() => ({
        eq: bannerSelectEq,
      })),
    };
  });

  return {
    getList,
    getOne,
    getMany,
    deleteOne,
    deleteMany,
    remove,
    storageFrom,
    orderItemsEq,
    orderItemsSelect,
    bannerSelectEq,
    from,
  };
});

vi.mock("@refinedev/supabase", () => ({
  dataProvider: vi.fn(() => ({
    getList: mocks.getList,
    getOne: mocks.getOne,
    getMany: mocks.getMany,
    deleteOne: mocks.deleteOne,
    deleteMany: mocks.deleteMany,
  })),
}));

vi.mock("../supabase-client", () => ({
    supabaseClient: {
      from: mocks.from,
      storage: {
        from: mocks.storageFrom,
      },
  },
}));

import { dataProvider } from "../data";

describe("dataProvider custom deletes", () => {
  beforeEach(() => {
    mocks.getList.mockReset();
    mocks.getOne.mockReset();
    mocks.getMany.mockReset();
    mocks.deleteOne.mockReset();
    mocks.deleteMany.mockReset();
    mocks.remove.mockReset();
    mocks.storageFrom.mockClear();
    mocks.from.mockClear();
    mocks.orderItemsEq.mockReset();
    mocks.orderItemsSelect.mockClear();
    mocks.bannerSelectEq.mockReset();

    mocks.getList.mockResolvedValue({ data: [], total: 0 });
    mocks.deleteOne.mockResolvedValue({ data: { id: "1" } });
    mocks.deleteMany.mockResolvedValue({ data: [{ id: "1" }] });
    mocks.remove.mockResolvedValue({ data: [] });
    mocks.orderItemsEq.mockResolvedValue({ data: [], error: null });
    mocks.bannerSelectEq.mockResolvedValue({ data: [], error: null });
  });

  it("routes order list reads through order_read_model", async () => {
    const getListMethod = dataProvider.getList;

    expect(getListMethod).toBeTypeOf("function");

    if (!getListMethod) {
      throw new Error("getList is not implemented");
    }

    const params = {
      resource: "orders",
      pagination: { current: 1, pageSize: 10 },
      sorters: [],
      filters: [],
      meta: { select: "*" },
    };

    await getListMethod(params);

    expect(mocks.getList).toHaveBeenCalledWith({
      ...params,
      resource: "order_read_model",
    });
  });

  it("routes order batch reads through order_read_model", async () => {
    const getManyMethod = dataProvider.getMany;

    expect(getManyMethod).toBeTypeOf("function");

    if (!getManyMethod) {
      throw new Error("getMany is not implemented");
    }

    const params = {
      resource: "orders",
      ids: ["order-1", "order-2"],
      meta: { select: "*" },
    };

    await getManyMethod(params);

    expect(mocks.getMany).toHaveBeenCalledWith({
      ...params,
      resource: "order_read_model",
    });
  });

  it("routes product list reads through admin_products and normalizes view fields", async () => {
    const getListMethod = dataProvider.getList;

    expect(getListMethod).toBeTypeOf("function");

    if (!getListMethod) {
      throw new Error("getList is not implemented");
    }

    mocks.getList.mockResolvedValueOnce({
      data: [
        {
          id: "product-1",
          name: "Vitamin C",
          sku: "SUPP-VITAMIN-C-1000-AB12",
          images: [{ id: "image-1", url: "products/vitamin-c.png", sort_order: 0 }],
          category_name: "Supplements",
          category_slug: "supplements",
        },
      ],
      total: 1,
    });

    const params = {
      resource: "products",
      pagination: { current: 1, pageSize: 10 },
      sorters: [],
      filters: [],
      meta: { select: "*, product_images(*), categories(name)" },
    };

    const result = await getListMethod(params);

    expect(mocks.getList).toHaveBeenCalledWith({
      ...params,
      resource: "admin_products",
      meta: { select: "*" },
    });
    expect(result.data[0]).toMatchObject({
      id: "product-1",
      sku: "SUPP-VITAMIN-C-1000-AB12",
      product_images: [{ id: "image-1", url: "products/vitamin-c.png", sort_order: 0 }],
      categories: { name: "Supplements", slug: "supplements" },
    });
  });

  it("routes product detail reads through admin_products", async () => {
    const getOneMethod = dataProvider.getOne;

    expect(getOneMethod).toBeTypeOf("function");

    if (!getOneMethod) {
      throw new Error("getOne is not implemented");
    }

    mocks.getOne.mockResolvedValueOnce({
      data: {
        id: "product-1",
        name: "Vitamin C",
        sku: "SUPP-VITAMIN-C-1000-AB12",
        images: [],
        category_name: null,
      },
    });

    const params = {
      resource: "products",
      id: "product-1",
      meta: { select: "id, product_images(url)" },
    };

    const result = await getOneMethod(params);

    expect(mocks.getOne).toHaveBeenCalledWith({
      ...params,
      resource: "admin_products",
      meta: { select: "*" },
    });
    expect(result.data).toMatchObject({
      id: "product-1",
      sku: "SUPP-VITAMIN-C-1000-AB12",
      product_images: [],
      categories: null,
    });
  });

  it("routes product batch reads through admin_products", async () => {
    const getManyMethod = dataProvider.getMany;

    expect(getManyMethod).toBeTypeOf("function");

    if (!getManyMethod) {
      throw new Error("getMany is not implemented");
    }

    mocks.getMany.mockResolvedValueOnce({
      data: [{ id: "product-1", images: [], category_name: "Supplements" }],
    });

    const params = {
      resource: "products",
      ids: ["product-1"],
      meta: { select: "id, sku" },
    };

    const result = await getManyMethod(params);

    expect(mocks.getMany).toHaveBeenCalledWith({
      ...params,
      resource: "admin_products",
      meta: { select: "*" },
    });
    expect(result.data[0]).toMatchObject({
      id: "product-1",
      product_images: [],
      categories: { name: "Supplements" },
    });
  });

  it("hydrates order detail from order_read_model and merges order_items", async () => {
    const getOneMethod = dataProvider.getOne;

    expect(getOneMethod).toBeTypeOf("function");

    if (!getOneMethod) {
      throw new Error("getOne is not implemented");
    }

    mocks.getOne.mockResolvedValueOnce({
      data: {
        id: "order-1",
        payment_status: "settlement",
        waybill_number: "WB-123",
      },
    });
    mocks.orderItemsEq.mockResolvedValueOnce({
      data: [
        {
          id: "item-1",
          order_id: "order-1",
          quantity: 2,
          product_sku_at_purchase: "PRC-001",
          product_name: "Paracetamol",
        },
      ],
      error: null,
    });

    const result = await getOneMethod({
      resource: "orders",
      id: "order-1",
      meta: { select: "*, order_items(*, products(name))" },
    });

    expect(mocks.getOne).toHaveBeenCalledWith({
      resource: "order_read_model",
      id: "order-1",
      meta: { select: "*" },
    });
    expect(mocks.from).toHaveBeenCalledWith("admin_order_items");
    expect(mocks.orderItemsSelect).toHaveBeenCalledWith(
      "id, order_id, product_id, product_name, quantity, price_at_purchase, product_sku_at_purchase, created_at"
    );
    expect(mocks.orderItemsEq).toHaveBeenCalledWith("order_id", "order-1");
    expect(result).toEqual({
      data: {
        id: "order-1",
        payment_status: "settlement",
        waybill_number: "WB-123",
        order_items: [
          {
            id: "item-1",
            order_id: "order-1",
            quantity: 2,
            product_sku_at_purchase: "PRC-001",
            product_name: "Paracetamol",
            products: { name: "Paracetamol" },
          },
        ],
      },
    });
  });

  it("keeps non-order and non-product reads on their original resources", async () => {
    const getOneMethod = dataProvider.getOne;

    expect(getOneMethod).toBeTypeOf("function");

    if (!getOneMethod) {
      throw new Error("getOne is not implemented");
    }

    const params = {
      resource: "categories",
      id: "cat-1",
      meta: { select: "*" },
    };

    await getOneMethod(params);

    expect(mocks.getOne).toHaveBeenCalledWith(params);
  });

  it("removes a category logo from storage before deleting the record", async () => {
    mocks.getOne.mockResolvedValue({
      data: {
        id: "1",
        logo_url: "https://demo.supabase.co/storage/v1/object/public/media/categories/logo.png",
      },
    });

    const params = {
      resource: "categories",
      id: "1",
      meta: { select: "*" },
    };

    const result = await dataProvider.deleteOne(params);

    expect(mocks.getOne).toHaveBeenCalledWith({
      resource: "categories",
      id: "1",
      meta: { select: "*" },
    });
    expect(mocks.storageFrom).toHaveBeenCalledWith("media");
    expect(mocks.remove).toHaveBeenCalledWith(["categories/logo.png"]);
    expect(mocks.deleteOne).toHaveBeenCalledWith(params);
    expect(result).toEqual({ data: { id: "1" } });
  });

  it("removes product images for valid storage URLs before bulk delete", async () => {
    mocks.getMany.mockResolvedValue({
      data: [
        {
          id: "product-1",
          product_images: [
            {
              url: "https://demo.supabase.co/storage/v1/object/public/media/products/a.png",
            },
            {
              url: "https://other-site.com/not-storage.png",
            },
          ],
        },
        {
          id: "product-2",
          product_images: [
            {
              url: "https://demo.supabase.co/storage/v1/object/public/media/products/b.png",
            },
          ],
        },
      ],
    });

    const params = {
      resource: "products",
      ids: ["product-1", "product-2"],
    };

    const deleteManyMethod = dataProvider.deleteMany;

    expect(deleteManyMethod).toBeTypeOf("function");

    if (!deleteManyMethod) {
      throw new Error("deleteMany is not implemented");
    }

    const result = await deleteManyMethod(params);

    expect(mocks.getMany).toHaveBeenCalledWith({
      resource: "products",
      ids: ["product-1", "product-2"],
      meta: { select: "id, product_images(url)" },
    });
    expect(mocks.remove).toHaveBeenCalledWith(["products/a.png"]);
    expect(mocks.remove).toHaveBeenCalledWith(["products/b.png"]);
    expect(mocks.deleteMany).toHaveBeenCalledWith(params);
    expect(result).toEqual({ data: [{ id: "1" }] });
  });

  it("removes product images from storage before deleting a single product", async () => {
    mocks.getOne.mockResolvedValue({
      data: {
        id: "product-1",
        product_images: [
          {
            url: "https://demo.supabase.co/storage/v1/object/public/media/products/main.png",
          },
          {
            url: "https://demo.supabase.co/storage/v1/object/public/media/products/gallery.png",
          },
        ],
      },
    });

    const params = {
      resource: "products",
      id: "product-1",
    };

    const result = await dataProvider.deleteOne(params);

    expect(mocks.getOne).toHaveBeenCalledWith({
      resource: "products",
      id: "product-1",
      meta: { select: "id, product_images(url)" },
    });
    expect(mocks.remove).toHaveBeenCalledWith(["products/main.png"]);
    expect(mocks.remove).toHaveBeenCalledWith(["products/gallery.png"]);
    expect(mocks.deleteOne).toHaveBeenCalledWith(params);
    expect(result).toEqual({ data: { id: "1" } });
  });

  it("removes category logos before bulk deleting categories", async () => {
    mocks.getMany.mockResolvedValue({
      data: [
        {
          id: "category-1",
          logo_url: "https://demo.supabase.co/storage/v1/object/public/media/categories/analgesic.png",
        },
        {
          id: "category-2",
          logo_url: null,
        },
      ],
    });

    const params = {
      resource: "categories",
      ids: ["category-1", "category-2"],
      meta: { select: "*" },
    };

    const deleteManyMethod = dataProvider.deleteMany;

    expect(deleteManyMethod).toBeTypeOf("function");

    if (!deleteManyMethod) {
      throw new Error("deleteMany is not implemented");
    }

    const result = await deleteManyMethod(params);

    expect(mocks.getMany).toHaveBeenCalledWith({
      resource: "categories",
      ids: ["category-1", "category-2"],
      meta: { select: "*" },
    });
    expect(mocks.remove).toHaveBeenCalledWith(["categories/analgesic.png"]);
    expect(mocks.deleteMany).toHaveBeenCalledWith(params);
    expect(result).toEqual({ data: [{ id: "1" }] });
  });

  it("continues deleting categories when logo cleanup lookup fails", async () => {
    mocks.getOne.mockRejectedValue(new Error("lookup failed"));

    await expect(
      dataProvider.deleteOne({
        resource: "categories",
        id: "1",
      })
    ).resolves.toEqual({ data: { id: "1" } });

    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.deleteOne).toHaveBeenCalledWith({
      resource: "categories",
      id: "1",
    });
  });

  it("removes a home banner media file when no other banner references it", async () => {
    mocks.getOne.mockResolvedValue({
      data: {
        id: "banner-1",
        media_path: "banners/home_banner_top/banner-a.webp",
      },
    });
    mocks.bannerSelectEq.mockResolvedValue({
      data: [{ id: "banner-1" }],
      error: null,
    });

    const params = {
      resource: "home_banners",
      id: "banner-1",
      meta: { select: "*" },
    };

    const result = await dataProvider.deleteOne(params);

    expect(mocks.getOne).toHaveBeenCalledWith({
      resource: "home_banners",
      id: "banner-1",
      meta: { select: "*" },
    });
    expect(mocks.from).toHaveBeenCalledWith("home_banners");
    expect(mocks.bannerSelectEq).toHaveBeenCalledWith("media_path", "banners/home_banner_top/banner-a.webp");
    expect(mocks.remove).toHaveBeenCalledWith(["banners/home_banner_top/banner-a.webp"]);
    expect(mocks.deleteOne).toHaveBeenCalledWith(params);
    expect(result).toEqual({ data: { id: "1" } });
  });

  it("keeps a home banner media file when another banner still references it", async () => {
    mocks.getOne.mockResolvedValue({
      data: {
        id: "banner-1",
        media_path: "banners/home_banner_top/shared.webp",
      },
    });
    mocks.bannerSelectEq.mockResolvedValue({
      data: [{ id: "banner-1" }, { id: "banner-2" }],
      error: null,
    });

    await expect(
      dataProvider.deleteOne({
        resource: "home_banners",
        id: "banner-1",
      })
    ).resolves.toEqual({ data: { id: "1" } });

    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.deleteOne).toHaveBeenCalledWith({
      resource: "home_banners",
      id: "banner-1",
    });
  });

  it("removes a shared home banner media file once all referencing banners are deleted together", async () => {
    mocks.getMany.mockResolvedValue({
      data: [
        {
          id: "banner-1",
          media_path: "banners/home_banner_bottom/shared.webp",
        },
        {
          id: "banner-2",
          media_path: "banners/home_banner_bottom/shared.webp",
        },
      ],
    });
    mocks.bannerSelectEq.mockResolvedValue({
      data: [{ id: "banner-1" }, { id: "banner-2" }],
      error: null,
    });

    const deleteManyMethod = dataProvider.deleteMany;

    if (!deleteManyMethod) {
      throw new Error("deleteMany is not implemented");
    }

    const result = await deleteManyMethod({
      resource: "home_banners",
      ids: ["banner-1", "banner-2"],
      meta: { select: "*" },
    });

    expect(mocks.getMany).toHaveBeenCalledWith({
      resource: "home_banners",
      ids: ["banner-1", "banner-2"],
      meta: { select: "*" },
    });
    expect(mocks.remove).toHaveBeenCalledWith(["banners/home_banner_bottom/shared.webp"]);
    expect(mocks.deleteMany).toHaveBeenCalledWith({
      resource: "home_banners",
      ids: ["banner-1", "banner-2"],
      meta: { select: "*" },
    });
    expect(result).toEqual({ data: [{ id: "1" }] });
  });
});
