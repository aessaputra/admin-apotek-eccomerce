import { describe, expect, it } from "vitest";

import {
  resolveRequestId,
  withRequestIdHeader,
  withRequestIdResponse,
} from "../request-id.ts";

function headersWithRequestId(value: string | null): Pick<Headers, "get"> {
  return {
    get: (name: string) => name.toLowerCase() === "x-request-id" ? value : null,
  };
}

describe("request ID helpers", () => {
  it("preserves a valid incoming request ID", () => {
    const requestId = resolveRequestId(headersWithRequestId("admin-request_123"), {
      generate: () => "generated-request-id",
    });

    expect(requestId).toBe("admin-request_123");
  });

  it("generates a fallback when the incoming request ID is absent", () => {
    const requestId = resolveRequestId(headersWithRequestId(null), {
      generate: () => "generated-request-id",
    });

    expect(requestId).toBe("generated-request-id");
  });

  it("replaces oversized incoming request IDs", () => {
    const oversizedRequestId = "a".repeat(129);

    const requestId = resolveRequestId(headersWithRequestId(oversizedRequestId), {
      generate: () => "generated-request-id",
    });

    expect(requestId).toBe("generated-request-id");
  });

  it("replaces newline and control-character request IDs", () => {
    const requestId = resolveRequestId(headersWithRequestId("unsafe\nrequest"), {
      generate: () => "generated-request-id",
    });
    const controlRequestId = resolveRequestId(headersWithRequestId("unsafe\u0001request"), {
      generate: () => "generated-control-id",
    });

    expect(requestId).toBe("generated-request-id");
    expect(controlRequestId).toBe("generated-control-id");
  });

  it("replaces non-ASCII and log-unsafe request IDs", () => {
    const nonAsciiRequestId = resolveRequestId(headersWithRequestId("req-é"), {
      generate: () => "generated-non-ascii-id",
    });
    const logUnsafeRequestId = resolveRequestId(headersWithRequestId("req with spaces"), {
      generate: () => "generated-log-safe-id",
    });

    expect(nonAsciiRequestId).toBe("generated-non-ascii-id");
    expect(logUnsafeRequestId).toBe("generated-log-safe-id");
  });

  it("preserves existing headers while adding x-request-id", () => {
    const headers = withRequestIdHeader(
      {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
      "request-123",
    );

    expect(headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("x-request-id")).toBe("request-123");
  });

  it("preserves response status, body, and headers while adding x-request-id", async () => {
    const response = withRequestIdResponse(
      new Response(JSON.stringify({ ok: true }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      }),
      "request-123",
    );

    expect(response.status).toBe(202);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(response.headers.get("x-request-id")).toBe("request-123");
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
