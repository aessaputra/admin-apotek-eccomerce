import { describe, it, expect } from "vitest";
import { getFunctionsErrorMessage } from "../functions-error";

interface ErrorWithContext extends Error {
  context?: { json: () => Promise<{ error?: string }> };
}
describe("getFunctionsErrorMessage", () => {
  const fallback = "An unexpected error occurred";

  it("should return fallback for null error", async () => {
    const result = await getFunctionsErrorMessage(null, fallback);
    expect(result).toBe(fallback);
  });

  it("should return error.message for a regular Error", async () => {
    const error = new Error("Regular error message");
    const result = await getFunctionsErrorMessage(error, fallback);
    expect(result).toBe("Regular error message");
  });

  it("should return message from context.json() if available", async () => {
    const error: ErrorWithContext = new Error("Original message");
    error.context = {
      json: async () => ({ error: "Detailed error from function" }),
    };
    const result = await getFunctionsErrorMessage(error, fallback);
    expect(result).toBe("Detailed error from function");
  });

  it("should return error.message if context.json() throws", async () => {
    const error: ErrorWithContext = new Error("Original message");
    error.context = {
      json: async () => {
        throw new Error("JSON parse failed");
      },
    };
    const result = await getFunctionsErrorMessage(error, fallback);
    expect(result).toBe("Original message");
  });

  it("should return fallback for non-Error values", async () => {
    const result = await getFunctionsErrorMessage("string error", fallback);
    expect(result).toBe(fallback);
  });
});
