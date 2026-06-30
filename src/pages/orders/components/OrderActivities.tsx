import React, { useCallback, useEffect, useState } from "react";
import { Timeline, Tag, Spin, Space, Alert, Button, Typography, theme } from "antd";
import { useTranslation } from "@refinedev/core";
import { supabaseClient } from "../../../providers/supabase-client";
import { formatDisplayLabel, formatBiteshipStatusLabel } from "../helpers";
import type { Activity, BiteshipExceptionInfo } from "../types";

const { Text } = Typography;

interface OrderActivitiesProps {
  orderId?: string;
}

export const OrderActivities: React.FC<OrderActivitiesProps> = ({ orderId }) => {
  const { translate } = useTranslation();
  const { token } = theme.useToken();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loadingActivities, setLoadingActivities] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);

  const loadActivities = useCallback(async () => {
    if (!orderId) return;
    setLoadingActivities(true);
    setActivityError(null);
    try {
      const { data, error } = await supabaseClient
        .from("order_activities")
        .select("*")
        .eq("order_id", orderId)
        .order("created_at", { ascending: false })
        .limit(20);

      if (error) {
        setActivityError(translate("orders.activity.loadErrorDescription"));
        return;
      }

      if (data) {
        setActivities(data as Activity[]);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : translate("orders.activity.loadErrorDescription");
      setActivityError(message);
    } finally {
      setLoadingActivities(false);
    }
  }, [orderId, translate]);

  useEffect(() => {
    if (orderId) {
      loadActivities();
    }
  }, [orderId, loadActivities]);

  const formatAdminDate = useCallback((value: string | null | undefined) => {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("id-ID", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Jakarta",
    }).format(date);
  }, []);

  const getActivityIcon = (action: string) => {
    switch (action) {
      case "payment_success": return <Tag color="green" aria-hidden="true">$</Tag>;
      case "payment_updated": return <Tag color="orange" aria-hidden="true">$</Tag>;
      case "status_update": return <Tag color="blue" aria-hidden="true">↻</Tag>;
      case "sync_tracking": return <Tag color="cyan" aria-hidden="true">⟳</Tag>;
      case "webhook_tracking": return <Tag color="geekblue" aria-hidden="true">🔔</Tag>;
      case "shipping_created": return <Tag color="purple" aria-hidden="true">📦</Tag>;
      case "shipment_tracking_exception": return <Tag color="orange" aria-hidden="true">⚠</Tag>;
      case "customer_completed": return <Tag color="green" aria-hidden="true">✓</Tag>;
      default: return <Tag aria-hidden="true">•</Tag>;
    }
  };

  const getActivityText = (activity: Activity) => {
    const statusFrom = activity.old_status
      ? translate(`orderStatus.${activity.old_status}`, {}, formatDisplayLabel(activity.old_status))
      : "-";
    const statusTo = activity.new_status
      ? translate(`orderStatus.${activity.new_status}`, {}, formatDisplayLabel(activity.new_status))
      : "-";
    const resolvedActor = activity.actor_type === 'customer'
      ? translate('orders.activity.actors.customer', {}, 'Customer')
      : translate(
          `orders.activity.actors.${activity.actor_type === 'system' ? 'system' : 'admin'}`,
          {},
          activity.actor_type === 'system' ? 'System' : 'Admin'
        );

    switch (activity.action) {
      case "payment_success":
        return translate("orders.activity.paymentSuccess", {}, "Payment verified successfully");
      case "payment_updated":
        return translate("orders.activity.paymentUpdated", {}, "Payment status updated");
      case "status_update":
        return translate(
          "orders.activity.statusUpdated",
          { actor: resolvedActor, from: statusFrom, to: statusTo },
          `${resolvedActor} changed status: ${statusFrom} → ${statusTo}`
        );
      case "sync_tracking":
        return translate("orders.activity.trackingSynced", {}, "Tracking synced from Biteship");
      case "webhook_tracking":
        return translate("orders.activity.webhookTrackingUpdated", {}, "Status updated automatically from Biteship");
      case "shipping_created":
        return translate("orders.activity.shippingCreated", {}, "Shipping order created in Biteship");
      case 'customer_completed':
        return translate(
          'orders.activity.customerCompleted',
          { actor: resolvedActor },
          `${resolvedActor} confirmed receipt of the order`
        );
      default:
        return translate(
          "orders.activity.unknown",
          { action: activity.action, from: statusFrom, to: statusTo },
          `${activity.action}: ${statusFrom} → ${statusTo}`
        );
    }
  };

  const latestSyncActivity = activities.find(
    (a) => a.action === "sync_tracking" || a.action === "webhook_tracking" || a.action === "shipment_tracking_exception"
  );

  const latestBiteshipException = latestSyncActivity && typeof latestSyncActivity.metadata?.biteship_exception_status === "string"
    ? latestSyncActivity
    : undefined;

  const biteshipExceptionInfo: BiteshipExceptionInfo | null = latestBiteshipException
    ? {
        status: String(latestBiteshipException.metadata.biteship_exception_status),
        alertType: (String(latestBiteshipException.metadata.biteship_exception_alert_type || "warning") as BiteshipExceptionInfo["alertType"]),
        messageKey: String(latestBiteshipException.metadata.biteship_exception_message_key || ""),
      }
    : null;

  if (activityError) {
    return (
      <Alert
        type="error"
        showIcon
        message={translate("orders.activity.loadErrorTitle")}
        description={activityError}
        action={<Button size="small" onClick={loadActivities}>{translate("buttons.retry", {}, "Coba lagi")}</Button>}
      />
    );
  }

  if (loadingActivities) {
    return (
      <div role="status" aria-live="polite">
        <Space>
          <Spin size="small" />
          <Text type="secondary">{translate("orders.activity.loading", {}, "Memuat aktivitas pesanan...")}</Text>
        </Space>
      </div>
    );
  }

  if (activities.length === 0) {
    return <Text type="secondary">{translate("orders.noActivities")}</Text>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: token.marginMD }}>
      {biteshipExceptionInfo && (
        <Alert
          type={biteshipExceptionInfo.alertType}
          showIcon
          message={translate("orders.biteshipAlertTitle")}
          description={
            <Space direction="vertical" size={token.marginXXS}>
              <Text>
                {translate(
                  `orders.biteshipAlerts.${biteshipExceptionInfo.messageKey}`,
                  {},
                  translate("orders.biteshipAlertUnknown")
                )}
              </Text>
              <Text type="secondary">
                {translate("orders.biteshipAlertStatusLabel")}: {formatBiteshipStatusLabel(biteshipExceptionInfo.status)}
              </Text>
            </Space>
          }
        />
      )}
      <Timeline
      items={activities.map((activity) => ({
        dot: getActivityIcon(activity.action),
        children: (
          <div>
            <div>{getActivityText(activity)}</div>
            <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
              {formatAdminDate(activity.created_at)}
            </Text>
          </div>
        ),
      }))}
    />
    </div>
  );
};
