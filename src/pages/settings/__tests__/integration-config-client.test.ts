import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  functionsInvoke: vi.fn(),
}));

vi.mock("../../../providers/supabase-client", () => ({
  supabaseClient: {
    functions: {
      invoke: mocks.functionsInvoke,
    },
  },
}));

vi.mock("../../../utils/functions-error", () => ({
  getFunctionsErrorMessage: vi.fn(async () => "Integration config request failed"),
}));

const { integrationConfigClient } = await import("../integration-config-client");

describe("integrationConfigClient request IDs", () => {
  beforeEach(() => {
    mocks.functionsInvoke.mockReset();
    mocks.functionsInvoke.mockResolvedValue({ data: { data: { ok: true } }, error: null });
  });

  it("sends x-request-id headers for secret rotation mutations", async () => {
    await integrationConfigClient.rotateSecret("midtrans.server_key", "secret-value", "settings_payment_save");

    expect(mocks.functionsInvoke).toHaveBeenCalledWith("integration-config", {
      body: {
        action: "rotateSecret",
        key: "midtrans.server_key",
        secret: "secret-value",
        reason: "settings_payment_save",
      },
      headers: {
        "x-request-id": expect.stringMatching(/^[A-Za-z0-9._:/=-]{1,128}$/),
      },
    });
  });

  it("sends x-request-id headers for value update mutations", async () => {
    await integrationConfigClient.updateValue("cors.allowed_origins", ["https://admin.example.test"], "settings_technical_save");

    expect(mocks.functionsInvoke).toHaveBeenCalledWith("integration-config", {
      body: {
        action: "updateValue",
        key: "cors.allowed_origins",
        value: ["https://admin.example.test"],
        reason: "settings_technical_save",
      },
      headers: {
        "x-request-id": expect.stringMatching(/^[A-Za-z0-9._:/=-]{1,128}$/),
      },
    });
  });
});
