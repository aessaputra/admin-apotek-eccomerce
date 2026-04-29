import { useCallback, useEffect, useRef, useState } from "react";
import { useNotification, useTranslation } from "@refinedev/core";
import { supabaseClient } from "../../../providers/supabase-client";
import type { AdminOrderNotification, NotificationRow } from "./types";

interface UseAdminOrderNotificationsInput {
  userId?: string;
}

interface UseAdminOrderNotificationsResult {
  notifications: AdminOrderNotification[];
  unreadCount: number;
  loading: boolean;
  markAsReadAndOpen: (notification: AdminOrderNotification) => Promise<string>;
}

interface NotificationFeedState {
  notifications: AdminOrderNotification[];
  unreadCount: number;
}

type SubscriptionStatus = "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED" | string;

const ORDER_NOTIFICATION_TYPE = "new_order";
const ADMIN_DASHBOARD_AUDIENCE = "admin_dashboard";
const ORDER_ROUTE_PREFIX = "/orders/show/";
const NOTIFICATION_SELECT = "id,user_id,type,title,body,cta_route,data,priority,source_event_key,read_at,created_at";

function getStringValue(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function getOrderId(row: NotificationRow): string | null {
  const data = row.data ?? {};
  const orderId = getStringValue(data, "orderId");
  if (orderId) return orderId;

  const route = getStringValue(data, "route");
  if (route?.startsWith(ORDER_ROUTE_PREFIX)) {
    const routeOrderId = route.slice(ORDER_ROUTE_PREFIX.length);
    return routeOrderId.trim().length > 0 ? routeOrderId : null;
  }

  if (row.cta_route?.startsWith(ORDER_ROUTE_PREFIX)) {
    const routeOrderId = row.cta_route.slice(ORDER_ROUTE_PREFIX.length);
    return routeOrderId.trim().length > 0 ? routeOrderId : null;
  }

  return null;
}

function normalizeRoute(row: NotificationRow, orderId: string): string {
  if (row.cta_route?.startsWith(ORDER_ROUTE_PREFIX)) {
    return row.cta_route;
  }

  return `${ORDER_ROUTE_PREFIX}${orderId}`;
}

function isAdminDashboardNewOrderRow(row: NotificationRow): boolean {
  return row.type === ORDER_NOTIFICATION_TYPE && row.data?.audience === ADMIN_DASHBOARD_AUDIENCE;
}

function normalizeNotification(row: NotificationRow): AdminOrderNotification | null {
  if (!isAdminDashboardNewOrderRow(row)) return null;

  const orderId = getOrderId(row);
  if (!orderId) return null;

  const data = row.data ?? {};

  return {
    id: row.id,
    userId: row.user_id,
    title: row.title ?? "",
    body: row.body ?? "",
    orderId,
    route: normalizeRoute(row, orderId),
    customerName: getStringValue(data, "customerName"),
    orderStatus: getStringValue(data, "orderStatus"),
    paymentStatus: getStringValue(data, "paymentStatus"),
    createdAt: row.created_at,
    readAt: row.read_at,
    sourceEventKey: row.source_event_key,
  };
}

function getDeduplicationKey(notification: AdminOrderNotification): string {
  return notification.sourceEventKey ?? notification.id;
}

function dedupeNotifications(notifications: AdminOrderNotification[]): AdminOrderNotification[] {
  const seenKeys = new Set<string>();
  const uniqueNotifications: AdminOrderNotification[] = [];

  for (const notification of notifications) {
    const key = getDeduplicationKey(notification);
    if (seenKeys.has(key)) continue;

    seenKeys.add(key);
    uniqueNotifications.push(notification);
  }

  return uniqueNotifications;
}

function sortLatestFirst(notifications: AdminOrderNotification[]): AdminOrderNotification[] {
  return [...notifications].sort((first, second) => {
    const firstTime = new Date(first.createdAt).getTime();
    const secondTime = new Date(second.createdAt).getTime();
    return secondTime - firstTime;
  });
}

function hasNotificationWithKey(notifications: AdminOrderNotification[], key: string): boolean {
  return notifications.some((notification) => getDeduplicationKey(notification) === key);
}

function addRealtimeNotification(
  state: NotificationFeedState,
  notification: AdminOrderNotification
): NotificationFeedState {
  const notificationKey = getDeduplicationKey(notification);
  if (hasNotificationWithKey(state.notifications, notificationKey)) {
    return state;
  }

  const notifications = sortLatestFirst(dedupeNotifications([
    notification,
    ...state.notifications,
  ])).slice(0, 10);

  return {
    notifications,
    unreadCount: notification.readAt ? state.unreadCount : state.unreadCount + 1,
  };
}

function markNotificationRead(
  state: NotificationFeedState,
  notification: AdminOrderNotification,
  readAt: string
): NotificationFeedState {
  const currentNotification = state.notifications.find((item) => item.id === notification.id);
  if (!currentNotification || currentNotification.readAt) {
    return state;
  }

  return {
    notifications: state.notifications.map((currentNotification) => (
      currentNotification.id === notification.id
        ? { ...currentNotification, readAt }
        : currentNotification
    )),
    unreadCount: Math.max(0, state.unreadCount - 1),
  };
}

export function useAdminOrderNotifications({ userId }: UseAdminOrderNotificationsInput): UseAdminOrderNotificationsResult {
  const { open } = useNotification();
  const { translate } = useTranslation();
  const [feedState, setFeedState] = useState<NotificationFeedState>({
    notifications: [],
    unreadCount: 0,
  });
  const [loading, setLoading] = useState(false);
  const hasOpenedFailureNotificationRef = useRef(false);

  const openFailureNotification = useCallback((translationKey: string, fallback: string) => {
    if (hasOpenedFailureNotificationRef.current) return;
    hasOpenedFailureNotificationRef.current = true;

    open?.({
      type: "error",
      message: translate(
        translationKey,
        {},
        fallback
      ),
    });
  }, [open, translate]);

  useEffect(() => {
    if (!userId) {
      setFeedState({ notifications: [], unreadCount: 0 });
      setLoading(false);
      return;
    }

    let isMounted = true;
    setLoading(true);

    const loadNotifications = async () => {
      const [latestResult, unreadResult] = await Promise.all([
        supabaseClient
          .from("notifications")
          .select(NOTIFICATION_SELECT)
          .eq("user_id", userId)
          .eq("type", ORDER_NOTIFICATION_TYPE)
          .eq("data->>audience", ADMIN_DASHBOARD_AUDIENCE)
          .order("created_at", { ascending: false })
          .limit(10),
        supabaseClient
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("type", ORDER_NOTIFICATION_TYPE)
          .eq("data->>audience", ADMIN_DASHBOARD_AUDIENCE)
          .is("read_at", null),
      ]);

      if (!isMounted) return;

      if (latestResult.error || unreadResult.error) {
        openFailureNotification(
          "notifications.orders.new.loadError",
          "New order notifications could not be loaded. Please refresh the page."
        );
      }

      const normalizedRows = (latestResult.data ?? [])
        .map((row) => normalizeNotification(row as NotificationRow))
        .filter((notification): notification is AdminOrderNotification => notification !== null);

      setFeedState({
        notifications: dedupeNotifications(normalizedRows).slice(0, 10),
        unreadCount: unreadResult.count ?? 0,
      });
      setLoading(false);
    };

    void loadNotifications().catch(() => {
      if (!isMounted) return;
      openFailureNotification(
        "notifications.orders.new.loadError",
        "New order notifications could not be loaded. Please refresh the page."
      );
      setLoading(false);
    });

    const channel = supabaseClient
      .channel(`admin-order-notifications-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload: { new: NotificationRow }) => {
          const notification = normalizeNotification(payload.new);
          if (!notification || notification.userId !== userId) return;

          setFeedState((currentState) => addRealtimeNotification(currentState, notification));
        }
      )
      .subscribe((status: SubscriptionStatus) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          openFailureNotification(
            "notifications.orders.new.realtimeError",
            "Live order notifications are temporarily unavailable. Please refresh the page."
          );
        }
      });

    return () => {
      isMounted = false;
      void supabaseClient.removeChannel(channel);
    };
  }, [openFailureNotification, userId]);

  const markAsReadAndOpen = useCallback(async (notification: AdminOrderNotification) => {
    if (!userId) return notification.route;

    const readAt = new Date().toISOString();
    setFeedState((currentState) => markNotificationRead(currentState, notification, readAt));

    await supabaseClient
      .from("notifications")
      .update({ read_at: readAt })
      .eq("id", notification.id)
      .eq("user_id", userId)
      .is("read_at", null);

    return notification.route;
  }, [userId]);

  return {
    notifications: feedState.notifications,
    unreadCount: feedState.unreadCount,
    loading,
    markAsReadAndOpen,
  };
}
