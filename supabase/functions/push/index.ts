import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getSupabaseAdminClient } from "../_shared/supabase.ts";
import { createPushHandler } from "./handler.ts";

declare const Deno: {
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
  env: {
    get: (key: string) => string | undefined;
  };
};

if (typeof Deno !== "undefined") {
  Deno.serve(
    createPushHandler({
      createClientFn: () => getSupabaseAdminClient() as unknown as import("./handler.ts").PushAdminClient,
      env: Deno.env,
      fetchFn: fetch,
    }),
  );
}
