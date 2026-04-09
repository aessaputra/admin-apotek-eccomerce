import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getSupabaseAdminClient } from "../_shared/supabase.ts";
import {
  listDueSideEffectTaskOrderIds,
  processWebhookSideEffectTask,
} from "../_shared/webhook-side-effects.ts";

declare const Deno: {
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
  env: {
    get: (key: string) => string | undefined;
  };
};

const JSON_HEADERS = { "Content-Type": "application/json" };
const DEFAULT_PROCESSOR_LIMIT = 3;
const MAX_PROCESSOR_LIMIT = 3;
const PROCESSOR_RUNTIME_BUDGET_MS = 50_000;

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

function isAuthorizedRequest(req: Request): boolean {
  const authHeader = req.headers.get("Authorization");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  return !!serviceRoleKey && authHeader === `Bearer ${serviceRoleKey}`;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method Not Allowed" }, 405);
  }

  if (!isAuthorizedRequest(req)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  try {
    const adminClient = getSupabaseAdminClient();
    const body = await req.json().catch(() => ({}));
    const requestedOrderId =
      typeof body?.orderId === "string" ? body.orderId.trim() : "";
    const requestedLimit =
      typeof body?.limit === "number" && Number.isFinite(body.limit)
        ? body.limit
        : DEFAULT_PROCESSOR_LIMIT;
    const safeLimit = Math.max(
      1,
      Math.min(Math.floor(requestedLimit), MAX_PROCESSOR_LIMIT),
    );
    const startedAt = Date.now();

    const orderIds = requestedOrderId
      ? [requestedOrderId]
      : await listDueSideEffectTaskOrderIds(adminClient, safeLimit);

    const results: Array<Record<string, unknown>> = [];
    let stoppedDueToRuntimeBudget = false;

    for (const orderId of orderIds) {
      if (Date.now() - startedAt >= PROCESSOR_RUNTIME_BUDGET_MS) {
        stoppedDueToRuntimeBudget = true;
        break;
      }

      const result = await processWebhookSideEffectTask(adminClient, orderId);
      results.push({ orderId, ...result });
    }

    return jsonResponse({
      processed_count: results.filter((result) => result.processed === true)
        .length,
      attempted_count: results.length,
      stopped_due_to_runtime_budget: stoppedDueToRuntimeBudget,
      results,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[process-webhook-side-effects] Internal error:", message);
    return jsonResponse({ error: message }, 500);
  }
});
