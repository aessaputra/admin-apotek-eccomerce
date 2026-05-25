import { beforeEach, describe, expect, it, vi } from "vitest";

const serveMock = vi.fn();

vi.stubGlobal("Deno", {
  env: { get: vi.fn(() => "service-role-key") },
  serve: serveMock,
});

vi.mock("../../_shared/webhook-side-effects.ts", () => ({
  listDueSideEffectTaskOrderIds: vi.fn(),
  processWebhookSideEffectTask: vi.fn(),
}));

const { createProcessWebhookSideEffectsHandler } = await import("../handler.ts");
const handlerImportServeCallCount = serveMock.mock.calls.length;

describe("process-webhook-side-effects handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not start Deno.serve when importing the handler factory", () => {
    expect(handlerImportServeCallCount).toBe(0);
  });

  it("rejects missing service-role bearer before DB access", async () => {
    const getAdminClient = vi.fn(() => ({}));
    const handler = createProcessWebhookSideEffectsHandler({
      getAdminClient,
      getServiceRoleKey: () => "service-role-key",
    });

    const response = await handler(new Request("https://example.test/functions/v1/process-webhook-side-effects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId: "order-1" }),
    }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(getAdminClient).not.toHaveBeenCalled();
  });

  it("processes one requested order id with a valid service-role bearer", async () => {
    const shared = await import("../../_shared/webhook-side-effects.ts");
    vi.mocked(shared.processWebhookSideEffectTask).mockResolvedValueOnce({
      processed: true,
      needsRetry: false,
      message: "processed",
    } as never);
    const adminClient = { marker: "admin" };
    const handler = createProcessWebhookSideEffectsHandler({
      getAdminClient: () => adminClient,
      getServiceRoleKey: () => "service-role-key",
    });

    const response = await handler(new Request("https://example.test/functions/v1/process-webhook-side-effects", {
      method: "POST",
      headers: {
        Authorization: "Bearer service-role-key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ orderId: "order-1" }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      processed_count: 1,
      attempted_count: 1,
      stopped_due_to_runtime_budget: false,
      results: [{
        orderId: "order-1",
        processed: true,
        needsRetry: false,
        message: "processed",
      }],
    });
    expect(shared.listDueSideEffectTaskOrderIds).not.toHaveBeenCalled();
    expect(shared.processWebhookSideEffectTask).toHaveBeenCalledWith(adminClient, "order-1");
  });

  it("uses safe default batch behavior for malformed JSON", async () => {
    const shared = await import("../../_shared/webhook-side-effects.ts");
    vi.mocked(shared.listDueSideEffectTaskOrderIds).mockResolvedValueOnce(["order-a"] as never);
    vi.mocked(shared.processWebhookSideEffectTask).mockResolvedValueOnce({
      processed: false,
      needsRetry: true,
      message: "retry",
    } as never);
    const adminClient = { marker: "admin" };
    const handler = createProcessWebhookSideEffectsHandler({
      getAdminClient: () => adminClient,
      getServiceRoleKey: () => "service-role-key",
    });

    const response = await handler(new Request("https://example.test/functions/v1/process-webhook-side-effects", {
      method: "POST",
      headers: {
        Authorization: "Bearer service-role-key",
        "Content-Type": "application/json",
      },
      body: "{",
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      processed_count: 0,
      attempted_count: 1,
      stopped_due_to_runtime_budget: false,
    });
    expect(shared.listDueSideEffectTaskOrderIds).toHaveBeenCalledWith(adminClient, 3);
    expect(shared.processWebhookSideEffectTask).toHaveBeenCalledWith(adminClient, "order-a");
  });

  it("redacts caught worker errors from caller responses", async () => {
    const logError = vi.fn();
    const handler = createProcessWebhookSideEffectsHandler({
      getAdminClient: () => {
        throw new Error("SUPABASE_SERVICE_ROLE_KEY missing at stack trace /internal/path.ts");
      },
      getServiceRoleKey: () => "service-role-key",
      logError,
    });

    const response = await handler(new Request("https://example.test/functions/v1/process-webhook-side-effects", {
      method: "POST",
      headers: {
        Authorization: "Bearer service-role-key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ orderId: "order-1" }),
    }));

    const payload = await response.json();
    const payloadText = JSON.stringify(payload);

    expect(response.status).toBe(500);
    expect(payload).toEqual({ error: "Webhook side effects processing failed" });
    expect(payloadText).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(payloadText).not.toContain("stack trace");
    expect(payloadText).not.toContain("/internal/path.ts");
    const loggedText = JSON.stringify(logError.mock.calls);
    expect(loggedText).toContain("webhook_side_effects_processing_failed");
    expect(loggedText).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(loggedText).not.toContain("stack trace");
    expect(loggedText).not.toContain("/internal/path.ts");
  });
});
