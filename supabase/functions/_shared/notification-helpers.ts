export const ORDER_DETAIL_NOTIFICATION_ROUTE = "orders/order-detail/[orderId]";
export const TRACK_SHIPMENT_NOTIFICATION_ROUTE = "orders/track-shipment/[orderId]";

export type NotificationPriority = "low" | "normal" | "high";
export type NotificationRoute =
  | typeof ORDER_DETAIL_NOTIFICATION_ROUTE
  | typeof TRACK_SHIPMENT_NOTIFICATION_ROUTE;

type NotificationInsertError = {
  code?: string;
  message?: string;
};

type NotificationInsertClient = {
  from(table: "notifications"): {
    insert: (
      values: Record<string, unknown>,
    ) => PromiseLike<{ error: NotificationInsertError | null }>;
  };
};

export type NotificationInsertPayload = {
  userId: string | null | undefined;
  type: string;
  title: string;
  body: string;
  ctaRoute?: NotificationRoute | null;
  data?: Record<string, unknown>;
  priority?: NotificationPriority;
  sourceEventKey?: string | null;
};

export type NotificationInsertResult = {
  inserted: boolean;
  duplicate: boolean;
  skipped: boolean;
  failed: boolean;
  errorMessage?: string;
};

export class NotificationInsertFailureError extends Error {
  constructor(
    message: string,
    readonly result: NotificationInsertResult,
  ) {
    super(message);
    this.name = "NotificationInsertFailureError";
  }
}

function isDuplicateNotificationError(error: NotificationInsertError | null): boolean {
  return (
    error?.code === "23505" ||
    error?.message?.includes("notifications_user_source_event_key_uidx") === true
  );
}

export async function insertNotification(
  adminClient: NotificationInsertClient,
  payload: NotificationInsertPayload,
  logPrefix: string,
): Promise<NotificationInsertResult> {
  const userId = payload.userId?.trim();

  if (!userId) {
    console.warn(`${logPrefix} Skipping notification insert because user_id is missing`);
    return {
      inserted: false,
      duplicate: false,
      skipped: true,
      failed: false,
    };
  }

  const { error } = await adminClient.from("notifications").insert({
    user_id: userId,
    type: payload.type,
    title: payload.title,
    body: payload.body,
    cta_route: payload.ctaRoute ?? null,
    data: payload.data ?? {},
    priority: payload.priority ?? "normal",
    source_event_key: payload.sourceEventKey ?? null,
  });

  if (!error) {
    return {
      inserted: true,
      duplicate: false,
      skipped: false,
      failed: false,
    };
  }

  if (isDuplicateNotificationError(error)) {
    console.info(`${logPrefix} Notification already exists for source_event_key`, {
      userId,
      sourceEventKey: payload.sourceEventKey ?? null,
    });

    return {
      inserted: false,
      duplicate: true,
      skipped: false,
      failed: false,
    };
  }

  const errorMessage = error.message ?? "Unknown error";

  console.error(`${logPrefix} Failed to insert notification`, {
    userId,
    type: payload.type,
    sourceEventKey: payload.sourceEventKey ?? null,
    errorMessage,
  });

  return {
    inserted: false,
    duplicate: false,
    skipped: false,
    failed: true,
    errorMessage,
  };
}

export async function insertNotificationOrThrow(
  adminClient: NotificationInsertClient,
  payload: NotificationInsertPayload,
  logPrefix: string,
): Promise<NotificationInsertResult> {
  const result = await insertNotification(adminClient, payload, logPrefix);

  if (result.failed) {
    throw new NotificationInsertFailureError(
      `${logPrefix} Failed to persist durable notification inbox row`,
      result,
    );
  }

  return result;
}
