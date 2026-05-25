import {
  listDueSideEffectTaskOrderIds,
  processWebhookSideEffectTask,
} from "../_shared/webhook-side-effects.ts";

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

function isAuthorizedRequest(req: Request, serviceRoleKey: string | undefined): boolean {
  const authHeader = req.headers.get("Authorization");

  return !!serviceRoleKey && authHeader === `Bearer ${serviceRoleKey}`;
}

export interface ProcessWebhookSideEffectsHandlerDependencies {
  getAdminClient: () => unknown;
  getServiceRoleKey: () => string | undefined;
  logError?: (message: string) => void;
}

export function createProcessWebhookSideEffectsHandler(
  dependencies: ProcessWebhookSideEffectsHandlerDependencies,
): (req: Request) => Promise<Response> {
  const logError = dependencies.logError ??
    ((message: string) => console.error(
      "[process-webhook-side-effects] internal_error",
      { action: message, errorCategory: "unexpected_failure" },
    ));

  return async (req) => {
    if (req.method !== "POST") {
      return jsonResponse({ error: "Method Not Allowed" }, 405);
    }

    if (!isAuthorizedRequest(req, dependencies.getServiceRoleKey())) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    try {
      const adminClient = dependencies.getAdminClient();
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
        : await listDueSideEffectTaskOrderIds(adminClient as never, safeLimit);

      const results: Array<Record<string, unknown>> = [];
      let stoppedDueToRuntimeBudget = false;

      for (const orderId of orderIds) {
        if (Date.now() - startedAt >= PROCESSOR_RUNTIME_BUDGET_MS) {
          stoppedDueToRuntimeBudget = true;
          break;
        }

        const result = await processWebhookSideEffectTask(adminClient as never, orderId);
        results.push({ orderId, ...result });
      }

      return jsonResponse({
        processed_count: results.filter((result) => result.processed === true)
          .length,
        attempted_count: results.length,
        stopped_due_to_runtime_budget: stoppedDueToRuntimeBudget,
        results,
      });
    } catch (_error: unknown) {
      logError("webhook_side_effects_processing_failed");
      return jsonResponse({ error: "Webhook side effects processing failed" }, 500);
    }
  };
}
