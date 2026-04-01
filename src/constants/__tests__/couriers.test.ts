import { describe, expect, it } from "vitest";
import {
  BITESHIP_FALLBACK_COURIER_SERVICES,
  getCourierSelectionCompany,
  getFallbackCourierOption,
  normalizeCourierSelection,
  parseCouriers,
  serializeCouriers,
} from "../couriers";

describe("courier constants helpers", () => {
  describe("normalizeCourierSelection", () => {
    it("normalizes casing and whitespace for company-only selections", () => {
      expect(normalizeCourierSelection("  JNE ")).toBe("jne");
    });

    it("normalizes company and service selections", () => {
      expect(normalizeCourierSelection("  Grab : Same_Day  ")).toBe("grab:same_day");
    });

    it("returns null for empty or incomplete selections", () => {
      expect(normalizeCourierSelection("   ")).toBeNull();
      expect(normalizeCourierSelection("gojek:   ")).toBeNull();
      expect(normalizeCourierSelection(" :instant")).toBeNull();
    });
  });

  describe("getCourierSelectionCompany", () => {
    it("extracts the company code from normalized selections", () => {
      expect(getCourierSelectionCompany("Grab:Instant_Car")).toBe("grab");
      expect(getCourierSelectionCompany("jne")).toBe("jne");
    });

    it("returns null for invalid selections", () => {
      expect(getCourierSelectionCompany("   ")).toBeNull();
    });
  });

  describe("getFallbackCourierOption", () => {
    it("returns configured fallback options for known courier companies", () => {
      expect(getFallbackCourierOption(" grab ")).toEqual({
        value: "grab",
        label: "GrabExpress",
        description: "Grab - Instant & same day delivery",
      });
    });

    it("creates a generic fallback option for unknown courier companies", () => {
      expect(getFallbackCourierOption("fastship")).toEqual({
        value: "fastship",
        label: "FASTSHIP",
        description: "fastship",
      });
    });
  });

  describe("parseCouriers", () => {
    it("parses, normalizes, and de-duplicates persisted courier selections", () => {
      expect(parseCouriers(" JNE , grab:same_day,Grab:Same_Day, gojek:instant ")).toEqual([
        "jne",
        "grab:same_day",
        "gojek:instant",
      ]);
    });

    it("returns an empty array when persisted data is empty", () => {
      expect(parseCouriers("")) .toEqual([]);
      expect(parseCouriers(null)).toEqual([]);
      expect(parseCouriers(undefined)).toEqual([]);
    });
  });

  describe("serializeCouriers", () => {
    it("serializes selections for storage", () => {
      expect(serializeCouriers(["jne", "grab:same_day"])).toBe("jne,grab:same_day");
    });

    it("returns null for an empty courier selection list", () => {
      expect(serializeCouriers([])).toBeNull();
    });
  });

  it("keeps fallback courier services keyed by company and service", () => {
    expect(BITESHIP_FALLBACK_COURIER_SERVICES).toContainEqual(
      expect.objectContaining({
        key: "grab:instant",
        companyCode: "grab",
        serviceCode: "instant",
      })
    );
  });
});
