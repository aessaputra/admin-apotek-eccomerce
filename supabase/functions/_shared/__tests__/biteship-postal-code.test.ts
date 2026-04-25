import { describe, expect, it } from "vitest";

import { parseBiteshipPostalCode } from "../biteship-postal-code.ts";

describe("parseBiteshipPostalCode", () => {
  it.each([
    ["12345", 12345],
    [" 12345 ", 12345],
    [12345, 12345],
  ])("parses %s into the existing numeric Biteship payload representation", (value, expected) => {
    expect(parseBiteshipPostalCode(value, "destination_postal_code")).toBe(
      expected,
    );
  });

  it.each([
    null,
    undefined,
    "",
    "1234",
    "123456",
    "12A45",
    "40181.0",
    Number.NaN,
    0,
  ])("rejects invalid destination postal %s before payload construction", (value) => {
    expect(() =>
      parseBiteshipPostalCode(value, "destination_postal_code"),
    ).toThrow("destination_postal_code must be a valid 5-digit Indonesian postal code.");
  });

  it("names origin_postal_code in origin validation errors", () => {
    expect(() => parseBiteshipPostalCode("1234", "origin_postal_code")).toThrow(
      "origin_postal_code must be a valid 5-digit Indonesian postal code.",
    );
  });
});
