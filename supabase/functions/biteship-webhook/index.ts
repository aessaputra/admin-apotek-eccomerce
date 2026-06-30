import { getSupabaseAdminClient } from "../_shared/supabase.ts";
import { createBiteshipWebhookHandler } from "./handler.ts";

import { CONFIG_KEYS, createRuntimeConfigProvider } from "../_shared/runtime-config.ts";

declare const Deno: {
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
  env: {
    get: (key: string) => string | undefined;
  };
};

const runtimeConfig = createRuntimeConfigProvider({
  adminClient: {
    rpc: async (name, args) => {
      const adminClient = getSupabaseAdminClient();
      return adminClient.rpc(name as any, args);
    },
  },
});

Deno.serve(
  createBiteshipWebhookHandler({
    getAdminClient: getSupabaseAdminClient,
    getWebhookSecret: async () => {
      const dbConfig = await runtimeConfig.getOptionalConfig(CONFIG_KEYS.biteshipWebhookSecret);
      return (dbConfig?.value as string) ?? Deno.env.get("BITESHIP_WEBHOOK_SECRET") ?? null;
    },
  }),
);
