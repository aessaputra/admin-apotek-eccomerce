import { describe, expect, it, vi } from "vitest";

import {
  collectReferencedMediaPaths,
  getCleanupRequestError,
  MEDIA_BUCKET,
  normalizeStorageReference,
} from "../cleanup-orphan-storage.ts";

describe("normalizeStorageReference", () => {
  it("extracts bucket-relative paths from supported Supabase URLs", () => {
    expect(
      normalizeStorageReference(
        "https://demo.supabase.co/storage/v1/object/public/media/categories/logo.png",
        MEDIA_BUCKET,
      ),
    ).toBe("categories/logo.png");

    expect(
      normalizeStorageReference(
        "https://demo.supabase.co/storage/v1/object/sign/media/banners/home_banner_top/banner.webp?token=abc",
        MEDIA_BUCKET,
      ),
    ).toBe("banners/home_banner_top/banner.webp");

    expect(
      normalizeStorageReference(
        "https://demo.supabase.co/storage/v1/object/authenticated/media/avatars/user.png",
        MEDIA_BUCKET,
      ),
    ).toBe("avatars/user.png");
  });

  it("accepts already-relative storage paths and rejects unsafe values", () => {
    expect(normalizeStorageReference("banners/home_banner_bottom/banner.webp", MEDIA_BUCKET)).toBe(
      "banners/home_banner_bottom/banner.webp",
    );

    expect(normalizeStorageReference("/banners/home_banner_bottom/banner.webp", MEDIA_BUCKET)).toBeNull();
    expect(normalizeStorageReference("banners//home_banner_bottom/banner.webp", MEDIA_BUCKET)).toBeNull();
    expect(normalizeStorageReference("../secret.txt", MEDIA_BUCKET)).toBeNull();
    expect(
      normalizeStorageReference(
        "https://demo.supabase.co/storage/v1/object/public/other-bucket/banner.webp",
        MEDIA_BUCKET,
      ),
    ).toBeNull();
    expect(
      normalizeStorageReference(
        "https://demo.supabase.co/storage/v1/object/public/media/banners/home_banner_top/%E0%A4%A.webp",
        MEDIA_BUCKET,
      ),
    ).toBeNull();
  });
});

describe("collectReferencedMediaPaths", () => {
  it("collects known media references including home banner paths", async () => {
    const select = vi.fn((columns: string) => ({
      range: vi.fn(() => {
        if (columns === "url") {
          return Promise.resolve({
            data: [
              { url: "https://demo.supabase.co/storage/v1/object/public/media/products/item-a.png" },
            ],
            error: null,
          });
        }

        if (columns === "logo_url") {
          return Promise.resolve({
            data: [{ logo_url: "https://demo.supabase.co/storage/v1/object/public/media/categories/logo.png" }],
            error: null,
          });
        }

        if (columns === "avatar_url") {
          return Promise.resolve({
            data: [{ avatar_url: "https://demo.supabase.co/storage/v1/object/public/media/avatars/user.png" }],
            error: null,
          });
        }

        if (columns === "media_path") {
          return Promise.resolve({
            data: [
              { media_path: "banners/home_banner_top/hero.webp" },
              { media_path: "banners/home_banner_top/hero.webp" },
              { media_path: "../unsafe.webp" },
            ],
            error: null,
          });
        }

        if (columns === "primary_logo_url, app_icon_url") {
          return Promise.resolve({
            data: [
              {
                primary_logo_url: "https://demo.supabase.co/storage/v1/object/public/media/settings/logo.webp",
                app_icon_url: null,
              },
            ],
            error: null,
          });
        }

        throw new Error(`Unexpected select: ${columns}`);
      }),
    }));

    const supabase = {
      from: vi.fn(() => ({ select })),
    };

    const result = await collectReferencedMediaPaths(supabase, MEDIA_BUCKET);

    expect(result.paths).toEqual(
      new Set([
        "products/item-a.png",
        "categories/logo.png",
        "avatars/user.png",
        "banners/home_banner_top/hero.webp",
        "settings/logo.webp",
      ]),
    );
    expect(result.invalidReferenceCount).toBe(1);
  });

  it("fails fast when one of the source queries errors", async () => {
    const supabase = {
      from: vi.fn((table: string) => ({
        select: vi.fn(() => ({
          range: vi.fn(() => {
            if (table === "home_banners") {
              return Promise.resolve({
                data: null,
                error: { message: "permission denied" },
              });
            }

            return Promise.resolve({ data: [], error: null });
          }),
        })),
      })),
    };

    await expect(collectReferencedMediaPaths(supabase, MEDIA_BUCKET)).rejects.toThrow(
      "Failed to load home_banners media references: permission denied",
    );
  });

  it("loads additional pages when a table exceeds the first page size", async () => {
    const range = vi.fn((from: number, to: number) => {
      if (from === 0 && to === 999) {
        return Promise.resolve({
          data: Array.from({ length: 1000 }, (_, index) => ({
            media_path: `banners/home_banner_top/${index}.webp`,
          })),
          error: null,
        });
      }

      if (from === 1000 && to === 1999) {
        return Promise.resolve({
          data: [{ media_path: "banners/home_banner_top/final.webp" }],
          error: null,
        });
      }

      return Promise.resolve({ data: [], error: null });
    });

    const supabase = {
      from: vi.fn((table: string) => ({
        select: vi.fn(() => ({
          range: table === "home_banners"
            ? range
            : vi.fn(() => Promise.resolve({ data: [], error: null })),
        })),
      })),
    };

    const result = await collectReferencedMediaPaths(supabase, MEDIA_BUCKET);

    expect(range).toHaveBeenCalledTimes(2);
    expect(result.paths.has("banners/home_banner_top/final.webp")).toBe(true);
    expect(result.invalidReferenceCount).toBe(0);
  });
});

describe("getCleanupRequestError", () => {
  it("rejects non-POST requests and invalid bearer tokens", () => {
    const headers = new Headers({ Authorization: "Bearer wrong-token" });

    expect(
      getCleanupRequestError({ method: "GET", headers }, "service-role"),
    ).toEqual({
      status: 405,
      body: { error: "Method Not Allowed" },
    });

    expect(
      getCleanupRequestError({ method: "POST", headers }, "service-role"),
    ).toEqual({
      status: 401,
      body: { error: "Unauthorized" },
    });
  });

  it("accepts exact service-role bearer tokens and reports misconfiguration", () => {
    const headers = new Headers({ Authorization: "Bearer service-role" });

    expect(getCleanupRequestError({ method: "POST", headers }, "service-role")).toBeNull();
    expect(getCleanupRequestError({ method: "POST", headers }, undefined)).toEqual({
      status: 500,
      body: { error: "SUPABASE_SERVICE_ROLE_KEY is not configured" },
    });
  });
});
