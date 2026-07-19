import { useState } from "react";
import { BellOutlined } from "@ant-design/icons";
import { useTranslation } from "@refinedev/core";
import { Badge, Button, Dropdown, Empty, List, Space, Spin, Tag, Typography, theme } from "antd";
import { useNavigate } from "react-router";
import type { AdminOrderNotification } from "./types";
import { useAdminOrderNotifications } from "./useAdminOrderNotifications";

const { Text } = Typography;
const { useToken } = theme;

interface AdminOrderNotificationsProps {
  userId?: string;
}



function formatCreatedAt(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function getStatusTagColor(status: string | null): string {
  switch (status) {
    case "pending":
      return "warning";
    case "processing":
    case "paid":
    case "awaiting_shipment":
      return "processing";
    case "shipped":
    case "in_transit":
      return "cyan";
    case "delivered":
      return "success";
    case "cancelled":
      return "error";
    default:
      return "default";
  }
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(value);
}

export const AdminOrderNotifications: React.FC<AdminOrderNotificationsProps> = ({ userId }) => {
  const { token } = useToken();
  const { translate } = useTranslation();
  const navigate = useNavigate();
  const [openingNotificationId, setOpeningNotificationId] = useState<string | null>(null);
  const { notifications, unreadCount, loading, markAsReadAndOpen, markAllAsRead } = useAdminOrderNotifications({ userId });

  const handleOpenNotification = async (notification: AdminOrderNotification) => {
    setOpeningNotificationId(notification.id);

    try {
      const route = await markAsReadAndOpen(notification);
      navigate(route);
    } finally {
      setOpeningNotificationId(null);
    }
  };

  const dropdownContent = (
    <div
      style={{
        width: 360,
        maxHeight: 440,
        overflowY: "auto",
        borderRadius: token.borderRadiusLG,
        backgroundColor: token.colorBgElevated,
        boxShadow: token.boxShadowSecondary,
      }}
    >
      <div
        style={{
          padding: `${token.paddingSM}px ${token.padding}px`,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
          <Text strong style={{ fontSize: token.fontSize }}>
            {translate("notifications.orders.new.title", {}, "Incoming Orders")}
          </Text>
          {unreadCount > 0 && (
            <Button
              type="link"
              size="small"
              onClick={() => void markAllAsRead()}
              style={{ padding: 0, fontSize: token.fontSizeSM, height: "auto" }}
            >
              {translate("notifications.orders.new.markAllAsRead", {}, "Mark all as read")}
            </Button>
          )}
        </div>
        <Text type="secondary" style={{ fontSize: token.fontSizeSM, display: "block", marginTop: 2 }}>
          {translate(
            "notifications.orders.new.description",
            {},
            "Recent orders awaiting your review."
          )}
        </Text>
      </div>

      {loading ? (
        <div style={{ padding: token.paddingLG, textAlign: "center" }}>
          <Spin size="small" />
        </div>
      ) : notifications.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={translate("notifications.orders.new.empty", {}, "No new order notifications")}
          style={{ padding: `${token.paddingLG}px ${token.padding}px` }}
        />
      ) : (
        <List
          dataSource={notifications}
          rowKey="id"
          renderItem={(notification) => {
            const isUnread = notification.readAt === null;
            const customerName = notification.customerName ?? translate(
              "notifications.orders.new.customerUnavailable",
              {},
              "Customer unavailable"
            );
            const isOpening = openingNotificationId === notification.id;
            const displayOrderId = `APT-${notification.orderId.slice(0, 8).toUpperCase()}`;

            return (
              <List.Item style={{ padding: 0 }}>
                <button
                  type="button"
                  aria-label={translate(
                    "notifications.orders.new.open",
                    { orderId: notification.orderId },
                    `Open order ${notification.orderId}`
                  )}
                  onClick={() => void handleOpenNotification(notification)}
                  disabled={isOpening}
                  style={{
                    width: "100%",
                    border: 0,
                    borderLeft: `3px solid ${isUnread ? token.colorPrimary : "transparent"}`,
                    cursor: isOpening ? "wait" : "pointer",
                    padding: `${token.paddingSM}px ${token.padding}px`,
                    textAlign: "left",
                    backgroundColor: isUnread ? token.colorPrimaryBg : token.colorBgElevated,
                    transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
                  }}
                >
                  <Space direction="vertical" size={4} style={{ width: "100%" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
                      <Text strong style={{ fontSize: token.fontSize }}>
                        {customerName}
                      </Text>
                      <Space size={8} style={{ alignItems: "center" }}>
                        {notification.orderStatus && (
                          <Tag
                            color={getStatusTagColor(notification.orderStatus)}
                            style={{ margin: 0 }}
                          >
                            {translate(`orderStatus.${notification.orderStatus}`, {}, notification.orderStatus)}
                          </Tag>
                        )}
                        {isUnread && <Badge dot color={token.colorPrimary} />}
                      </Space>
                    </div>

                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "2px 6px", fontSize: token.fontSizeSM }}>
                      <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                        #{displayOrderId}
                      </Text>
                      {notification.itemCount !== null && (
                        <>
                          <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>•</Text>
                          <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                            {translate("notifications.orders.new.itemsCount", { count: notification.itemCount }, `${notification.itemCount} Barang`)}
                          </Text>
                        </>
                      )}
                      {notification.totalAmount !== null && (
                        <>
                          <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>•</Text>
                          <Text strong style={{ fontSize: token.fontSizeSM, color: token.colorTextHeading }}>
                            {formatCurrency(notification.totalAmount)}
                          </Text>
                        </>
                      )}
                    </div>

                    <Text type="secondary" style={{ fontSize: token.fontSizeSM - 1, display: "block" }}>
                      {formatCreatedAt(notification.createdAt)}
                    </Text>
                  </Space>
                </button>
              </List.Item>
            );
          }}
        />
      )}
    </div>
  );

  return (
    <Dropdown
      trigger={["click"]}
      placement="bottomRight"
      getPopupContainer={() => document.body}
      menu={{ items: [] }}
      popupRender={() => dropdownContent}
    >
      <Badge count={unreadCount} overflowCount={99} size="small">
        <Button
          type="text"
          icon={<BellOutlined />}
          aria-label={translate(
            "notifications.orders.new.badgeLabel",
            { count: unreadCount },
            `${unreadCount} unread order notifications`
          )}
        />
      </Badge>
    </Dropdown>
  );
};
