import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createReconcilePendingMidtransPaymentsHandler } from "./handler.ts";
import { getSupabaseAdminClient } from "../_shared/supabase.ts";

declare const Deno: {
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
  env: {
    get: (key: string) => string | undefined;
  };
};

Deno.serve(createReconcilePendingMidtransPaymentsHandler({
  getServiceRoleKey: () => Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
  getAdminClient: getSupabaseAdminClient,
}));
