import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getSupabaseAdminClient } from "../_shared/supabase.ts";

declare const Deno: {
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
  env: {
    get: (key: string) => string | undefined;
  };
};

type NotificationRecord = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  cta_route: string | null;
  data: Record<string, unknown> | null;
  priority: "low" | "normal" | "high";
  source_event_key: string | null;
  created_at: string;
};

type WebhookPayload = {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  schema: "public" | string;
  record: NotificationRecord;
  old_record: NotificationRecord | null;
};

type ExpoPushTicket = {
  status?: string;
  id?: string;
  message?: string;
  details?: {
    error?: string;
    [key: string]: unknown;
  };
};

type ExpoPushResponse = {
  data?: ExpoPushTicket | ExpoPushTicket[];
  errors?: Array<Record<string, unknown>>;
};

const JSON_HEADERS = { "Content-Type": "application/json" };
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_PUSH_TOKEN_PATTERN = /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/;

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

function isAuthorizedRequest(req: Request): boolean {
  const authHeader = req.headers.get("Authorization");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  return !!serviceRoleKey && authHeader === `Bearer ${serviceRoleKey}`;
}

function normalizeExpoPriority(priority: NotificationRecord["priority"]): "default" | "normal" | "high" {
  if (priority === "high") {
    return "high";
  }

  if (priority === "normal") {
    return "normal";
  }

  return "default";
}

function toTicketList(response: ExpoPushResponse): ExpoPushTicket[] {
  if (!response.data) {
    return [];
  }

  return Array.isArray(response.data) ? response.data : [response.data];
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method Not Allowed" }, 405);
  }

  if (!isAuthorizedRequest(req)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const payload = body as Partial<WebhookPayload>;

    if (
      payload.type !== "INSERT" ||
      payload.table !== "notifications" ||
      payload.schema !== "public" ||
      !payload.record ||
      typeof payload.record.user_id !== "string"
    ) {
      return jsonResponse({ skipped: true, reason: "Unsupported webhook payload" });
    }

    const notification = payload.record;
    const adminClient = getSupabaseAdminClient();
    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("expo_push_token")
      .eq("id", notification.user_id)
      .maybeSingle();

    if (profileError) {
      console.error("[push] Failed to load recipient push token:", profileError.message);
      return jsonResponse({ delivered: false, reason: "profile_lookup_failed" });
    }

    const expoPushToken =
      typeof profile?.expo_push_token === "string"
        ? profile.expo_push_token.trim()
        : "";

    if (!expoPushToken) {
      console.info("[push] Recipient has no Expo push token", {
        notificationId: notification.id,
        userId: notification.user_id,
      });
      return jsonResponse({ delivered: false, reason: "missing_token" });
    }

    if (!EXPO_PUSH_TOKEN_PATTERN.test(expoPushToken)) {
      console.warn("[push] Recipient push token format is invalid", {
        notificationId: notification.id,
        userId: notification.user_id,
      });
      return jsonResponse({ delivered: false, reason: "invalid_token_format" });
    }

    const expoAccessToken = Deno.env.get("EXPO_ACCESS_TOKEN")?.trim();
    if (!expoAccessToken) {
      console.error("[push] Missing EXPO_ACCESS_TOKEN secret");
      return jsonResponse({ delivered: false, reason: "missing_expo_access_token" });
    }

    let expoResponse: ExpoPushResponse;

    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${expoAccessToken}`,
        },
        body: JSON.stringify({
          to: expoPushToken,
          title: notification.title,
          body: notification.body,
          data: {
            notification_id: notification.id,
            type: notification.type,
            cta_route: notification.cta_route,
            data: notification.data ?? {},
            source_event_key: notification.source_event_key,
          },
          sound: "default",
          priority: normalizeExpoPriority(notification.priority),
        }),
      });

      expoResponse = (await response.json().catch(() => ({}))) as ExpoPushResponse;

      if (!response.ok) {
        console.error("[push] Expo Push API request failed", {
          notificationId: notification.id,
          status: response.status,
          response: expoResponse,
        });
        return jsonResponse({ delivered: false, reason: "expo_request_failed" });
      }
    } catch (error: unknown) {
      console.error("[push] Expo Push API network error", {
        notificationId: notification.id,
        message: error instanceof Error ? error.message : String(error),
      });
      return jsonResponse({ delivered: false, reason: "expo_network_error" });
    }

    const tickets = toTicketList(expoResponse);
    const errorTicket = tickets.find(ticket => ticket.status === "error");

    if (errorTicket) {
      const expoErrorCode = errorTicket.details?.error ?? null;

      if (expoErrorCode === "DeviceNotRegistered") {
        const tokenCleanupTimestamp = new Date().toISOString();
        const { error: tokenCleanupError } = await adminClient
          .from("profiles")
          .update({
            expo_push_token: null,
            expo_push_token_updated_at: tokenCleanupTimestamp,
          })
          .eq("id", notification.user_id);

        if (tokenCleanupError) {
          console.error("[push] Failed to clear stale Expo push token", {
            notificationId: notification.id,
            userId: notification.user_id,
            message: tokenCleanupError.message,
          });
        } else {
          console.warn("[push] Cleared stale Expo push token after DeviceNotRegistered", {
            notificationId: notification.id,
            userId: notification.user_id,
            clearedAt: tokenCleanupTimestamp,
          });
        }
      } else {
        console.error("[push] Expo ticket returned an error", {
          notificationId: notification.id,
          ticket: errorTicket,
        });
      }

      return jsonResponse({
        delivered: false,
        reason: expoErrorCode ?? "expo_ticket_error",
      });
    }

    return jsonResponse({
      delivered: true,
      tickets,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[push] Internal error:", message);
    return jsonResponse({ delivered: false, reason: "internal_error" });
  }
});
