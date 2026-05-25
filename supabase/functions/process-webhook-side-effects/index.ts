import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createProcessWebhookSideEffectsHandler } from "./handler.ts";

declare const Deno: {
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
  env: {
    get: (key: string) => string | undefined;
  };
};

Deno.serve(async (req) => {
  const { getSupabaseAdminClient } = await import("../_shared/supabase.ts");
  return createProcessWebhookSideEffectsHandler({
    getAdminClient: getSupabaseAdminClient,
    getServiceRoleKey: () => Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
  })(req);
});
