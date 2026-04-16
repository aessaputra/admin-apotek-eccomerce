import { createClient } from "jsr:@supabase/supabase-js@2";
import { createCleanupHandler } from "./handler.ts";

declare const Deno: {
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
  env: {
    get: (key: string) => string | undefined;
  };
};

if (typeof Deno !== "undefined") {
  Deno.serve(
    createCleanupHandler({
      createClientFn: (url, key) => createClient(url, key) as import("./handler.ts").CleanupAdminClient,
      env: Deno.env,
    }),
  );
}
