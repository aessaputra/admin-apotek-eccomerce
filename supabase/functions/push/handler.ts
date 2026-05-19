import {
  CONFIG_KEYS,
  RuntimeConfigError,
  createRuntimeConfigProvider,
  type RuntimeConfigAdminClient,
} from "../_shared/runtime-config.ts";

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

type ReceiptActionPayload = {
  action?: unknown;
  limit?: unknown;
};

type TestNotificationActionPayload = {
  action?: unknown;
};

type PushQueryError = { message: string };

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

type ExpoPushReceipt = {
  status?: string;
  message?: string;
  details?: {
    error?: string;
    [key: string]: unknown;
  };
};

type ExpoReceiptResponse = {
  data?: Record<string, ExpoPushReceipt>;
  errors?: Array<Record<string, unknown>>;
};

type ExpoApiResponse = ExpoPushResponse | ExpoReceiptResponse;

type ProfilePushTokenRow = {
  id: string;
  expo_push_token: string | null;
  device_id: string | null;
  platform: string | null;
};

type PendingDeliveryRow = {
  notification_id: string;
  user_id: string;
  expo_push_token: string;
  ticket_id: string | null;
  attempt_count: number | null;
};

type PushTokenTarget = {
  id: string | null;
  expoPushToken: string;
  source: "profile_push_tokens" | "profiles";
};

type PushDeliveryRow = {
  notification_id: string;
  user_id: string;
  expo_push_token: string;
  status: string;
  ticket_id: string | null;
  error_code: string | null;
  error_message: string | null;
  attempt_count: number;
  next_retry_at: string | null;
  failed_at: string | null;
};

type PushDeliveryUpdate = {
  status: string;
  receipt_id?: string;
  error_code: string | null;
  error_message: string | null;
  attempt_count?: number;
  next_retry_at: string | null;
  delivered_at?: string | null;
  failed_at?: string | null;
};

type PushAuthUser = {
  id?: string;
};

type PushAuthGetUserResult = {
  data: { user: PushAuthUser | null };
  error: PushQueryError | null;
};

type QueryResult<T> = { data: T; error: PushQueryError | null };
type MaybeSingleResult<T> = { data: T | null; error: PushQueryError | null };

export interface PushQueryBuilder<T = unknown>
  extends PromiseLike<QueryResult<T>> {
  eq: (column: string, value: unknown) => PushQueryBuilder<T>;
  is: (column: string, value: unknown) => PushQueryBuilder<T>;
  not: (
    column: string,
    operator: string,
    value: unknown
  ) => PushQueryBuilder<T>;
  lte: (column: string, value: unknown) => PushQueryBuilder<T>;
  or: (filters: string) => PushQueryBuilder<T>;
  order: (
    column: string,
    options?: { ascending?: boolean }
  ) => PushQueryBuilder<T>;
  limit: (count: number) => PushQueryBuilder<T>;
  maybeSingle: <Row = unknown>() => Promise<MaybeSingleResult<Row>>;
}

export interface PushTableClient {
  select: <Row = unknown>(columns: string) => PushQueryBuilder<Row>;
  update: (values: Record<string, unknown>) => PushQueryBuilder<unknown>;
  insert: (
    values: Record<string, unknown> | Array<Record<string, unknown>>
  ) => PromiseLike<{
    error: PushQueryError | null;
  }>;
  upsert: (
    values: Record<string, unknown> | Array<Record<string, unknown>>,
    options?: { onConflict?: string }
  ) => PromiseLike<{ error: PushQueryError | null }>;
}

export interface PushAdminClient extends RuntimeConfigAdminClient {
  from: (table: string) => PushTableClient;
  auth: {
    getUser: (jwt: string) => PromiseLike<PushAuthGetUserResult>;
  };
}

export interface PushEnvironment {
  get: (key: string) => string | undefined;
}

export interface PushHandlerDependencies {
  createClientFn: (url: string, key: string) => PushAdminClient;
  env: PushEnvironment;
  fetchFn?: typeof fetch;
}

const JSON_HEADERS = { "Content-Type": "application/json" };
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
const EXPO_PUSH_TOKEN_PATTERN = /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/;
const RECEIPT_BATCH_LIMIT = 100;
const MAX_RECEIPT_ATTEMPTS = 3;
const RECEIPT_RETRY_DELAY_MS = 5 * 60 * 1000;

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

function isAuthorizedRequest(req: Request, env: PushEnvironment): boolean {
  const authHeader = req.headers.get("Authorization");
  const serviceRoleKey = env.get("SUPABASE_SERVICE_ROLE_KEY");

  return !!serviceRoleKey && authHeader === `Bearer ${serviceRoleKey}`;
}

function normalizeExpoPriority(
  priority: NotificationRecord["priority"]
): "default" | "normal" | "high" {
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

function hasExpoApiErrors(response: ExpoApiResponse): boolean {
  return Array.isArray(response.errors) && response.errors.length > 0;
}

function createExpoApiHeaders(
  expoAccessToken: string | undefined
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  if (expoAccessToken) {
    headers.Authorization = `Bearer ${expoAccessToken}`;
  }

  return headers;
}

async function resolveExpoAccessTokenFromRuntimeConfig(
  adminClient: RuntimeConfigAdminClient,
  env: PushEnvironment
): Promise<string | undefined> {
  const runtimeConfig = createRuntimeConfigProvider({
    adminClient,
    cacheTtlMs: 0,
    fallback: {
      enabled: true,
      env,
      allowKeys: [CONFIG_KEYS.pushExpoAccessToken],
    },
  });

  try {
    const expoAccessTokenEntry = await runtimeConfig.getOptionalConfig(
      CONFIG_KEYS.pushExpoAccessToken
    );
    const expoAccessToken = expoAccessTokenEntry?.value;

    return typeof expoAccessToken === "string" && expoAccessToken.trim()
      ? expoAccessToken.trim()
      : undefined;
  } catch (error) {
    if (error instanceof RuntimeConfigError) {
      console.error(
        "[push] Expo access token runtime config lookup failed",
        error.toLogSafe()
      );
      return undefined;
    }

    throw error;
  }
}

function isSupportedWebhookPayload(
  payload: Partial<WebhookPayload>
): payload is WebhookPayload {
  return (
    payload.type === "INSERT" &&
    payload.table === "notifications" &&
    payload.schema === "public" &&
    !!payload.record &&
    typeof payload.record.user_id === "string"
  );
}

function isReceiptActionPayload(payload: ReceiptActionPayload): boolean {
  return (
    payload.action === "process_receipts" || payload.action === "check_receipts"
  );
}

function isTestNotificationActionPayload(
  payload: TestNotificationActionPayload
): boolean {
  return payload.action === "send_test_notification";
}

function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.get("Authorization")?.trim();

  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

function isAdminDashboardNotification(
  notification: NotificationRecord
): boolean {
  return notification.data?.["audience"] === "admin_dashboard";
}

function normalizeReceiptLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return RECEIPT_BATCH_LIMIT;
  }

  return Math.max(1, Math.min(value, RECEIPT_BATCH_LIMIT));
}

function nextRetryTimestamp(attemptCount: number): string | null {
  if (attemptCount >= MAX_RECEIPT_ATTEMPTS) {
    return null;
  }

  return new Date(Date.now() + RECEIPT_RETRY_DELAY_MS).toISOString();
}

function toExpoErrorCode(
  ticket: ExpoPushTicket | ExpoPushReceipt
): string | null {
  return ticket.details?.error ?? null;
}

function toExpoErrorMessage(
  ticket: ExpoPushTicket | ExpoPushReceipt
): string | null {
  return typeof ticket.message === "string" && ticket.message.trim()
    ? ticket.message
    : null;
}

async function loadLegacyProfileExpoToken(
  adminClient: PushAdminClient,
  notification: NotificationRecord
): Promise<{ token: PushTokenTarget | null; profileLookupFailed: boolean }> {
  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("expo_push_token")
    .eq("id", notification.user_id)
    .maybeSingle<{ expo_push_token?: string | null }>();

  if (profileError) {
    console.error(
      "[push] Failed to load recipient legacy push token:",
      profileError.message
    );
    return { token: null, profileLookupFailed: true };
  }

  const expoPushToken =
    typeof profile?.expo_push_token === "string"
      ? profile.expo_push_token.trim()
      : "";

  return {
    token: expoPushToken
      ? { id: null, expoPushToken, source: "profiles" }
      : null,
    profileLookupFailed: false,
  };
}

async function loadPushTargets(
  adminClient: PushAdminClient,
  notification: NotificationRecord
): Promise<{
  tokens: PushTokenTarget[];
  lookupFailed: boolean;
  failureReason: "token_lookup_failed" | "profile_lookup_failed" | null;
}> {
  const { data: tokenRows, error: tokenError } = await adminClient
    .from("profile_push_tokens")
    .select<ProfilePushTokenRow[]>("id, expo_push_token, device_id, platform")
    .eq("user_id", notification.user_id)
    .is("revoked_at", null)
    .order("last_seen_at", { ascending: false });

  if (tokenError) {
    console.error(
      "[push] Failed to load active recipient push tokens:",
      tokenError.message
    );
    return {
      tokens: [],
      lookupFailed: true,
      failureReason: "token_lookup_failed",
    };
  }

  const activeTokens = (Array.isArray(tokenRows) ? tokenRows : [])
    .map((row) => ({
      id: row.id,
      expoPushToken:
        typeof row.expo_push_token === "string"
          ? row.expo_push_token.trim()
          : "",
      source: "profile_push_tokens" as const,
    }))
    .filter((row) => row.expoPushToken.length > 0);

  if (activeTokens.length > 0) {
    const dedupedTargets = new Map<string, PushTokenTarget>();

    for (const target of activeTokens) {
      if (!dedupedTargets.has(target.expoPushToken)) {
        dedupedTargets.set(target.expoPushToken, target);
      }
    }

    return {
      tokens: [...dedupedTargets.values()],
      lookupFailed: false,
      failureReason: null,
    };
  }

  const legacyTokenResult = await loadLegacyProfileExpoToken(
    adminClient,
    notification
  );

  if (legacyTokenResult.profileLookupFailed) {
    return {
      tokens: [],
      lookupFailed: true,
      failureReason: "profile_lookup_failed",
    };
  }

  return {
    tokens: legacyTokenResult.token ? [legacyTokenResult.token] : [],
    lookupFailed: false,
    failureReason: null,
  };
}

function createExpoMessages(
  notification: NotificationRecord,
  targets: PushTokenTarget[]
) {
  return targets.map((target) => ({
    to: target.expoPushToken,
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
  }));
}

function createTestNotification(userId: string): NotificationRecord {
  return {
    id: `test:${userId}:${Date.now()}`,
    user_id: userId,
    type: "test_notification",
    title: "Tes Notifikasi",
    body: "Ini adalah notifikasi tes dari aplikasi Apotek Ecommerce.",
    cta_route: null,
    data: { action: "send_test_notification" },
    priority: "normal",
    source_event_key: null,
    created_at: new Date().toISOString(),
  };
}

function partitionPushTargetsByTokenFormat(targets: PushTokenTarget[]) {
  const validTargets: PushTokenTarget[] = [];
  const invalidTargets: PushTokenTarget[] = [];

  for (const target of targets) {
    if (EXPO_PUSH_TOKEN_PATTERN.test(target.expoPushToken)) {
      validTargets.push(target);
    } else {
      invalidTargets.push(target);
    }
  }

  return { validTargets, invalidTargets };
}

function buildInvalidTokenDeliveryRows(
  notification: NotificationRecord,
  targets: PushTokenTarget[]
): PushDeliveryRow[] {
  const now = new Date().toISOString();

  return targets.map((target) => ({
    notification_id: notification.id,
    user_id: notification.user_id,
    expo_push_token: target.expoPushToken,
    status: "error",
    ticket_id: null,
    error_code: "invalid_token_format",
    error_message: "Expo push token format is invalid",
    attempt_count: 1,
    next_retry_at: null,
    failed_at: now,
  }));
}

function buildDeliveryRows(
  notification: NotificationRecord,
  targets: PushTokenTarget[],
  tickets: ExpoPushTicket[]
): PushDeliveryRow[] {
  const now = new Date().toISOString();

  return targets.map((target, index) => {
    const ticket = tickets[index] ?? {};
    const status = ticket.status ?? "unknown";
    const errorCode = toExpoErrorCode(ticket);
    const failedAt = status === "error" ? now : null;
    const hasReceiptTicket =
      typeof ticket.id === "string" && ticket.id.trim().length > 0;

    return {
      notification_id: notification.id,
      user_id: notification.user_id,
      expo_push_token: target.expoPushToken,
      status,
      ticket_id: ticket.id ?? null,
      error_code: errorCode,
      error_message: toExpoErrorMessage(ticket),
      attempt_count: 1,
      next_retry_at: status === "ok" && hasReceiptTicket ? now : null,
      failed_at: failedAt,
    };
  });
}

async function persistDeliveries(
  adminClient: PushAdminClient,
  deliveryRows: PushDeliveryRow[]
): Promise<void> {
  if (deliveryRows.length === 0) {
    return;
  }

  const { error: deliveryError } = await adminClient
    .from("notification_push_deliveries")
    .upsert(deliveryRows, { onConflict: "notification_id,expo_push_token" });

  if (deliveryError) {
    console.error("[push] Failed to persist Expo delivery tickets", {
      message: deliveryError.message,
    });
  }
}

async function revokePushTarget(
  adminClient: PushAdminClient,
  userId: string,
  target: PushTokenTarget
): Promise<void> {
  const revokedAt = new Date().toISOString();

  if (target.source === "profile_push_tokens") {
    let revokeQuery = adminClient
      .from("profile_push_tokens")
      .update({ revoked_at: revokedAt, updated_at: revokedAt })
      .eq("user_id", userId)
      .eq("expo_push_token", target.expoPushToken)
      .is("revoked_at", null);

    if (target.id) {
      revokeQuery = revokeQuery.eq("id", target.id);
    }

    const { error: tokenRevokeError } = await revokeQuery;

    if (tokenRevokeError) {
      console.error("[push] Failed to revoke stale profile push token", {
        userId,
        message: tokenRevokeError.message,
      });
    }
  }

  const { error: legacyCleanupError } = await adminClient
    .from("profiles")
    .update({
      expo_push_token: null,
      expo_push_token_updated_at: revokedAt,
    })
    .eq("id", userId)
    .eq("expo_push_token", target.expoPushToken);

  if (legacyCleanupError) {
    console.error("[push] Failed to clear matching legacy Expo push token", {
      userId,
      message: legacyCleanupError.message,
    });
  }
}

async function revokeMatchingTokenByValue(
  adminClient: PushAdminClient,
  userId: string,
  expoPushToken: string
): Promise<void> {
  await revokePushTarget(adminClient, userId, {
    id: null,
    expoPushToken,
    source: "profile_push_tokens",
  });
}

function createReceiptUpdate(
  receipt: ExpoPushReceipt,
  ticketId: string,
  attemptCount: number
): PushDeliveryUpdate {
  const now = new Date().toISOString();
  const status = receipt.status ?? "unknown";
  const errorCode = toExpoErrorCode(receipt);
  const nextAttemptCount = attemptCount + 1;
  const shouldRetry =
    errorCode !== "DeviceNotRegistered" &&
    nextAttemptCount < MAX_RECEIPT_ATTEMPTS;

  if (status === "ok") {
    return {
      status: "delivered",
      receipt_id: ticketId,
      error_code: null,
      error_message: null,
      attempt_count: nextAttemptCount,
      next_retry_at: null,
      delivered_at: now,
      failed_at: null,
    };
  }

  return {
    status: "error",
    ...(shouldRetry ? {} : { receipt_id: ticketId }),
    error_code: errorCode,
    error_message: toExpoErrorMessage(receipt),
    attempt_count: nextAttemptCount,
    next_retry_at: shouldRetry ? nextRetryTimestamp(nextAttemptCount) : null,
    delivered_at: null,
    failed_at: errorCode === "DeviceNotRegistered" || !shouldRetry ? now : null,
  };
}

async function processReceipts(
  adminClient: PushAdminClient,
  fetchFn: typeof fetch,
  env: PushEnvironment,
  limit: number
): Promise<Response> {
  const { data: pendingDeliveries, error: pendingError } = await adminClient
    .from("notification_push_deliveries")
    .select<PendingDeliveryRow[]>(
      "notification_id, user_id, expo_push_token, ticket_id, attempt_count"
    )
    .not("ticket_id", "is", null)
    .is("receipt_id", null)
    .is("delivered_at", null)
    .is("failed_at", null)
    .or(`next_retry_at.is.null,next_retry_at.lte.${new Date().toISOString()}`)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (pendingError) {
    console.error(
      "[push] Failed to load pending Expo tickets",
      pendingError.message
    );
    return jsonResponse({ processed: false, reason: "receipt_lookup_failed" });
  }

  const deliveries = (
    Array.isArray(pendingDeliveries) ? pendingDeliveries : []
  ).filter(
    (delivery) =>
      typeof delivery.ticket_id === "string" &&
      delivery.ticket_id.trim().length > 0
  );

  if (deliveries.length === 0) {
    return jsonResponse({ processed: true, receipts: 0 });
  }

  const expoAccessToken = await resolveExpoAccessTokenFromRuntimeConfig(
    adminClient,
    env
  );
  const ticketIds = deliveries
    .map((delivery) => delivery.ticket_id)
    .filter((ticketId): ticketId is string => !!ticketId);

  let receiptResponse: ExpoReceiptResponse;

  try {
    const response = await fetchFn(EXPO_RECEIPTS_URL, {
      method: "POST",
      headers: createExpoApiHeaders(expoAccessToken),
      body: JSON.stringify({ ids: ticketIds }),
    });

    receiptResponse = (await response
      .json()
      .catch(() => ({}))) as ExpoReceiptResponse;

    if (!response.ok) {
      console.error("[push] Expo receipt API request failed", {
        status: response.status,
        response: receiptResponse,
      });
      return jsonResponse({
        processed: false,
        reason: "expo_receipt_request_failed",
      });
    }

    if (hasExpoApiErrors(receiptResponse)) {
      console.error("[push] Expo receipt API returned errors", {
        response: receiptResponse,
      });
      return jsonResponse({
        processed: false,
        reason: "expo_receipt_response_error",
      });
    }
  } catch (error: unknown) {
    console.error("[push] Expo receipt API network error", {
      message: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse({
      processed: false,
      reason: "expo_receipt_network_error",
    });
  }

  const receipts = receiptResponse.data ?? {};
  let updatedCount = 0;

  for (const delivery of deliveries) {
    const ticketId = delivery.ticket_id;
    if (!ticketId) {
      continue;
    }

    const receipt = receipts[ticketId];
    if (!receipt) {
      continue;
    }

    const updateValues = createReceiptUpdate(
      receipt,
      ticketId,
      delivery.attempt_count ?? 0
    );
    const { error: updateError } = await adminClient
      .from("notification_push_deliveries")
      .update(updateValues)
      .eq("ticket_id", ticketId);

    if (updateError) {
      console.error("[push] Failed to update Expo receipt status", {
        ticketId,
        message: updateError.message,
      });
      continue;
    }

    updatedCount += 1;

    if (toExpoErrorCode(receipt) === "DeviceNotRegistered") {
      await revokeMatchingTokenByValue(
        adminClient,
        delivery.user_id,
        delivery.expo_push_token
      );
    }
  }

  return jsonResponse({ processed: true, receipts: updatedCount });
}

async function sendPushNotification(
  adminClient: PushAdminClient,
  fetchFn: typeof fetch,
  env: PushEnvironment,
  notification: NotificationRecord,
  options: { persistDeliveryRows: boolean }
): Promise<Response> {
  const pushTargetsResult = await loadPushTargets(adminClient, notification);

  if (pushTargetsResult.lookupFailed) {
    return jsonResponse({
      delivered: false,
      reason: pushTargetsResult.failureReason,
    });
  }

  if (pushTargetsResult.tokens.length === 0) {
    console.info("[push] Recipient has no Expo push token", {
      notificationId: notification.id,
      userId: notification.user_id,
    });
    return jsonResponse({ delivered: false, reason: "missing_token" });
  }

  const { validTargets, invalidTargets } = partitionPushTargetsByTokenFormat(
    pushTargetsResult.tokens
  );

  if (invalidTargets.length > 0) {
    console.warn("[push] Recipient push token format is invalid", {
      notificationId: notification.id,
      userId: notification.user_id,
      invalidTokenCount: invalidTargets.length,
    });

    if (options.persistDeliveryRows) {
      await persistDeliveries(
        adminClient,
        buildInvalidTokenDeliveryRows(notification, invalidTargets)
      );
    }

    for (const target of invalidTargets) {
      await revokePushTarget(adminClient, notification.user_id, target);
    }
  }

  if (validTargets.length === 0) {
    return jsonResponse({
      delivered: false,
      reason: "invalid_token_format",
    });
  }

  const expoAccessToken = await resolveExpoAccessTokenFromRuntimeConfig(
    adminClient,
    env
  );

  let expoResponse: ExpoPushResponse;

  try {
    const response = await fetchFn(EXPO_PUSH_URL, {
      method: "POST",
      headers: createExpoApiHeaders(expoAccessToken),
      body: JSON.stringify(createExpoMessages(notification, validTargets)),
    });

    expoResponse = (await response
      .json()
      .catch(() => ({}))) as ExpoPushResponse;

    if (!response.ok) {
      console.error("[push] Expo Push API request failed", {
        notificationId: notification.id,
        status: response.status,
        response: expoResponse,
      });
      return jsonResponse({
        delivered: false,
        reason: "expo_request_failed",
      });
    }

    if (hasExpoApiErrors(expoResponse)) {
      console.error("[push] Expo Push API returned errors", {
        notificationId: notification.id,
        response: expoResponse,
      });
      return jsonResponse({
        delivered: false,
        reason: "expo_response_error",
      });
    }
  } catch (error: unknown) {
    console.error("[push] Expo Push API network error", {
      notificationId: notification.id,
      message: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse({ delivered: false, reason: "expo_network_error" });
  }

  const tickets = toTicketList(expoResponse);

  if (options.persistDeliveryRows) {
    await persistDeliveries(
      adminClient,
      buildDeliveryRows(notification, validTargets, tickets)
    );
  }

  const indexedErrorTicket = tickets
    .map((ticket, index) => ({ ticket, index }))
    .find(({ ticket }) => ticket.status === "error");

  for (const [index, ticket] of tickets.entries()) {
    if (
      ticket.status !== "error" ||
      toExpoErrorCode(ticket) !== "DeviceNotRegistered"
    ) {
      continue;
    }

    const target = validTargets[index];
    if (target) {
      await revokePushTarget(adminClient, notification.user_id, target);
    }
  }

  if (indexedErrorTicket) {
    const expoErrorCode = toExpoErrorCode(indexedErrorTicket.ticket);

    if (expoErrorCode !== "DeviceNotRegistered") {
      console.error("[push] Expo ticket returned an error", {
        notificationId: notification.id,
        ticket: indexedErrorTicket.ticket,
      });
    }

    return jsonResponse({
      delivered: false,
      reason: expoErrorCode ?? "expo_ticket_error",
      tickets,
    });
  }

  return jsonResponse({
    delivered: true,
    tickets,
  });
}

async function authenticateSupabaseUser(
  req: Request,
  adminClient: PushAdminClient
): Promise<{ userId: string | null; response: Response | null }> {
  const jwt = extractBearerToken(req);

  if (!jwt) {
    return {
      userId: null,
      response: jsonResponse({ error: "Unauthorized" }, 401),
    };
  }

  const { data, error } = await adminClient.auth.getUser(jwt);
  const userId = typeof data.user?.id === "string" ? data.user.id : "";

  if (error || !userId) {
    return {
      userId: null,
      response: jsonResponse({ error: "Unauthorized" }, 401),
    };
  }

  return { userId, response: null };
}

export function createPushHandler(dependencies: PushHandlerDependencies) {
  const fetchFn = dependencies.fetchFn ?? fetch;

  return async (req: Request) => {
    if (req.method !== "POST") {
      return jsonResponse({ error: "Method Not Allowed" }, 405);
    }

    try {
      const body = await req.json().catch(() => ({}));
      const receiptPayload = body as ReceiptActionPayload;
      const testNotificationPayload = body as TestNotificationActionPayload;

      if (
        !isTestNotificationActionPayload(testNotificationPayload) &&
        !isAuthorizedRequest(req, dependencies.env)
      ) {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }

      if (
        !isReceiptActionPayload(receiptPayload) &&
        !isTestNotificationActionPayload(testNotificationPayload)
      ) {
        const payload = body as Partial<WebhookPayload>;

        if (!isSupportedWebhookPayload(payload)) {
          return jsonResponse({
            skipped: true,
            reason: "Unsupported webhook payload",
          });
        }

        if (isAdminDashboardNotification(payload.record)) {
          return jsonResponse({
            delivered: false,
            reason: "admin_dashboard_only",
          });
        }
      }

      const supabaseUrl = dependencies.env.get("SUPABASE_URL");
      const supabaseKey = dependencies.env.get("SUPABASE_SERVICE_ROLE_KEY");

      if (!supabaseUrl || !supabaseKey) {
        console.error("[push] Missing Supabase admin client configuration");
        return jsonResponse({ delivered: false, reason: "internal_error" });
      }

      const adminClient = dependencies.createClientFn(supabaseUrl, supabaseKey);

      if (isTestNotificationActionPayload(testNotificationPayload)) {
        const authResult = await authenticateSupabaseUser(req, adminClient);

        if (authResult.response) {
          return authResult.response;
        }

        const userId = authResult.userId;

        if (!userId) {
          return jsonResponse({ error: "Unauthorized" }, 401);
        }

        return sendPushNotification(
          adminClient,
          fetchFn,
          dependencies.env,
          createTestNotification(userId),
          { persistDeliveryRows: false }
        );
      }

      if (isReceiptActionPayload(receiptPayload)) {
        return processReceipts(
          adminClient,
          fetchFn,
          dependencies.env,
          normalizeReceiptLimit(receiptPayload.limit)
        );
      }

      const payload = body as Partial<WebhookPayload>;
      if (!isSupportedWebhookPayload(payload)) {
        return jsonResponse({
          skipped: true,
          reason: "Unsupported webhook payload",
        });
      }

      const notification = payload.record;

      return sendPushNotification(
        adminClient,
        fetchFn,
        dependencies.env,
        notification,
        { persistDeliveryRows: true }
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("[push] Internal error:", message);
      return jsonResponse({ delivered: false, reason: "internal_error" });
    }
  };
}
