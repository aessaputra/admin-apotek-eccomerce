import { beforeEach, describe, expect, it, vi } from "vitest";

const webhookSideEffects = vi.hoisted(() => ({
  ensureSettlementSideEffectsQueued: vi.fn(async () => false),
  triggerWebhookSideEffectProcessor: vi.fn(),
}));

let servedHandler: ((req: Request) => Promise<Response> | Response) | null = null;

vi.mock("../_shared/supabase.ts", () => ({
  getSupabaseAdminClient: vi.fn(),
}));

vi.mock("../../_shared/webhook-side-effects.ts", () => webhookSideEffects);

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


async function makeSignature(
  payload: Pick<ReturnType<typeof makePayload>, "order_id" | "status_code" | "gross_amount">,
  serverKey = "midtrans-active-sentinel-key",
) {
  const hashBuffer = await crypto.subtle.digest(
    "SHA-512",
    new TextEncoder().encode(
      `${payload.order_id}${payload.status_code}${payload.gross_amount}${serverKey}`,
    ),
  );

  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function createRuntimeRows() {
  return [
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
  ];
}

function createWebhookFlowAdminClient(options: {
  orderOverrides?: Record<string, unknown>;
  paymentSnapshotOverrides?: Record<string, unknown>;
  rawPaymentUpsertError?: { message: string };
  transitionError?: { message: string };
  transitionResult?: Record<string, unknown>;
} = {}) {
  const paymentsUpsert = vi.fn<() => Promise<{ error: { message: string } | null }>>(
    async () => ({ error: null }),
  );
  if (options.rawPaymentUpsertError) {
    paymentsUpsert
      .mockResolvedValueOnce({ error: options.rawPaymentUpsertError })
      .mockResolvedValue({ error: null });
  }
  const orderActivitiesInsert = vi.fn(async () => ({ error: null }));
  const notificationsInsert = vi.fn(async () => ({ error: null }));
  const paymentByMidtransMaybeSingle = vi.fn(async () => ({
    data: { order_id: "order-1" },
    error: null,
  }));
  const paymentSnapshotMaybeSingle = vi.fn(async () => ({
    data: {
      order_id: "order-1",
      status: "pending",
      payment_type: "bank_transfer",
      gross_amount: 150000,
      currency: "IDR",
      midtrans_order_id: "MIDTRANS-WEBHOOK-ORDER",
      ...options.paymentSnapshotOverrides,
    },
    error: null,
  }));
  const existingPaymentMaybeSingle = vi.fn(async () => ({ data: null, error: null }));
  const orderMaybeSingle = vi.fn(async () => ({
    data: {
      id: "order-1",
      user_id: "user-1",
      total_amount: 150000,
      status: "pending",
      shipping_cost: 0,
      created_at: "2026-05-24T00:00:00.000Z",
      order_items: [],
      ...options.orderOverrides,
    },
    error: null,
  }));
  const shipmentMaybeSingle = vi.fn(async () => ({ data: null, error: null }));

  const buildPaymentSelect = () => ({
    eq: (column: string) => {
      const terminal = {
        maybeSingle: column === "midtrans_order_id"
          ? existingPaymentMaybeSingle
          : paymentSnapshotMaybeSingle,
        order: () => ({
          order: () => ({
            limit: () => ({ maybeSingle: paymentSnapshotMaybeSingle }),
          }),
        }),
        not: () => ({
          order: () => ({
            order: () => ({
              limit: () => ({ maybeSingle: paymentByMidtransMaybeSingle }),
            }),
          }),
        }),
      };
      return terminal;
    },
  });

  const from = vi.fn((tableName: string) => {
    if (tableName === "payments") {
      return {
        select: vi.fn(buildPaymentSelect),
        upsert: paymentsUpsert,
      };
    }

    if (tableName === "orders") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle: orderMaybeSingle })),
        })),
      };
    }

    if (tableName === "shipments") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: () => ({
              order: () => ({
                limit: () => ({ maybeSingle: shipmentMaybeSingle }),
              }),
            }),
          })),
        })),
      };
    }

    if (tableName === "order_activities") {
      return { insert: orderActivitiesInsert };
    }

    if (tableName === "notifications") {
      return { insert: notificationsInsert };
    }

    throw new Error(`Unexpected table: ${tableName}`);
  });

  const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
    if (name === "get_midtrans_payment_config_binding") {
      return { data: [], error: null };
    }

    if (name === "get_runtime_integration_config_versions") {
      const keyNames = args?.p_key_names as string[] | undefined;
      return {
        data: createRuntimeRows().filter((row) =>
          !keyNames || keyNames.includes(row.key_name)
        ),
        error: null,
      };
    }

    if (name === "apply_midtrans_webhook_transition") {
      return {
        data: [options.transitionResult ?? { applied: true, payment_status: "settlement", order_status: "processing" }],
        error: options.transitionError ?? null,
      };
    }

    throw new Error(`Unexpected RPC: ${name}`);
  });

  return {
    adminClient: { from, rpc },
    from,
    rpc,
    paymentsUpsert,
    orderActivitiesInsert,
    notificationsInsert,
  };
}

function stubVerifiedMidtransStatus(payload: ReturnType<typeof makePayload>, overrides: Record<string, unknown> = {}) {
  vi.stubGlobal("fetch", vi.fn(async () =>
    new Response(JSON.stringify({
      order_id: payload.order_id,
      transaction_id: payload.transaction_id,
      transaction_status: payload.transaction_status,
      fraud_status: payload.fraud_status,
      status_code: payload.status_code,
      gross_amount: payload.gross_amount,
      payment_type: payload.payment_type,
      currency: payload.currency,
      settlement_time: "2026-05-24 12:00:00",
      ...overrides,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  ));
}

function serializeConsoleCalls(spy: ReturnType<typeof vi.spyOn>): string {
  return JSON.stringify(spy.mock.calls);
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


describe("midtrans-webhook Task 4 log redaction", () => {
  beforeEach(() => {
    webhookSideEffects.ensureSettlementSideEffectsQueued.mockReset();
    webhookSideEffects.ensureSettlementSideEffectsQueued.mockResolvedValue(false);
    webhookSideEffects.triggerWebhookSideEffectProcessor.mockClear();
  });

  it("redacts invalid JSON parse details from logs while preserving the 400 response", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const handler = createMidtransWebhookHandler({
      getAdminClient: () => {
        throw new Error("admin client should not be requested");
      },
    });

    const response = await handler(new Request("https://example.test/functions/v1/midtrans-webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ invalid json secret-parse-sentinel",
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid JSON payload" });
    const logs = serializeConsoleCalls(consoleError);
    expect(logs).toContain("midtrans_invalid_json");
    expect(logs).not.toContain("secret-parse-sentinel");
    expect(logs).not.toContain("SyntaxError");
    expect(logs).not.toContain("Unexpected");
    consoleError.mockRestore();
  });

  it("classifies malformed payload 400 responses without logging raw request fields", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const handler = createMidtransWebhookHandler({
      getAdminClient: () => {
        throw new Error("admin client should not be requested");
      },
    });

    const response = await handler(createRequest({
      order_id: "midtrans-order-secret-sentinel",
      status_code: "200",
      gross_amount: "150000.00",
      transaction_status: "settlement",
      customer_email: "customer-secret@example.test",
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid payload" });
    const logs = serializeConsoleCalls(consoleError);
    expect(logs).toContain("midtrans_invalid_payload");
    expect(logs).not.toContain("midtrans-order-secret-sentinel");
    expect(logs).not.toContain("customer-secret@example.test");
    consoleError.mockRestore();
  });

  it("redacts raw notification persistence errors from logs and responses", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { adminClient } = createWebhookFlowAdminClient({
      rawPaymentUpsertError: { message: "payments table secret-db-sentinel policy stack" },
    });
    const payload = makePayload("");
    payload.signature_key = await makeSignature(payload);
    stubVerifiedMidtransStatus(payload);
    const handler = createMidtransWebhookHandler({
      getAdminClient: () => adminClient as never,
    });

    const response = await handler(createRequest(payload));
    const bodyText = await response.text();

    expect(response.status).toBe(200);
    expect(bodyText).not.toContain("secret-db-sentinel");
    const logs = serializeConsoleCalls(consoleError);
    expect(logs).toContain("midtrans_raw_notification_persist_failed");
    expect(logs).not.toContain("secret-db-sentinel");
    expect(logs).not.toContain("payments table");
    expect(logs).not.toContain("policy stack");
    consoleError.mockRestore();
  });

  it("redacts status verification provider failures from logs and retry response", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { adminClient } = createWebhookFlowAdminClient();
    const payload = makePayload("");
    payload.signature_key = await makeSignature(payload);
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({
        status_message: "midtrans-provider-secret-sentinel upstream stack",
      }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      })
    ));
    const handler = createMidtransWebhookHandler({
      getAdminClient: () => adminClient as never,
    });

    const response = await handler(createRequest(payload));
    const bodyText = await response.text();

    expect(response.status).toBe(503);
    expect(bodyText).toContain("Status verification failed, retry later");
    expect(bodyText).not.toContain("midtrans-provider-secret-sentinel");
    const logs = serializeConsoleCalls(consoleError);
    expect(logs).toContain("midtrans_status_verification_failed");
    expect(logs).not.toContain("midtrans-provider-secret-sentinel");
    expect(logs).not.toContain("upstream stack");
    consoleError.mockRestore();
  });

  it("redacts transition RPC errors from logs and retry response", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { adminClient } = createWebhookFlowAdminClient({
      transitionError: { message: "policy transition secret-rpc-sentinel stack" },
    });
    const payload = makePayload("");
    payload.signature_key = await makeSignature(payload);
    stubVerifiedMidtransStatus(payload);
    const handler = createMidtransWebhookHandler({
      getAdminClient: () => adminClient as never,
    });

    const response = await handler(createRequest(payload));
    const bodyText = await response.text();

    expect(response.status).toBe(503);
    expect(bodyText).toContain("Transition error logged");
    expect(bodyText).not.toContain("secret-rpc-sentinel");
    const logs = serializeConsoleCalls(consoleError);
    expect(logs).toContain("midtrans_transition_failed");
    expect(logs).not.toContain("secret-rpc-sentinel");
    expect(logs).not.toContain("policy transition");
    consoleError.mockRestore();
  });

  it("redacts unexpected outer catch errors from logs and generic response", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const payload = makePayload("");
    payload.signature_key = await makeSignature(payload);
    const handler = createMidtransWebhookHandler({
      getAdminClient: () => {
        throw new Error("outer secret-stack-sentinel details");
      },
    });

    const response = await handler(createRequest(payload));
    const bodyText = await response.text();

    expect(response.status).toBe(500);
    expect(bodyText).toContain("Internal error");
    expect(bodyText).not.toContain("secret-stack-sentinel");
    const logs = serializeConsoleCalls(consoleError);
    expect(logs).toContain("midtrans_webhook_internal_error");
    expect(logs).not.toContain("secret-stack-sentinel");
    expect(logs).not.toContain("outer");
    consoleError.mockRestore();
  });
});


describe("midtrans-webhook transition currency validation", () => {
  it("rejects verified and payload USD for an IDR order before transition or side effects", async () => {
    webhookSideEffects.ensureSettlementSideEffectsQueued.mockClear();
    webhookSideEffects.triggerWebhookSideEffectProcessor.mockClear();

    const { adminClient, rpc, paymentsUpsert, orderActivitiesInsert } =
      createWebhookFlowAdminClient();
    const payload = {
      ...makePayload(""),
      currency: "USD",
    };
    payload.signature_key = await makeSignature(payload);

    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({
        order_id: payload.order_id,
        transaction_id: payload.transaction_id,
        transaction_status: "settlement",
        fraud_status: "accept",
        status_code: "200",
        gross_amount: payload.gross_amount,
        payment_type: "bank_transfer",
        currency: "USD",
        settlement_time: "2026-05-24 12:00:00",
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    ));

    const handler = createMidtransWebhookHandler({
      getAdminClient: () => adminClient as never,
    });

    const response = await handler(createRequest(payload));
    const responseBody = await response.json();

    expect(response.status).toBe(409);
    expect(responseBody).toEqual({ error: "Currency mismatch" });
    expect(rpc.mock.calls.some((call) => call[0] === "apply_midtrans_webhook_transition"))
      .toBe(false);
    expect(paymentsUpsert).not.toHaveBeenCalled();
    expect(orderActivitiesInsert).not.toHaveBeenCalled();
    expect(webhookSideEffects.ensureSettlementSideEffectsQueued).not.toHaveBeenCalled();
    expect(webhookSideEffects.triggerWebhookSideEffectProcessor).not.toHaveBeenCalled();
  });
});


describe("midtrans-webhook settlement side-effect queueing", () => {
  beforeEach(() => {
    webhookSideEffects.ensureSettlementSideEffectsQueued.mockReset();
    webhookSideEffects.ensureSettlementSideEffectsQueued.mockResolvedValue(false);
    webhookSideEffects.triggerWebhookSideEffectProcessor.mockClear();
  });

  it("queues and triggers fulfillment once for an applied settlement transition", async () => {
    webhookSideEffects.ensureSettlementSideEffectsQueued.mockResolvedValueOnce(true);
    const { adminClient } = createWebhookFlowAdminClient();
    const payload = makePayload("");
    payload.signature_key = await makeSignature(payload);
    stubVerifiedMidtransStatus(payload);
    const handler = createMidtransWebhookHandler({
      getAdminClient: () => adminClient as never,
    });

    const response = await handler(createRequest(payload));

    expect(response.status).toBe(200);
    expect(webhookSideEffects.ensureSettlementSideEffectsQueued).toHaveBeenCalledTimes(1);
    expect(webhookSideEffects.ensureSettlementSideEffectsQueued).toHaveBeenCalledWith(
      expect.anything(),
      "order-1",
      "settlement",
      { transitionApplied: true },
    );
    expect(webhookSideEffects.triggerWebhookSideEffectProcessor).toHaveBeenCalledTimes(1);
    expect(webhookSideEffects.triggerWebhookSideEffectProcessor).toHaveBeenCalledWith("order-1");
  });

  it("accepts a duplicate completed settlement no-op without triggering fulfillment", async () => {
    const { adminClient } = createWebhookFlowAdminClient({
      orderOverrides: { status: "processing" },
      paymentSnapshotOverrides: { status: "settlement" },
      transitionResult: { applied: false, payment_status: "settlement", order_status: "processing" },
    });
    const payload = makePayload("");
    payload.signature_key = await makeSignature(payload);
    stubVerifiedMidtransStatus(payload);
    const handler = createMidtransWebhookHandler({
      getAdminClient: () => adminClient as never,
    });

    const response = await handler(createRequest(payload));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      status: "ok",
      message: "Transition already satisfied or safely ignored",
    });
    expect(webhookSideEffects.ensureSettlementSideEffectsQueued).toHaveBeenCalledWith(
      expect.anything(),
      "order-1",
      "settlement",
      { transitionApplied: false },
    );
    expect(webhookSideEffects.triggerWebhookSideEffectProcessor).not.toHaveBeenCalled();
  });

  it("can resume an existing incomplete no-op settlement task without creating a new transition", async () => {
    webhookSideEffects.ensureSettlementSideEffectsQueued.mockResolvedValueOnce(true);
    const { adminClient } = createWebhookFlowAdminClient({
      orderOverrides: { status: "processing" },
      paymentSnapshotOverrides: { status: "settlement" },
      transitionResult: { applied: false, payment_status: "settlement", order_status: "processing" },
    });
    const payload = makePayload("");
    payload.signature_key = await makeSignature(payload);
    stubVerifiedMidtransStatus(payload);
    const handler = createMidtransWebhookHandler({
      getAdminClient: () => adminClient as never,
    });

    const response = await handler(createRequest(payload));

    expect(response.status).toBe(200);
    expect(webhookSideEffects.ensureSettlementSideEffectsQueued).toHaveBeenCalledWith(
      expect.anything(),
      "order-1",
      "settlement",
      { transitionApplied: false },
    );
    expect(webhookSideEffects.triggerWebhookSideEffectProcessor).toHaveBeenCalledTimes(1);
    expect(webhookSideEffects.triggerWebhookSideEffectProcessor).toHaveBeenCalledWith("order-1");
  });

  it("does not queue settlement effects for capture challenge", async () => {
    const { adminClient } = createWebhookFlowAdminClient({
      transitionResult: { applied: true, payment_status: "pending", order_status: "pending" },
    });
    const payload = {
      ...makePayload(""),
      transaction_status: "capture",
      fraud_status: "challenge",
    };
    payload.signature_key = await makeSignature(payload);
    stubVerifiedMidtransStatus(payload, {
      transaction_status: "capture",
      fraud_status: "challenge",
    });
    const handler = createMidtransWebhookHandler({
      getAdminClient: () => adminClient as never,
    });

    const response = await handler(createRequest(payload));

    expect(response.status).toBe(200);
    expect(webhookSideEffects.ensureSettlementSideEffectsQueued).toHaveBeenCalledWith(
      expect.anything(),
      "order-1",
      "pending",
      { transitionApplied: true },
    );
    expect(webhookSideEffects.triggerWebhookSideEffectProcessor).not.toHaveBeenCalled();
  });

  it("rejects an amount mismatch before transition or side-effect queueing", async () => {
    const { adminClient, rpc, paymentsUpsert, orderActivitiesInsert } =
      createWebhookFlowAdminClient();
    const payload = makePayload("");
    payload.signature_key = await makeSignature(payload);
    stubVerifiedMidtransStatus(payload, { gross_amount: "150001.00" });
    const handler = createMidtransWebhookHandler({
      getAdminClient: () => adminClient as never,
    });

    const response = await handler(createRequest(payload));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({ error: "Amount mismatch recorded" });
    expect(rpc.mock.calls.some((call) => call[0] === "apply_midtrans_webhook_transition"))
      .toBe(false);
    expect(paymentsUpsert).not.toHaveBeenCalled();
    expect(orderActivitiesInsert).not.toHaveBeenCalled();
    expect(webhookSideEffects.ensureSettlementSideEffectsQueued).not.toHaveBeenCalled();
    expect(webhookSideEffects.triggerWebhookSideEffectProcessor).not.toHaveBeenCalled();
  });
});
