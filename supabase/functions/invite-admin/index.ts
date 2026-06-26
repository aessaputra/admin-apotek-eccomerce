import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

declare const Deno: {
  env: {
    get: (name: string) => string | undefined;
  };
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
};

const JSON_HEADERS = { ...corsHeaders, "Content-Type": "application/json" };

function getRequiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.slice("Bearer ".length).trim();
}

async function verifyAdminRole(token: string, authClient: SupabaseClient, adminClient: SupabaseClient): Promise<boolean> {
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  const caller = authData.user;

  if (authError || !caller) {
    return false;
  }

  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("role")
    .eq("id", caller.id)
    .single();

  if (profileError || profile?.role !== "admin") {
    return false;
  }

  return true;
}

async function parseEmailFromRequest(req: Request): Promise<string> {
  const body = await req.json().catch(() => ({}));
  if (!body || typeof body !== "object" || !body.email || typeof body.email !== "string") {
    throw new Error("Invalid request body, email is required");
  }
  
  const email = body.email.trim();
  if (!email) {
    throw new Error("Email cannot be empty");
  }

  return email;
}

async function inviteAndSetAdminProfile(email: string, adminClient: SupabaseClient) {
  const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(
    email,
    { 
      data: { role: "admin" },
      redirectTo: "https://admin.sinarfarma.biz.id"
    }
  );

  if (inviteError) {
    console.error("[invite-admin] inviteUserByEmail failed:", inviteError);
    throw new Error(inviteError.message);
  }

  const newUserId = inviteData.user.id;
  const userEmail = inviteData.user.email;

  const { error: upsertError } = await adminClient
    .from("profiles")
    .upsert({
      id: newUserId,
      role: "admin",
      email: userEmail,
      full_name: null,
      phone_number: null,
    });

  if (upsertError) {
    console.error("[invite-admin] upsert profile failed:", upsertError);
    throw new Error("User invited but failed to set profile role");
  }

  return { id: newUserId, email: userEmail };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method Not Allowed" }, 405);
  }

  try {
    const token = extractBearerToken(req);
    if (!token) {
      return jsonResponse({ error: "Missing or invalid Authorization header" }, 401);
    }

    const authClient = createClient(
      getRequiredEnv("SUPABASE_URL"),
      getRequiredEnv("SUPABASE_ANON_KEY")
    );
    const adminClient = createClient(
      getRequiredEnv("SUPABASE_URL"),
      getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY")
    );

    const isAdmin = await verifyAdminRole(token, authClient, adminClient);
    if (!isAdmin) {
      return jsonResponse({ error: "Unauthorized: Only admins can perform this action" }, 403);
    }

    let email: string;
    try {
      email = await parseEmailFromRequest(req);
    } catch (error: any) {
      return jsonResponse({ error: error.message }, 400);
    }

    try {
      const invitedUser = await inviteAndSetAdminProfile(email, adminClient);
      return jsonResponse({
        data: {
          id: invitedUser.id,
          email: invitedUser.email,
          message: "Admin invited successfully",
        },
      });
    } catch (error: any) {
      return jsonResponse({ error: error.message }, 500);
    }
  } catch (error) {
    console.error("[invite-admin] internal error:", error);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
