import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// @ts-expect-error Deno Edge Runtime resolves npm specifiers at deploy time.
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5";
import { getOrderAggregateById } from "../_shared/order-aggregate.ts";
import { getSupabaseAdminClient } from "../_shared/supabase.ts";
import { createCancelUserOrderHandler } from "./handler.ts";

declare const Deno: {
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
  env: {
    get: (key: string) => string | undefined;
  };
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const JWKS = createRemoteJWKSet(
  new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`),
);
const JWT_ISSUER = `${supabaseUrl}/auth/v1`;

async function getAuthenticatedUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return null;
  }

  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: JWT_ISSUER,
      audience: "authenticated",
    });

    return payload.sub ?? null;
  } catch {
    return null;
  }
}

Deno.serve(createCancelUserOrderHandler({
  getAuthenticatedUserId,
  getAdminClient: getSupabaseAdminClient,
  getOrderById: getOrderAggregateById,
}));
