import { describe, it, expect } from "vitest";
import { generateSkuCandidate, isDuplicateSkuError, isValidSku, normalizeSku } from "../sku";

describe("sku utils", () => {
  describe("normalizeSku", () => {
    it("normalizes whitespace, separators, and case", () => {
      expect(normalizeSku(" abc 123 ")).toBe("ABC-123");
      expect(normalizeSku("SKU--BAD")).toBe("SKU-BAD");
      expect(normalizeSku("  obat vitamin c 1000 mg ")).toBe("OBAT-VITAMIN-C-1000-MG");
    });

    it("removes special and non-ascii characters", () => {
      expect(normalizeSku("café & tea!")).toBe("CAFE-TEA");
    });

    it("returns an empty string for blank input", () => {
      expect(normalizeSku("")).toBe("");
    });
  });

  describe("isValidSku", () => {
    it("accepts only raw normalized SKUs", () => {
      expect(isValidSku("ABC-123")).toBe(true);
      expect(isValidSku("abc-123")).toBe(false);
      expect(isValidSku("SKU--BAD")).toBe(false);
    });

    it("rejects invalid length and character boundaries", () => {
      expect(isValidSku("")).toBe(false);
      expect(isValidSku("ABC")).toBe(false);
      expect(isValidSku("A".repeat(51))).toBe(false);
      expect(isValidSku("-ABC")).toBe(false);
      expect(isValidSku("ABC-")).toBe(false);
      expect(isValidSku("ABC 123")).toBe(false);
      expect(isValidSku("ABC_123")).toBe(false);
    });

    it("accepts values within regex and length constraints", () => {
      expect(isValidSku("ABCD")).toBe(true);
      expect(isValidSku("A1-B2-C3")).toBe(true);
      expect(isValidSku("A".repeat(50))).toBe(true);
    });
  });

  describe("generateSkuCandidate", () => {
    it("uses normalized category and product phrase tokens with a 4-character suffix", () => {
      const candidate = generateSkuCandidate({
        categorySlugOrName: "obat herbal",
        productName: "vitamin c 1000 mg",
      });

      expect(candidate).toMatch(/^OBAT-VITAMIN-C-1000-[A-Z0-9]{4}$/);
      expect(candidate).toContain("VITAMIN-C-1000");
      expect(isValidSku(candidate)).toBe(true);
    });

    it("falls back to PRD and ITEM when inputs are blank", () => {
      const candidate = generateSkuCandidate({
        categorySlugOrName: "",
        productName: "",
      });

      expect(candidate).toMatch(/^PRD-ITEM-[A-Z0-9]{4}$/);
      expect(isValidSku(candidate)).toBe(true);
    });

    it("keeps the candidate within the allowed length", () => {
      const candidate = generateSkuCandidate({
        categorySlugOrName: "a".repeat(200),
        productName: "b".repeat(200),
      });

      expect(candidate.length).toBeLessThanOrEqual(50);
      expect(isValidSku(candidate)).toBe(true);
    });
  });

  describe("isDuplicateSkuError", () => {
    it("detects Postgres unique constraint errors by code", () => {
      expect(isDuplicateSkuError({ code: "23505", message: "anything" })).toBe(true);
    });

    it("detects duplicate SKU constraint messages", () => {
      expect(isDuplicateSkuError(new Error("duplicate key value violates unique constraint \"products_sku_key\""))).toBe(true);
      expect(isDuplicateSkuError({ message: "products_sku already exists" })).toBe(true);
    });

    it("ignores unrelated errors", () => {
      expect(isDuplicateSkuError(new Error("network unavailable"))).toBe(false);
      expect(isDuplicateSkuError(null)).toBe(false);
    });
  });
});
