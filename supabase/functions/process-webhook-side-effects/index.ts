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
        : 10;

    const orderIds = requestedOrderId
      ? [requestedOrderId]
      : await listDueSideEffectTaskOrderIds(adminClient, requestedLimit);

    const results: Array<Record<string, unknown>> = [];

    for (const orderId of orderIds) {
      const result = await processWebhookSideEffectTask(adminClient, orderId);
      results.push({ orderId, ...result });
    }

    return jsonResponse({
      processed_count: results.filter((result) => result.processed === true)
        .length,
      attempted_count: results.length,
      results,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[process-webhook-side-effects] Internal error:", message);
    return jsonResponse({ error: message }, 500);
  }
});
