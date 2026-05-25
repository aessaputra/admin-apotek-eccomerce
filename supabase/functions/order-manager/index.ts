import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// @ts-expect-error Deno Edge Runtime resolves npm specifiers at deploy time.
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5";
import { getSupabaseAdminClient } from "../_shared/supabase.ts";
import { createOrderManagerHandler } from "./handler.ts";

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

async function requireAdmin(req: Request): Promise<{ userId: string }> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("Unauthorized: Missing Authorization header");
  }
  const token = authHeader.slice(7).trim();
  if (!token) {
    throw new Error("Unauthorized: Invalid JWT");
  }

  let userId = "";
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: JWT_ISSUER,
      audience: "authenticated",
    });
    userId = payload.sub ?? "";
  } catch (error: unknown) {
    console.error("[order-manager] JWT verification failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    throw new Error("Unauthorized: Invalid JWT");
  }

  if (!userId) {
    throw new Error("Unauthorized: Invalid JWT");
  }

  const adminClient = getSupabaseAdminClient();
  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();

  if (profileError || !profile || profile.role !== "admin") {
    throw new Error("Forbidden: Admin role required");
  }

  return { userId };
}

Deno.serve(createOrderManagerHandler({
  requireAdmin,
  getAdminClient: getSupabaseAdminClient,
}));
