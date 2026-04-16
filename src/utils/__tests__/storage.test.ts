import { describe, it, expect } from "vitest";
import {
  sanitizeFilename,
  validateImageFile,
  getStoragePathFromPublicUrl,
  getStoragePathFromReference,
  getPublicUrlFromStoragePath,
  resolveStoragePublicUrl,
  MAX_IMAGE_SIZE_BYTES,
} from "../storage";

describe("storage utils", () => {
  describe("sanitizeFilename", () => {
    it("should remove path separators", () => {
      expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
      expect(sanitizeFilename("folder/subfolder/file.jpg")).toBe("file.jpg");
    });

    it("should return 'image' for empty or invalid input", () => {
      expect(sanitizeFilename("")).toBe("image");
      // @ts-expect-error - testing invalid input
      expect(sanitizeFilename(null)).toBe("image");
    });

    it("should return normal filename as is", () => {
      expect(sanitizeFilename("photo.jpg")).toBe("photo.jpg");
    });

    it("should replace special characters with underscores", () => {
      expect(sanitizeFilename("my file (1).png")).toBe("my_file__1_.png");
    });

    it("should truncate to 100 characters", () => {
      const longName = "a".repeat(150) + ".jpg";
      const sanitized = sanitizeFilename(longName);
      expect(sanitized.length).toBe(100);
      expect(sanitized).toBe("a".repeat(100));
    });
  });

  describe("validateImageFile", () => {
    it("should return valid for a correct JPEG file", () => {
      const file = new File(["test"], "test.jpg", { type: "image/jpeg" });
      expect(validateImageFile(file)).toEqual({ valid: true });
    });

    it("should return error for file that is too large", () => {
      const largeSize = MAX_IMAGE_SIZE_BYTES + 1024;
      const file = new File([new ArrayBuffer(largeSize)], "big.jpg", {
        type: "image/jpeg",
      });
      const result = validateImageFile(file);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("5MB");
    });

    it("should return error for invalid MIME type", () => {
      const file = new File(["test"], "test.txt", { type: "text/plain" });
      const result = validateImageFile(file);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("JPG");
    });
  });

  describe("getStoragePathFromPublicUrl", () => {
    const bucket = "media";
    const baseUrl = "https://example.supabase.co/storage/v1/object/public";

    it("should extract path correctly from a valid URL", () => {
      const path = "products/item1.jpg";
      const url = `${baseUrl}/${bucket}/${path}`;
      expect(getStoragePathFromPublicUrl(url, bucket)).toBe(path);
    });

    it("should return null for paths containing '..'", () => {
      const url = `${baseUrl}/${bucket}/../secret.txt`;
      expect(getStoragePathFromPublicUrl(url, bucket)).toBe(null);
    });

    it("should return null for empty string", () => {
      expect(getStoragePathFromPublicUrl("", bucket)).toBe(null);
    });

    it("should return null for non-matching URL", () => {
      const url = "https://other-site.com/file.jpg";
      expect(getStoragePathFromPublicUrl(url, bucket)).toBe(null);
    });
  });

  describe("getStoragePathFromReference", () => {
    const bucket = "media";

    it("supports both public URLs and bucket-relative paths", () => {
      expect(
        getStoragePathFromReference(
          "https://example.supabase.co/storage/v1/object/public/media/products/item1.jpg",
          bucket,
        ),
      ).toBe("products/item1.jpg");

      expect(getStoragePathFromReference("products/item1.jpg", bucket)).toBe("products/item1.jpg");
    });

    it("rejects unsafe or empty references", () => {
      expect(getStoragePathFromReference("", bucket)).toBeNull();
      expect(getStoragePathFromReference("../secret.txt", bucket)).toBeNull();
      expect(getStoragePathFromReference("products//item1.jpg", bucket)).toBeNull();
    });
  });

  describe("public URL helpers", () => {
    it("builds and resolves public URLs from relative paths and preserves remote URLs", () => {
      const expectedBaseUrl = import.meta.env.VITE_SUPABASE_URL;

      expect(getPublicUrlFromStoragePath("products/item1.jpg", "media")).toBe(
        `${expectedBaseUrl}/storage/v1/object/public/media/products/item1.jpg`,
      );
      expect(resolveStoragePublicUrl("products/item1.jpg", "media")).toBe(
        `${expectedBaseUrl}/storage/v1/object/public/media/products/item1.jpg`,
      );
      expect(resolveStoragePublicUrl("https://cdn.example.com/media/item1.jpg", "media")).toBe(
        "https://cdn.example.com/media/item1.jpg",
      );
    });
  });
});
