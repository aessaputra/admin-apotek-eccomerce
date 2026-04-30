import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5";
import { createCheckoutOrderHandler, HttpError } from "./handler.ts";
import { getSupabaseAdminClient } from "../_shared/supabase.ts";

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

async function getAuthenticatedUserId(req: Request): Promise<string> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new HttpError(401, "Missing or invalid Authorization header");
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    throw new HttpError(401, "Missing or invalid Authorization header");
  }

  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: JWT_ISSUER,
      audience: "authenticated",
    });

    const userId = payload.sub ?? "";
    if (!userId) {
      throw new HttpError(401, "Unauthorized");
    }

    return userId;
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }

    throw new HttpError(401, "Unauthorized");
  }
}

if (typeof Deno !== "undefined") {
  Deno.serve(
    createCheckoutOrderHandler({
      getAuthenticatedUserId,
      getAdminClient: () =>
        getSupabaseAdminClient() as unknown as import("./handler.ts").CheckoutAdminClient,
    }),
  );
}
