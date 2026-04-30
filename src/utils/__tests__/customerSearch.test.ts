import { describe, expect, it } from "vitest";
import {
  buildCustomerSearchFilter,
  CUSTOMER_SEARCH_FIELDS,
  CUSTOMER_SEARCH_MAX_LENGTH,
  normalizeCustomerSearchInput,
} from "../customerSearch";

describe("customer search utils", () => {
  it("returns null for nullish, empty, and whitespace-only input", () => {
    expect(normalizeCustomerSearchInput(null)).toBeNull();
    expect(normalizeCustomerSearchInput(undefined)).toBeNull();
    expect(normalizeCustomerSearchInput("")).toBeNull();
    expect(normalizeCustomerSearchInput("   ")).toBeNull();
    expect(buildCustomerSearchFilter(null)).toBeNull();
    expect(buildCustomerSearchFilter("   ")).toBeNull();
  });

  it("normalizes a basic search term into a Refine OR filter", () => {
    const filter = buildCustomerSearchFilter("andi");

    expect(filter).toEqual({
      operator: "or",
      value: [
        { field: "full_name", operator: "contains", value: "andi" },
        { field: "phone_number", operator: "contains", value: "andi" },
        { field: "email", operator: "contains", value: "andi" },
      ],
    });
  });

  it("uses only the allowlisted customer fields", () => {
    expect(CUSTOMER_SEARCH_FIELDS).toEqual(["full_name", "phone_number", "email"]);

    const filter = buildCustomerSearchFilter("andi");

    expect(filter?.value.map((item) => item.field)).toEqual(CUSTOMER_SEARCH_FIELDS);
  });

  it("trims and limits the raw search term to 100 characters", () => {
    const filter = buildCustomerSearchFilter(`  ${"a".repeat(CUSTOMER_SEARCH_MAX_LENGTH + 10)}  `);

    expect(normalizeCustomerSearchInput(`  ${"a".repeat(CUSTOMER_SEARCH_MAX_LENGTH + 10)}  `)).toBe(
      "a".repeat(CUSTOMER_SEARCH_MAX_LENGTH),
    );
    expect(filter?.value[0].value).toBe("a".repeat(CUSTOMER_SEARCH_MAX_LENGTH));
  });

  it("escapes special characters that could affect the OR filter syntax", () => {
    const specialInput = ["%", "_", ",", "(", ")", "'", '"', "\\"].join("");

    expect(normalizeCustomerSearchInput(specialInput)).toBe("\\%\\_\\,\\(\\)\\'\\\"\\\\");
    expect(buildCustomerSearchFilter(specialInput)).toEqual({
      operator: "or",
      value: [
        { field: "full_name", operator: "contains", value: "\\%\\_\\,\\(\\)\\'\\\"\\\\" },
        { field: "phone_number", operator: "contains", value: "\\%\\_\\,\\(\\)\\'\\\"\\\\" },
        { field: "email", operator: "contains", value: "\\%\\_\\,\\(\\)\\'\\\"\\\\" },
      ],
    });
  });
});
