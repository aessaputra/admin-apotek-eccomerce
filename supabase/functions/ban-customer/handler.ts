import { corsHeaders } from "../_shared/cors.ts";

const JSON_HEADERS = { ...corsHeaders, "Content-Type": "application/json" };

type BanCustomerAction = "ban" | "unban";

type BanCustomerRequestBody = {
  userId?: unknown;
  action?: unknown;
};

type UserRecord = {
  id: string;
};

type ProfileRecord = {
  role?: string | null;
};

type SupabaseError = {
  message?: string;
};

type ProfileSelectQuery = {
  eq: (column: string, value: unknown) => ProfileSelectQuery;
  single: () => Promise<{ data: ProfileRecord | null; error: SupabaseError | null }>;
};

type ProfileUpdateQuery = {
  eq: (column: string, value: unknown) => Promise<{ error: SupabaseError | null }>;
};

type ProfilesTableQuery = {
  select: (columns: string) => ProfileSelectQuery;
  update: (values: { is_banned: boolean }) => ProfileUpdateQuery;
};

export interface BanCustomerAuthClient {
  auth: {
    getUser: (token: string) => Promise<{ data: { user: UserRecord | null }; error: SupabaseError | null }>;
  };
}

export interface BanCustomerAdminClient {
  auth: {
    admin: {
      updateUserById: (
        userId: string,
        values: { ban_duration: "100y" | "none" },
      ) => Promise<{ error: SupabaseError | null }>;
    };
  };
  from: (table: "profiles") => ProfilesTableQuery;
}

export interface BanCustomerHandlerDependencies {
  getAuthClient: () => BanCustomerAuthClient;
  getAdminClient: () => BanCustomerAdminClient;
  logError?: (message: string, error?: unknown) => void;
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

function isBanCustomerAction(value: unknown): value is BanCustomerAction {
  return value === "ban" || value === "unban";
}

async function readRequestBody(req: Request): Promise<BanCustomerRequestBody> {
  const body = await req.json();

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {};
  }

  return body;
}

async function loadProfileRole(
  adminClient: BanCustomerAdminClient,
  userId: string,
): Promise<{ role: string | null; lookupFailed: boolean }> {
  const { data, error } = await adminClient.from("profiles").select("role").eq("id", userId).single();

  return {
    role: data?.role ?? null,
    lookupFailed: !!error,
  };
}

export function createBanCustomerHandler(dependencies: BanCustomerHandlerDependencies) {
  const logError = dependencies.logError ?? (() => undefined);

  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    if (req.method !== "POST") {
      return jsonResponse({ error: "Method Not Allowed" }, 405);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Missing or invalid Authorization header" }, 401);
    }

    const token = authHeader.slice("Bearer ".length).trim();
    if (!token) {
      return jsonResponse({ error: "Missing or invalid Authorization header" }, 401);
    }

    const authClient = dependencies.getAuthClient();
    const adminClient = dependencies.getAdminClient();

    const { data: authData, error: authError } = await authClient.auth.getUser(token);
    const caller = authData.user;

    if (authError || !caller) {
      return jsonResponse({ error: "Invalid or expired token" }, 401);
    }

    const callerProfile = await loadProfileRole(adminClient, caller.id);
    if (callerProfile.lookupFailed || callerProfile.role !== "admin") {
      return jsonResponse({ error: "Only admin can ban/unban customers" }, 403);
    }

    let body: BanCustomerRequestBody;
    try {
      body = await readRequestBody(req);
    } catch (error) {
      logError("[ban-customer] Failed to parse request body", error);
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }

    const userId = typeof body.userId === "string" ? body.userId.trim() : "";
    const action = body.action;

    if (!userId) {
      return jsonResponse({ error: "userId is required" }, 400);
    }

    if (!isBanCustomerAction(action)) {
      return jsonResponse({ error: "action must be ban or unban" }, 400);
    }

    if (userId === caller.id) {
      return jsonResponse({ error: "Cannot ban yourself" }, 400);
    }

    const targetProfile = await loadProfileRole(adminClient, userId);
    if (targetProfile.lookupFailed) {
      return jsonResponse({ error: "Target user not found" }, 404);
    }

    if (targetProfile.role === "admin") {
      return jsonResponse({ error: "Cannot ban admin users" }, 400);
    }

    const nextBannedState = action === "ban";
    const { error: authAdminError } = await adminClient.auth.admin.updateUserById(userId, {
      ban_duration: nextBannedState ? "100y" : "none",
    });

    if (authAdminError) {
      logError("[ban-customer] Failed to update Auth ban state", authAdminError);
      return jsonResponse({ error: "Failed to update customer ban state" }, 500);
    }

    const { error: profileUpdateError } = await adminClient
      .from("profiles")
      .update({ is_banned: nextBannedState })
      .eq("id", userId);

    if (profileUpdateError) {
      logError("[ban-customer] Failed to update profile ban state", profileUpdateError);
      return jsonResponse({ error: "Failed to update customer profile" }, 500);
    }

    return jsonResponse({ success: true });
  };
}
