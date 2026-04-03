import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const getOne = vi.fn();
  const getMany = vi.fn();
  const deleteOne = vi.fn();
  const deleteMany = vi.fn();
  const remove = vi.fn();
  const storageFrom = vi.fn(() => ({ remove }));
  const bannerSelectEq = vi.fn();
  const from = vi.fn(() => ({
    select: vi.fn(() => ({
      eq: bannerSelectEq,
    })),
  }));

  return {
    getOne,
    getMany,
    deleteOne,
    deleteMany,
    remove,
    storageFrom,
    bannerSelectEq,
    from,
  };
});

vi.mock("@refinedev/supabase", () => ({
  dataProvider: vi.fn(() => ({
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
    mocks.getOne.mockReset();
    mocks.getMany.mockReset();
    mocks.deleteOne.mockReset();
    mocks.deleteMany.mockReset();
    mocks.remove.mockReset();
    mocks.storageFrom.mockClear();
    mocks.from.mockClear();
    mocks.bannerSelectEq.mockReset();

    mocks.deleteOne.mockResolvedValue({ data: { id: "1" } });
    mocks.deleteMany.mockResolvedValue({ data: [{ id: "1" }] });
    mocks.remove.mockResolvedValue({ data: [] });
    mocks.bannerSelectEq.mockResolvedValue({ data: [], error: null });
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
      meta: { select: "*, product_images(*)" },
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
      meta: { select: "*, product_images(*)" },
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
