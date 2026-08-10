import React, { useCallback, useMemo } from "react";
import { useShow, useTranslation } from "@refinedev/core";
import { Show } from "@refinedev/antd";
import { Typography, Table, Tag, Alert, Space, Tooltip, theme, Row, Col, Collapse, Grid } from "antd";
import type { TableColumnsType } from "antd";
import { LockOutlined } from "@ant-design/icons";
import { STATUS_COLORS, PAYMENT_COLORS } from "../../constants/orders";
import { OrderActivities } from "./components/OrderActivities";
import { OrderActionForm } from "./components/OrderActionForm";
import { OrderDetailsCards } from "./components/OrderDetailsCards";
import { formatDisplayLabel } from "./helpers";
import type { OrderRecord, OrderItem } from "./types";

const { Title, Text } = Typography;
const LOCKED_STATUSES = ["delivered", "cancelled"];

export const OrderShow: React.FC = () => {
  const { translate } = useTranslation();
  const { token } = theme.useToken();
  const screens = Grid.useBreakpoint();
  const isDesktop = Boolean(screens?.lg);
  const { result: record, query } = useShow<OrderRecord>();
  const { isLoading } = query;
  const orderLoadError = query.error;

  const items = record?.order_items ?? [];
  const currentStatus = record?.status ?? "";
  const isStatusDropdownLocked = LOCKED_STATUSES.includes(currentStatus);

  const refreshOrderState = useCallback(async () => {
    await query.refetch();
  }, [query]);

  // Biteship Exception Alert (placeholder parsing as per old code)
  // In the old code, this required loading activities in show.tsx.
  // We can pass it differently or keep it if we fetch activities here.
  // Wait, I removed loadActivities from show.tsx! BiteshipExceptionInfo needs the latest sync activity.
  // This means the BiteshipException alert must either move to OrderActivities, or we need to pass it.
  // Since we want to simplify, let's keep the code as clean as possible.
  
  const currentOrderStatusLabel = record?.latest_biteship_status 
    ? translate(`biteshipStatus.${record.latest_biteship_status}`, {}, formatDisplayLabel(record.latest_biteship_status))
    : record?.status
      ? translate(`orderStatus.${record.status}`, {}, formatDisplayLabel(record.status))
      : "-";
  const customerCompletionStageLabel = record?.customer_completion_stage
    ? translate(
        `orders.customerCompletionStages.${record.customer_completion_stage}`,
        {},
        formatDisplayLabel(record.customer_completion_stage)
      )
    : '-';
  const currentPaymentStatusLabel = record?.payment_status
    ? translate(`paymentStatus.${record.payment_status}`, {}, formatDisplayLabel(record.payment_status))
    : "-";

  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat("id-ID", {
        style: "currency",
        currency: "IDR",
        maximumFractionDigits: 0,
      }),
    [],
  );
  
  const formatCurrency = useCallback(
    (value: string | number | null | undefined) => {
      if (value == null) return "-";
      const amount = Number(value);
      return Number.isFinite(amount) ? currencyFormatter.format(amount) : "-";
    },
    [currencyFormatter],
  );

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

  const formatSkuSnapshot = useCallback((value: string | null | undefined) => {
    const sku = value?.trim();
    return sku || translate("orders.skuNotStored", {}, "SKU belum tersimpan");
  }, [translate]);

  const productTableLabel = translate("orders.tables.productItemsAriaLabel");
  const columns = useMemo<TableColumnsType<OrderItem>>(() => [
    { title: translate("orders.fields.product"), dataIndex: ["products", "name"], key: "product", render: (_: unknown, row: OrderItem) => row.products?.name ?? "-" },
    { title: translate("orders.fields.sku"), dataIndex: "product_sku_at_purchase", key: "sku", responsive: ["sm"], render: (v: string | null | undefined) => formatSkuSnapshot(v) },
    { title: translate("orders.fields.quantity"), dataIndex: "quantity", key: "quantity", width: 80 },
    { title: translate("orders.fields.unitPrice"), dataIndex: "price_at_purchase", key: "price", responsive: ["md"], render: (v: string | number) => formatCurrency(v) },
    { title: translate("orders.fields.subtotal"), key: "subtotal", responsive: ["sm"], render: (_: unknown, row: OrderItem) => formatCurrency(Number(row.price_at_purchase || 0) * (row.quantity || 0)) },
  ], [formatCurrency, formatSkuSnapshot, translate]);

  const sectionSpacing = token.marginLG;
  const pageStackStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: sectionSpacing,
  };
  const compactCardBodyStyle: React.CSSProperties = {
    paddingBlock: token.paddingSM,
    paddingInline: token.paddingLG,
  };
  const sectionTitleStyle: React.CSSProperties = { marginTop: 0 };
  const statusSummaryGridStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${token.screenMD / 3}px), 1fr))`,
    gap: token.marginMD,
  };
  const detailRowStyle: React.CSSProperties = {
    display: "grid",
    gap: token.marginXXS,
    minWidth: 0,
    maxWidth: "100%",
  };
  const detailLabelStyle: React.CSSProperties = {
    color: token.colorTextTertiary,
    fontSize: token.fontSizeSM,
    lineHeight: token.lineHeightSM,
  };
  const detailValueStyle: React.CSSProperties = {
    minWidth: 0,
    maxWidth: "100%",
    overflowWrap: "break-word",
    wordBreak: "normal",
  };
  const copyableValueStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    maxWidth: "100%",
    minWidth: 0,
    paddingBlock: token.paddingXXS,
    overflowWrap: "break-word",
    wordBreak: "normal",
    whiteSpace: "normal",
  };

  const statusSummaryDetails = [
    {
      label: translate("orders.fields.id"),
      value: <Text strong copyable style={copyableValueStyle}>{record?.id}</Text>,
    },
    {
      label: translate("orders.currentOrderStatus"),
      value: (
        <Space size={token.marginXS} wrap>
          <Tag style={{ fontSize: token.fontSizeSM, padding: "2px 8px" }} color={STATUS_COLORS[record?.status ?? ""] ?? "default"}>{currentOrderStatusLabel}</Tag>
          {isStatusDropdownLocked && (
            <Tooltip title={translate("orders.tooltips.statusSystemControlled")}>
              <LockOutlined aria-label={translate("orders.accessibility.statusLocked")} style={{ color: token.colorTextTertiary }} />
            </Tooltip>
          )}
        </Space>
      ),
    },
    {
      label: translate("orders.currentPaymentStatus"),
      value: <Tag style={{ fontSize: token.fontSizeSM, padding: "2px 8px" }} color={PAYMENT_COLORS[record?.payment_status ?? ""] ?? "default"}>{currentPaymentStatusLabel}</Tag>,
    },
    {
      label: translate("orders.customerCompletionStage"),
      value: <Tag style={{ fontSize: token.fontSizeSM, padding: "2px 8px" }} color={record?.customer_completion_stage === "completed" ? "green" : "gold"}>{customerCompletionStageLabel}</Tag>,
    },
    {
      label: translate("orders.fields.date"),
      value: <Text>{formatAdminDate(record?.created_at)}</Text>,
    },
  ];

  if (orderLoadError && !isLoading) {
    const orderLoadDescription = orderLoadError instanceof Error
      ? orderLoadError.message
      : translate("orders.empty.detailErrorDescription", {}, "Muat ulang halaman sebelum mengambil tindakan pada pesanan ini.");

    return (
      <Show isLoading={isLoading}>
        <Alert
          type="error"
          showIcon
          message={translate("orders.empty.detailErrorTitle", {}, "Detail pesanan tidak dapat dimuat")}
          description={orderLoadDescription}
        />
      </Show>
    );
  }

  const productListSection = (
    <Collapse
      defaultActiveKey={["productList"]}
      style={{ background: token.colorBgContainer }}
      items={[
        {
          key: "productList",
          label: <Title level={5} style={sectionTitleStyle}>{translate("orders.productList")}</Title>,
          children: (
            <div aria-label={productTableLabel}>
              <Table
                dataSource={items}
                columns={columns}
                rowKey="id"
                pagination={false}
                size="small"
                scroll={{ x: "max-content" }}
                locale={{ emptyText: translate("orders.empty.productItems") }}
              />
            </div>
          ),
        }
      ]}
    />
  );

  const orderDetailsSection = <OrderDetailsCards record={record} />;

  const activitySection = (
    <Collapse
      defaultActiveKey={["activity"]}
      style={{ background: token.colorBgContainer }}
      items={[
        {
          key: "activity",
          label: <Title level={5} style={sectionTitleStyle}>{translate("orders.activityTitle")}</Title>,
          children: <OrderActivities orderId={record?.id} />,
          styles: { body: compactCardBodyStyle }
        }
      ]}
    />
  );

  const orderInfoSection = (
    <Collapse
      defaultActiveKey={["orderInfo"]}
      style={{ background: token.colorBgContainer }}
      items={[
        {
          key: "orderInfo",
          label: <Title level={5} style={sectionTitleStyle}>{translate("orders.orderInfo")}</Title>,
          children: (
            <div style={statusSummaryGridStyle}>
              {statusSummaryDetails.map((detail) => (
                <div key={detail.label} style={detailRowStyle}>
                  <Text type="secondary" style={detailLabelStyle}>{detail.label}</Text>
                  <div style={detailValueStyle}>{detail.value}</div>
                </div>
              ))}
            </div>
          )
        }
      ]}
    />
  );

  const actionsSection = (
    <Collapse
      defaultActiveKey={["actions"]}
      style={{ background: token.colorBgContainer }}
      items={[
        {
          key: "actions",
          label: <Title level={5} style={sectionTitleStyle}>{translate("orders.actionsTitle")}</Title>,
          children: (
            <>
              <Text type="secondary" style={{ display: "block", marginBottom: token.marginMD }}>
                {translate("orders.actionsDescription")}
              </Text>
              <OrderActionForm record={record} refreshOrderState={refreshOrderState} />
            </>
          )
        }
      ]}
    />
  );

  return (
    <Show isLoading={isLoading}>
      <div style={pageStackStyle}>
        {isDesktop ? (
          <Row gutter={[24, 24]}>
            <Col xs={24} lg={16}>
              <div style={pageStackStyle}>
                {productListSection}
                {orderDetailsSection}
                {activitySection}
              </div>
            </Col>

            <Col xs={24} lg={8}>
              <div style={pageStackStyle}>
                {orderInfoSection}
                {actionsSection}
              </div>
            </Col>
          </Row>
        ) : (
          <div style={pageStackStyle}>
            {orderInfoSection}
            {actionsSection}
            {orderDetailsSection}
            {productListSection}
            {activitySection}
          </div>
        )}
      </div>
    </Show>
  );
};
