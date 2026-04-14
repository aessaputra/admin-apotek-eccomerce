import { describe, expect, it } from "vitest";

import {
  buildOrderEndpoint,
  buildPublicTrackingEndpoint,
  buildTrackingEndpoint,
} from "../biteship-public-tracking.ts";

describe("buildTrackingEndpoint", () => {
  it("trims and encodes tracking IDs safely", () => {
    expect(buildTrackingEndpoint("  TRACK/123  ")).toBe(
      "/v1/trackings/TRACK%2F123",
    );
  });

  it("throws when tracking ID is missing", () => {
    expect(() => buildTrackingEndpoint("   ")).toThrow(
      "Missing tracking ID for Biteship tracking",
    );
  });
});

describe("buildPublicTrackingEndpoint", () => {
  it("builds a public tracking endpoint with normalized courier code", () => {
    expect(buildPublicTrackingEndpoint("JNE-12345", "JNE")).toBe(
      "/v1/trackings/JNE-12345/couriers/jne",
    );
  });

  it("encodes path parameters safely", () => {
    expect(buildPublicTrackingEndpoint("ABC 123/45", "J&T Express")).toBe(
      "/v1/trackings/ABC%20123%2F45/couriers/j%26t%20express",
    );
  });

  it("throws when waybill number is missing", () => {
    expect(() => buildPublicTrackingEndpoint("   ", "jne")).toThrow(
      "Missing waybill number for public tracking",
    );
  });

  it("throws when courier code is missing", () => {
    expect(() => buildPublicTrackingEndpoint("JNE123", "   ")).toThrow(
      "Missing courier code for public tracking",
    );
  });
});

describe("buildOrderEndpoint", () => {
  it("trims and encodes order IDs safely", () => {
    expect(buildOrderEndpoint("  order/123  ")).toBe(
      "/v1/orders/order%2F123",
    );
  });

  it("throws when order ID is missing", () => {
    expect(() => buildOrderEndpoint("   ")).toThrow(
      "Missing Biteship order ID for order retrieval",
    );
  });
});
