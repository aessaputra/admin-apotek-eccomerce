import { corsHeaders } from "../_shared/cors.ts";
import {
  ORDER_DETAIL_NOTIFICATION_ROUTE,
  insertNotificationOrThrow,
} from "../_shared/notification-helpers.ts";
import { canConfirmReceivedOrder } from "../_shared/order-flow-rules.ts";

type OrderRow = {
  id: string;
  user_id: string | null;
  status: string;
  payment_status: string;
  delivered_at: string | null;
  complaint_window_expires_at: string | null;
  customer_completed_at: string | null;
};

type OrderActivitiesInsert = {
  order_id: string;
  action: string;
  old_status: string | null;
  new_status: string | null;
  actor_id: string | null;
  actor_type: string;
  metadata: Record<string, unknown>;
};

type OrdersTableQuery = {
  select: (columns: string) => {
    eq: (column: string, value: string) => {
      maybeSingle: () => PromiseLike<{ data: Pick<OrderRow, "id" | "status" | "customer_completed_at"> | null; error: { message: string } | null }>;
    };
  };
  update: (values: Record<string, unknown>) => {
    eq: (column: string, value: string) => {
      is: (column: string, value: null) => {
        select: (columns: string) => {
          maybeSingle: () => PromiseLike<{ data: Pick<OrderRow, "id" | "status" | "customer_completed_at"> | null; error: { message: string } | null }>;
        };
      };
    };
  };
};

type OrderReadModelQuery = {
  select: (columns: string) => {
    eq: (column: string, value: string) => {
      maybeSingle: () => PromiseLike<{ data: OrderRow | null; error: { message: string } | null }>;
    };
  };
};

type OrderActivitiesTableQuery = {
  insert: (values: OrderActivitiesInsert) => PromiseLike<{ error: { message: string } | null }>;
};

type NotificationsTableQuery = {
  insert: (values: Record<string, unknown>) => PromiseLike<{ error: { message?: string; code?: string } | null }>;
};

type ProfilesTableQuery = {
  select: (columns: "is_banned") => {
    eq: (column: "id", value: string) => {
      single: () => PromiseLike<{ data: { is_banned: boolean | null } | null; error: { message: string } | null }>;
    };
  };
};

export type ConfirmOrderReceivedAdminClient = {
  from(table: "orders"): OrdersTableQuery;
  from(table: "order_read_model"): OrderReadModelQuery;
  from(table: "order_activities"): OrderActivitiesTableQuery;
  from(table: "notifications"): NotificationsTableQuery;
  from(table: "profiles"): ProfilesTableQuery;
};

export type ConfirmOrderReceivedHandlerDependencies = {
  getAuthenticatedUserId: (req: Request) => Promise<string | null>;
  getAdminClient: () => ConfirmOrderReceivedAdminClient;
  now?: () => string;
  logError?: (message: string) => void;
};

const JSON_HEADERS = { ...corsHeaders, "Content-Type": "application/json" };

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

async function isCustomerBanned(
  adminClient: ConfirmOrderReceivedAdminClient,
  userId: string,
): Promise<boolean> {
  const { data, error } = await adminClient.from("profiles").select("is_banned").eq("id", userId).single();

  if (error) {
    throw new Error("Failed to verify customer policy");
  }

  return data?.is_banned === true;
}

async function ensureOrderCompletedNotification(
  adminClient: ConfirmOrderReceivedAdminClient,
  userId: string | null,
  orderId: string,
): Promise<void> {
  await insertNotificationOrThrow(
    adminClient,
    {
      userId,
      type: "order_completed",
      title: "Pesanan selesai",
      body: "Terima kasih. Pesananmu sudah selesai dan tercatat di riwayat pesanan.",
      ctaRoute: ORDER_DETAIL_NOTIFICATION_ROUTE,
      data: {
        orderId,
        completionStage: "completed",
      },
      priority: "normal",
      sourceEventKey: `order_completed:${orderId}`,
    },
    "[confirm-order-received]",
  );
}

export function createConfirmOrderReceivedHandler(
  dependencies: ConfirmOrderReceivedHandlerDependencies,
): (req: Request) => Promise<Response> {
  const now = dependencies.now ?? (() => new Date().toISOString());
  const logError = dependencies.logError ?? ((message: string) => {
    console.error("[confirm-order-received] internal_error", { action: message });
  });

  return async (req) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    if (req.method !== "POST") {
      return jsonResponse({ error: "Method Not Allowed" }, 405);
    }

    const userId = await dependencies.getAuthenticatedUserId(req);
    if (!userId) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    try {
      const body = await req.json().catch(() => ({}));
      const orderId = typeof body?.order_id === "string" ? body.order_id.trim() : "";

      if (!orderId) {
        return jsonResponse({ error: "order_id is required" }, 400);
      }

      const adminClient = dependencies.getAdminClient();
      const { data: order, error: orderError } = await adminClient
        .from("order_read_model")
        .select(
          "id, user_id, status, payment_status, delivered_at, complaint_window_expires_at, customer_completed_at",
        )
        .eq("id", orderId)
        .maybeSingle();

      if (orderError) {
        throw new Error(`Failed to fetch order: ${orderError.message}`);
      }

      if (!order) {
        return jsonResponse({ error: "Order not found" }, 404);
      }

      if (order.user_id !== userId) {
        return jsonResponse({ error: "Order not found" }, 404);
      }

      if (order.status !== "delivered") {
        return jsonResponse({ error: "Only delivered orders can be confirmed" }, 409);
      }

      if (!canConfirmReceivedOrder({ orderStatus: order.status, paymentStatus: order.payment_status })) {
        return jsonResponse({ error: "Only paid orders can be confirmed" }, 409);
      }

      if (await isCustomerBanned(adminClient, userId)) {
        return jsonResponse({ error: "Customer account is not allowed to confirm received orders" }, 403);
      }

      if (order.customer_completed_at) {
        await ensureOrderCompletedNotification(adminClient, order.user_id, orderId);

        return jsonResponse({
          success: true,
          data: {
            order_id: order.id,
            status: order.status,
            customer_completion_stage: "completed",
            customer_completed_at: order.customer_completed_at,
          },
        });
      }

      const completedAt = now();
      const { data: updatedOrder, error: updateError } = await adminClient
        .from("orders")
        .update({
          customer_completed_at: completedAt,
          customer_completed_by: userId,
          customer_completion_source: "customer",
          updated_at: completedAt,
        })
        .eq("id", orderId)
        .is("customer_completed_at", null)
        .select("id, status, customer_completed_at")
        .maybeSingle();

      if (updateError) {
        throw new Error(`Failed to update order: ${updateError.message}`);
      }

      if (!updatedOrder) {
        const { data: existingOrder, error: existingOrderError } = await adminClient
          .from("orders")
          .select("id, status, customer_completed_at")
          .eq("id", orderId)
          .maybeSingle();

        if (existingOrderError) {
          throw new Error(`Failed to re-read order: ${existingOrderError.message}`);
        }

        await ensureOrderCompletedNotification(adminClient, order.user_id, orderId);

        return jsonResponse({
          success: true,
          data: {
            order_id: orderId,
            status: existingOrder?.status ?? order.status,
            customer_completion_stage: "completed",
            customer_completed_at: existingOrder?.customer_completed_at ?? completedAt,
          },
        });
      }

      const effectiveCompletedAt = updatedOrder.customer_completed_at ?? completedAt;

      const { error: activityError } = await adminClient.from("order_activities").insert({
        order_id: orderId,
        action: "customer_completed",
        old_status: order.status,
        new_status: order.status,
        actor_id: userId,
        actor_type: "customer",
        metadata: {
          delivered_at: order.delivered_at ?? null,
          complaint_window_expires_at: order.complaint_window_expires_at ?? null,
          customer_completed_at: effectiveCompletedAt,
        },
      });

      if (activityError) {
        console.error("[confirm-order-received] Failed to log activity:", activityError);
      }

      await ensureOrderCompletedNotification(adminClient, order.user_id, orderId);

      return jsonResponse({
        success: true,
        data: {
          order_id: orderId,
          status: order.status,
          customer_completion_stage: "completed",
          customer_completed_at: effectiveCompletedAt,
        },
      });
    } catch {
      logError("confirm_order_received_failed");
      return jsonResponse({ error: "Internal server error" }, 500);
    }
  };
}
