import { beforeEach, describe, expect, it, vi } from "vitest";

let servedHandler: ((req: Request) => Promise<Response> | Response) | null = null;

vi.mock("../_shared/supabase.ts", () => ({
  getSupabaseAdminClient: vi.fn(),
}));

vi.stubGlobal("Deno", {
  env: {
    get: vi.fn((key: string) => {
      if (key === "SUPABASE_URL") return "https://project.supabase.test";
      if (key === "SUPABASE_SERVICE_ROLE_KEY") return "service-role-sentinel";
      return undefined;
    }),
  },
  serve: vi.fn((handler: (req: Request) => Promise<Response> | Response) => {
    servedHandler = handler;
  }),
});

const { createMidtransWebhookHandler } = await import("../index.ts");

const makePayload = (signatureKey: string) => ({
  order_id: "MIDTRANS-WEBHOOK-ORDER",
  status_code: "200",
  gross_amount: "150000.00",
  signature_key: signatureKey,
  transaction_status: "settlement",
  transaction_id: "transaction-1",
  fraud_status: "accept",
  payment_type: "bank_transfer",
  currency: "IDR",
});

function createRequest(payload: Record<string, unknown>) {
  return new Request("https://example.test/functions/v1/midtrans-webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function createAdminClient(options: {
  runtimeUnavailable?: boolean;
  runtimeRows?: unknown[];
  bindingRows?: unknown[];
}) {
  const from = vi.fn(() => ({
    upsert: vi.fn(async () => ({ error: null })),
    select: vi.fn(() => ({
      eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: null, error: null })) })),
    })),
    insert: vi.fn(async () => ({ error: null })),
  }));
  const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
    if (name === "get_midtrans_payment_config_binding") {
      return { data: options.bindingRows ?? [], error: null };
    }

    if (name === "get_runtime_integration_config_versions") {
      if (options.runtimeUnavailable) {
        return { data: null, error: { message: "runtime unavailable" } };
      }

      const keyNames = args?.p_key_names as string[] | undefined;
      return {
        data: (options.runtimeRows ?? []).filter((row) => {
          if (!keyNames || typeof row !== "object" || row === null) {
            return true;
          }

          return keyNames.includes((row as { key_name?: string }).key_name ?? "");
        }),
        error: null,
      };
    }

    throw new Error(`Unexpected RPC before signature validation: ${name}`);
  });

  return { adminClient: { from, rpc }, from, rpc };
}

describe("midtrans-webhook pre-signature safety", () => {
  beforeEach(() => {
    expect(servedHandler).toBeTypeOf("function");
  });

  it("returns 401 for invalid signatures without writing any database rows", async () => {
    const { adminClient, from, rpc } = createAdminClient({
      runtimeRows: [
        {
          key_name: "midtrans.server_key",
          value_kind: "secret",
          is_secret: true,
          is_required: true,
          is_runtime_required: true,
          version_id: "server-active-version-id",
          version_number: 1,
          status: "active",
          runtime_value: "midtrans-active-sentinel-key",
          masked_value: "midt*****************key",
          value_fingerprint: "fingerprint",
          updated_at: "2026-05-19T00:00:00.000Z",
        },
        {
          key_name: "midtrans.is_production",
          value_kind: "boolean",
          is_secret: false,
          is_required: true,
          is_runtime_required: true,
          version_id: "production-active-version-id",
          version_number: 1,
          status: "active",
          runtime_value: false,
          masked_value: "false",
          value_fingerprint: "fingerprint",
          updated_at: "2026-05-19T00:00:00.000Z",
        },
      ],
    });
    const handler = createMidtransWebhookHandler({
      getAdminClient: () => adminClient as never,
    });

    const response = await handler(createRequest(makePayload("not-a-valid-signature")));

    await expect(response.json()).resolves.toEqual({ error: "Invalid signature" });
    expect(response.status).toBe(401);
    expect(from).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(rpc.mock.calls.map((call) => call[0])).toEqual([
      "get_midtrans_payment_config_binding",
      "get_runtime_integration_config_versions",
      "get_runtime_integration_config_versions",
    ]);
  });

  it("returns 503 when config is unavailable before signature validation without writing rows", async () => {
    const { adminClient, from, rpc } = createAdminClient({ runtimeUnavailable: true });
    const handler = createMidtransWebhookHandler({
      getAdminClient: () => adminClient as never,
    });

    const response = await handler(createRequest(makePayload("unverifiable-signature")));

    await expect(response.json()).resolves.toEqual({
      error: "Midtrans runtime config unavailable",
    });
    expect(response.status).toBe(503);
    expect(from).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(rpc.mock.calls.map((call) => call[0])).toEqual([
      "get_midtrans_payment_config_binding",
      "get_runtime_integration_config_versions",
      "get_runtime_integration_config_versions",
    ]);
  });

  it("returns 401 for invalid signatures on bound legacy transactions without writing rows", async () => {
    const { adminClient, from, rpc } = createAdminClient({
      bindingRows: [{
        payment_id: "payment-legacy-bound",
        midtrans_order_id: "MIDTRANS-WEBHOOK-ORDER",
        server_key_version_number: 7,
        is_production_version_number: 2,
      }],
      runtimeRows: [
        {
          key_name: "midtrans.server_key",
          value_kind: "secret",
          is_secret: true,
          is_required: true,
          is_runtime_required: true,
          version_id: "server-bound-version-id",
          version_number: 7,
          status: "retired",
          runtime_value: "midtrans-bound-sentinel-key",
          masked_value: "midt*****************key",
          value_fingerprint: "fingerprint",
          updated_at: "2026-05-19T00:00:00.000Z",
        },
        {
          key_name: "midtrans.is_production",
          value_kind: "boolean",
          is_secret: false,
          is_required: true,
          is_runtime_required: true,
          version_id: "production-bound-version-id",
          version_number: 2,
          status: "retired",
          runtime_value: false,
          masked_value: "false",
          value_fingerprint: "fingerprint",
          updated_at: "2026-05-19T00:00:00.000Z",
        },
      ],
    });
    const handler = createMidtransWebhookHandler({
      getAdminClient: () => adminClient as never,
    });

    const response = await handler(createRequest(makePayload("invalid-bound-signature")));

    await expect(response.json()).resolves.toEqual({ error: "Invalid signature" });
    expect(response.status).toBe(401);
    expect(from).not.toHaveBeenCalled();
    expect(rpc.mock.calls.map((call) => call[0])).toEqual([
      "get_midtrans_payment_config_binding",
      "get_runtime_integration_config_versions",
      "get_runtime_integration_config_versions",
    ]);
  });
});
