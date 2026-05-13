import { type CSSProperties } from "react";
import { useNavigate, useParams } from "react-router";
import { useList, useShow, useTranslation } from "@refinedev/core";
import { Show, DateField } from "@refinedev/antd";
import { Typography, Avatar, Space, Tag, Button, Card, Row, Col, Descriptions, theme, Skeleton, Alert, Empty } from "antd";
import { useBanToggle } from "../../hooks/useBanToggle";
import { MEDIA_BUCKET, resolveStoragePublicUrl } from "../../utils/storage";
import { STATUS_COLORS, PAYMENT_COLORS } from "../../constants/orders";

const { Title, Text } = Typography;

const ROLE_COLORS: Record<string, string> = {
  admin: "red",
  customer: "blue",
};

interface CustomerRecord {
  id: string;
  full_name?: string | null;
  phone_number?: string | null;
  email?: string | null;
  avatar_url?: string | null;
  role?: string | null;
  is_banned?: boolean | null;
  created_at?: string | null;
}

interface RecentCustomerOrder {
  id: string;
  user_id?: string | null;
  status?: string | null;
  payment_status?: string | null;
  created_at?: string | null;
  order_number?: string | null;
  invoice_number?: string | null;
  order_code?: string | null;
  total_amount?: string | number | null;
  grand_total?: string | number | null;
}

type CustomerShowToken = ReturnType<typeof theme.useToken>["token"];
type CustomerShowStyles = ReturnType<typeof createCustomerShowStyles>;
type Translate = (key: string, params?: Record<string, unknown>, fallback?: string) => string;

interface CustomerDetailViewModel {
  avatarAltText: string | undefined;
  avatarSize: number;
  avatarUrl: string | null;
  banTargetName: string | undefined;
  customerInitial: string;
  customerName: string;
  displayEmail: string;
  isCustomerBanned: boolean;
  phoneNumber: string;
  roleColor: string;
  statusLabel: string;
  unavailableLabel: string;
}

interface CustomerProfileCardProps {
  customer: CustomerRecord | undefined;
  fallbackCustomerId: string | undefined;
  model: CustomerDetailViewModel;
  styles: CustomerShowStyles;
  token: CustomerShowToken;
  translate: Translate;
}

interface AccountStatusCardProps {
  customer: CustomerRecord | undefined;
  customerId: string | undefined;
  isPending: boolean;
  model: CustomerDetailViewModel;
  styles: CustomerShowStyles;
  token: CustomerShowToken;
  translate: Translate;
  onBan: (payload: { id: string; full_name?: string }) => void;
  onUnban: (payload: { id: string; full_name?: string }) => void;
}

interface RecentOrdersCardProps {
  hasCustomerId: boolean;
  isError: boolean;
  isLoading: boolean;
  orders: RecentCustomerOrder[];
  styles: CustomerShowStyles;
  token: CustomerShowToken;
  translate: Translate;
  unavailableLabel: string;
  onOpenAllTransactions: () => void;
  onOpenOrderDetail: (orderId: string) => void;
}

interface RecentOrderItemProps {
  order: RecentCustomerOrder;
  styles: CustomerShowStyles;
  token: CustomerShowToken;
  translate: Translate;
  unavailableLabel: string;
  onOpenOrderDetail: (orderId: string) => void;
}

const getDisplayEmail = (email: string | null | undefined, fallback: string) => {
  const trimmedEmail = email?.trim();

  return trimmedEmail || fallback;
};

const formatDisplayLabel = (value: string | null | undefined) => {
  if (!value) {
    return "-";
  }

  return value
    .split(/[_-]/g)
    .filter(Boolean)
    .map((part) => (part.length <= 3 ? part.toUpperCase() : `${part.charAt(0).toUpperCase()}${part.slice(1)}`))
    .join(" ");
};

const currencyFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

const formatCurrency = (value: string | number | null | undefined) => {
  if (value == null) {
    return null;
  }

  const amount = Number(value);

  return Number.isFinite(amount) ? currencyFormatter.format(amount) : null;
};

const getOrderIdentifier = (order: RecentCustomerOrder) => {
  const displayIdentifier = order.order_number ?? order.invoice_number ?? order.order_code;

  return displayIdentifier?.trim() || order.id;
};

const createCardTitle = (title: string) => <Title level={5} style={{ margin: 0 }}>{title}</Title>;

const createCustomerShowStyles = (token: CustomerShowToken) => ({
  pageStack: {
    display: "flex",
    flexDirection: "column",
    gap: token.marginLG,
  } satisfies CSSProperties,
  backRow: {
    display: "flex",
    justifyContent: "flex-start",
  } satisfies CSSProperties,
  cardFill: {
    height: "100%",
  } satisfies CSSProperties,
  profileHeader: {
    alignItems: "center",
    display: "flex",
    gap: token.marginMD,
    marginBottom: token.marginLG,
  } satisfies CSSProperties,
  profileName: {
    margin: 0,
  } satisfies CSSProperties,
  profileMeta: {
    margin: 0,
  } satisfies CSSProperties,
  statusStack: {
    width: "100%",
  } satisfies CSSProperties,
  statusBlock: {
    background: token.colorFillAlter,
    border: `${token.lineWidth}px solid ${token.colorBorderSecondary}`,
    borderRadius: token.borderRadiusLG,
    padding: token.paddingMD,
  } satisfies CSSProperties,
  recentOrdersHeader: {
    alignItems: "center",
    display: "flex",
    gap: token.marginSM,
    justifyContent: "flex-end",
    marginBottom: token.marginMD,
  } satisfies CSSProperties,
  recentOrdersStack: {
    width: "100%",
  } satisfies CSSProperties,
  recentOrderRow: {
    alignItems: "flex-start",
    background: token.colorFillQuaternary,
    border: `${token.lineWidth}px solid ${token.colorBorderSecondary}`,
    borderRadius: token.borderRadiusLG,
    display: "flex",
    flexWrap: "wrap",
    gap: token.marginMD,
    justifyContent: "space-between",
    padding: `${token.paddingSM}px ${token.paddingMD}px`,
  } satisfies CSSProperties,
  recentOrderMeta: {
    flex: "1 1 240px",
    minWidth: 0,
  } satisfies CSSProperties,
  recentOrderStatus: {
    flexWrap: "wrap",
  } satisfies CSSProperties,
  recentOrderAction: {
    alignItems: "flex-end",
    display: "flex",
    flexDirection: "column",
    flex: "0 1 160px",
    gap: token.marginXS,
    minWidth: 0,
  } satisfies CSSProperties,
  recentOrderActionButton: {
    maxWidth: "100%",
    whiteSpace: "normal",
  } satisfies CSSProperties,
  recentOrdersState: {
    background: token.colorFillQuaternary,
    border: `${token.lineWidth}px solid ${token.colorBorderSecondary}`,
    borderRadius: token.borderRadiusLG,
    padding: token.paddingLG,
  } satisfies CSSProperties,
});

const createCustomerDetailViewModel = ({
  avatarUrl,
  customer,
  token,
  translate,
}: {
  avatarUrl: string | null;
  customer: CustomerRecord | undefined;
  token: CustomerShowToken;
  translate: Translate;
}): CustomerDetailViewModel => {
  const unavailableLabel = translate("customers.detail.unavailable");
  const unknownLabel = translate("customers.detail.unknown");
  const emailFallback = translate("customers.emailFallback", {}, unavailableLabel);
  const customerName = customer?.full_name?.trim() || unknownLabel;
  const avatarAltText = avatarUrl
    ? translate("customers.detail.avatarAlt", { name: customerName })
    : undefined;
  const isCustomerBanned = Boolean(customer?.is_banned);

  return {
    avatarAltText,
    avatarSize: token.controlHeightLG * 2,
    avatarUrl,
    banTargetName: customer?.full_name ?? undefined,
    customerInitial: customerName.charAt(0).toUpperCase(),
    customerName,
    displayEmail: getDisplayEmail(customer?.email, emailFallback),
    isCustomerBanned,
    phoneNumber: customer?.phone_number?.trim() || unavailableLabel,
    roleColor: customer?.role ? ROLE_COLORS[customer.role] ?? "default" : "default",
    statusLabel: isCustomerBanned ? translate("customers.detail.banned") : translate("customers.detail.active"),
    unavailableLabel,
  };
};

const CustomerProfileCard: React.FC<CustomerProfileCardProps> = ({
  customer,
  fallbackCustomerId,
  model,
  styles,
  token,
  translate,
}) => (
  <Card title={createCardTitle(translate("customers.detail.profileInfo"))} style={styles.cardFill}>
    <div style={styles.profileHeader}>
      <Avatar alt={model.avatarAltText} src={model.avatarUrl ?? undefined} size={model.avatarSize}>
        {model.customerInitial}
      </Avatar>
      <Space direction="vertical" size={token.marginXXS}>
        <Title level={4} style={styles.profileName}>{model.customerName}</Title>
        <Text type="secondary" style={styles.profileMeta}>{model.displayEmail}</Text>
      </Space>
    </div>

    <Descriptions column={{ xs: 1, sm: 2 }} bordered size="middle">
      <Descriptions.Item label={translate("customers.fields.fullName")}>
        {model.customerName}
      </Descriptions.Item>
      <Descriptions.Item label={translate("customers.detail.email")}>
        {model.displayEmail}
      </Descriptions.Item>
      <Descriptions.Item label={translate("customers.detail.phone")}>
        {model.phoneNumber}
      </Descriptions.Item>
      <Descriptions.Item label={translate("customers.detail.joinedDate")}>
        {customer?.created_at ? <DateField value={customer.created_at} format="LLL" /> : model.unavailableLabel}
      </Descriptions.Item>
      <Descriptions.Item label={translate("customers.detail.customerId")}>
        <Text code>{customer?.id ?? fallbackCustomerId ?? model.unavailableLabel}</Text>
      </Descriptions.Item>
      <Descriptions.Item label={translate("customers.fields.role")}>
        <Tag color={model.roleColor}>{customer?.role ?? model.unavailableLabel}</Tag>
      </Descriptions.Item>
    </Descriptions>
  </Card>
);

const AccountStatusCard: React.FC<AccountStatusCardProps> = ({
  customer,
  customerId,
  isPending,
  model,
  styles,
  token,
  translate,
  onBan,
  onUnban,
}) => (
  <Card title={createCardTitle(translate("customers.detail.accountStatus"))} style={styles.cardFill}>
    <Space direction="vertical" size={token.marginMD} style={styles.statusStack}>
      <div style={styles.statusBlock}>
        <Space direction="vertical" size={token.marginXS}>
          <Text type="secondary">{translate("customers.fields.status")}</Text>
          <Tag color={model.isCustomerBanned ? "red" : "green"}>{model.statusLabel}</Tag>
        </Space>
      </div>

      {customer?.role === "customer" && customerId &&
        (model.isCustomerBanned ? (
          <Button
            type="primary"
            block
            loading={isPending}
            onClick={() => onUnban({ id: customerId, full_name: model.banTargetName })}
          >
            {translate("customers.detail.unblockAccount")}
          </Button>
        ) : (
          <Button
            danger
            block
            loading={isPending}
            onClick={() => onBan({ id: customerId, full_name: model.banTargetName })}
          >
            {translate("customers.detail.blockAccount")}
          </Button>
        ))}
    </Space>
  </Card>
);

const RecentOrderItem: React.FC<RecentOrderItemProps> = ({
  order,
  styles,
  token,
  translate,
  unavailableLabel,
  onOpenOrderDetail,
}) => {
  const orderStatusLabel = order.status
    ? translate(`orderStatus.${order.status}`, {}, formatDisplayLabel(order.status))
    : "-";
  const paymentStatusLabel = order.payment_status
    ? translate(`paymentStatus.${order.payment_status}`, {}, formatDisplayLabel(order.payment_status))
    : "-";
  const orderTotal = formatCurrency(order.grand_total ?? order.total_amount);

  return (
    <div style={styles.recentOrderRow}>
      <Space direction="vertical" size={token.marginXXS} style={styles.recentOrderMeta}>
        <Text strong ellipsis>{getOrderIdentifier(order)}</Text>
        <Text type="secondary">
          {order.created_at ? <DateField value={order.created_at} format="LLL" /> : unavailableLabel}
        </Text>
        <Space size={token.marginXS} style={styles.recentOrderStatus}>
          <Tag color={STATUS_COLORS[order.status ?? ""] ?? "default"}>{orderStatusLabel}</Tag>
          <Tag color={PAYMENT_COLORS[order.payment_status ?? ""] ?? "default"}>{paymentStatusLabel}</Tag>
        </Space>
      </Space>

      <div style={styles.recentOrderAction}>
        {orderTotal ? <Text strong>{orderTotal}</Text> : null}
        <Button style={styles.recentOrderActionButton} onClick={() => onOpenOrderDetail(order.id)}>
          {translate("customers.detail.viewOrder")}
        </Button>
      </div>
    </div>
  );
};

const RecentOrdersCard: React.FC<RecentOrdersCardProps> = ({
  hasCustomerId,
  isError,
  isLoading,
  orders,
  styles,
  token,
  translate,
  unavailableLabel,
  onOpenAllTransactions,
  onOpenOrderDetail,
}) => {
  const recentOrdersToRender = orders.slice(0, 5);

  return (
    <Card title={createCardTitle(translate("customers.detail.recentOrders"))}>
      <div style={styles.recentOrdersHeader}>
        <Button disabled={!hasCustomerId} onClick={onOpenAllTransactions}>
          {translate("customers.detail.viewAllTransactions")}
        </Button>
      </div>

      {isLoading ? (
        <div aria-busy="true" aria-live="polite" role="status" style={styles.recentOrdersState}>
          <Skeleton active paragraph={{ rows: 3 }} title={false} />
          <Text type="secondary">{translate("customers.detail.orders.loading")}</Text>
        </div>
      ) : isError ? (
        <Alert
          showIcon
          type="warning"
          message={translate("customers.detail.orders.error")}
          style={styles.recentOrdersState}
        />
      ) : recentOrdersToRender.length === 0 ? (
        <div style={styles.recentOrdersState}>
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={(
              <Space direction="vertical" size={token.marginXXS}>
                <Text strong>{translate("customers.detail.orders.empty.title")}</Text>
                <Text type="secondary">{translate("customers.detail.orders.empty.description")}</Text>
              </Space>
            )}
          />
        </div>
      ) : (
        <Space
          direction="vertical"
          size={token.marginSM}
          style={styles.recentOrdersStack}
          data-recent-orders-count={recentOrdersToRender.length}
        >
          {recentOrdersToRender.map((order) => (
            <RecentOrderItem
              key={order.id}
              order={order}
              styles={styles}
              token={token}
              translate={translate}
              unavailableLabel={unavailableLabel}
              onOpenOrderDetail={onOpenOrderDetail}
            />
          ))}
        </Space>
      )}
    </Card>
  );
};

export const CustomerShow: React.FC = () => {
  const { translate } = useTranslation();
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const hasCustomerId = Boolean(id);
  const { handleBan, handleUnban, isPending } = useBanToggle();
  const {
    result: record,
    query: { isLoading },
  } = useShow<CustomerRecord>({
    resource: "profiles",
    id: id ?? "",
  });
  const {
    result: recentOrdersResult,
    query: recentOrdersQuery,
  } = useList<RecentCustomerOrder>({
    resource: "orders",
    pagination: { currentPage: 1, pageSize: 5 },
    sorters: [{ field: "created_at", order: "desc" }],
    filters: hasCustomerId
      ? [{ field: "user_id", operator: "eq", value: id }]
      : undefined,
    queryOptions: { enabled: hasCustomerId },
  });
  const avatarUrl = resolveStoragePublicUrl(record?.avatar_url ?? null, MEDIA_BUCKET);
  const styles = createCustomerShowStyles(token);
  const customerModel = createCustomerDetailViewModel({
    avatarUrl,
    customer: record,
    token,
    translate,
  });
  const recentOrders = recentOrdersResult?.data ?? [];
  const isRecentOrdersLoading = recentOrdersQuery.isLoading;
  const isRecentOrdersError = recentOrdersQuery.isError;
  const openAllCustomerTransactions = () => {
    if (!id) {
      return;
    }

    const searchParams = new URLSearchParams();

    searchParams.set("currentPage", "1");
    searchParams.set("filters[0][field]", "user_id");
    searchParams.set("filters[0][operator]", "eq");
    searchParams.set("filters[0][value]", id);

    navigate(`/orders?${searchParams.toString()}`);
  };
  const navigateBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }

    navigate("/customers");
  };
  const openOrderDetail = (orderId: string) => {
    navigate(`/orders/show/${orderId}`);
  };

  return (
    <Show isLoading={isLoading}>
      <div style={styles.pageStack}>
        <div style={styles.backRow}>
          <Button onClick={navigateBack}>{translate("customers.detail.back")}</Button>
        </div>

        <Row gutter={[24, 24]} align="stretch">
          <Col xs={24} lg={16}>
            <CustomerProfileCard
              customer={record}
              fallbackCustomerId={id}
              model={customerModel}
              styles={styles}
              token={token}
              translate={translate}
            />
          </Col>

          <Col xs={24} lg={8}>
            <AccountStatusCard
              customer={record}
              customerId={id}
              isPending={isPending}
              model={customerModel}
              styles={styles}
              token={token}
              translate={translate}
              onBan={handleBan}
              onUnban={handleUnban}
            />
          </Col>

          <Col xs={24}>
            <RecentOrdersCard
              hasCustomerId={hasCustomerId}
              isError={isRecentOrdersError}
              isLoading={isRecentOrdersLoading}
              orders={recentOrders}
              styles={styles}
              token={token}
              translate={translate}
              unavailableLabel={customerModel.unavailableLabel}
              onOpenAllTransactions={openAllCustomerTransactions}
              onOpenOrderDetail={openOrderDetail}
            />
          </Col>
        </Row>
      </div>
    </Show>
  );
};
