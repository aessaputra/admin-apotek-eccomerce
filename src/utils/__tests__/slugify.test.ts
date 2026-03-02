import { describe, it, expect } from "vitest";
import { slugify } from "../slugify";

describe("slugify", () => {
  it("should return an empty string for an empty string input", () => {
    expect(slugify("")).toBe("");
  });

  it("should return an empty string for null or undefined input", () => {
    // @ts-expect-error - testing invalid input
    expect(slugify(null)).toBe("");
    // @ts-expect-error - testing invalid input
    expect(slugify(undefined)).toBe("");
  });

  it("should convert a basic string to a slug", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("should remove special characters", () => {
    expect(slugify("Hello@World!")).toBe("helloworld");
  });

  it("should collapse multiple spaces and hyphens", () => {
    expect(slugify("hello---world")).toBe("hello-world");
    expect(slugify("hello   world")).toBe("hello-world");
  });

  it("should remove leading and trailing hyphens", () => {
    expect(slugify("-hello-")).toBe("hello");
  });

  it("should handle mixed case strings", () => {
    expect(slugify("FoO BaR")).toBe("foo-bar");
  });
});
