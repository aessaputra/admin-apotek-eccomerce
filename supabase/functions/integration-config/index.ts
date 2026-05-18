import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// @ts-expect-error jsr imports are resolved by the Supabase Edge Runtime.
import { createClient } from "jsr:@supabase/supabase-js@2";

import { createIntegrationConfigHandler } from "./handler.ts";

declare const Deno: {
  env: {
    get: (name: string) => string | undefined;
  };
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
};

function getRequiredEnv(name: string): string {
  const value = Deno.env.get(name);

  if (!value) {
    throw new Error(`${name} is not configured`);
  }

  return value;
}

Deno.serve(
  createIntegrationConfigHandler({
    getAuthClient: () => createClient(getRequiredEnv("SUPABASE_URL"), getRequiredEnv("SUPABASE_ANON_KEY")),
    getAdminClient: () =>
      createClient(getRequiredEnv("SUPABASE_URL"), getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY")),
    logError: (message, error) => console.error(message, error),
  }),
);
