import React, { useMemo, useCallback } from "react";
import { Card, Collapse, Typography, Space, Tag, Tooltip, theme } from "antd";
import { LockOutlined } from "@ant-design/icons";
import { useTranslation } from "@refinedev/core";
import { getFallbackCourierOption } from "../../../constants/couriers";
import { STATUS_COLORS, PAYMENT_COLORS } from "../../../constants/orders";
import { formatDisplayLabel, getMeaningfulValue, hasMeaningfulValue } from "../helpers";
import type { OrderRecord, DetailListItem } from "../types";

const { Text, Title } = Typography;

interface OrderDetailsCardsProps {
  record?: OrderRecord;
}

export const OrderDetailsCards: React.FC<OrderDetailsCardsProps> = ({ record }) => {
  const { translate } = useTranslation();
  const { token } = theme.useToken();
  const hasBiteship = !!record?.biteship_order_id;

  const sectionSpacing = token.marginLG;
  const detailGridStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${token.screenMD}px), 1fr))`,
    gap: sectionSpacing,
    alignItems: "start",
  };
  const sectionTitleStyle: React.CSSProperties = { marginTop: 0 };
  const detailListStyle: React.CSSProperties = {
    display: "grid",
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
  const waybillValueStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: token.marginXS,
    maxWidth: "100%",
    minWidth: 0,
  };

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

  const renderCopyableText = (value: string | null | undefined, strong = false) => (
    <Text strong={strong} copyable={hasMeaningfulValue(value) ? true : undefined} style={copyableValueStyle}>
      {getMeaningfulValue(value)}
    </Text>
  );

  const renderWrappedText = (value: string | null | undefined, strong = false) => (
    <Text strong={strong} style={copyableValueStyle}>
      {getMeaningfulValue(value)}
    </Text>
  );

  const renderDetailList = (details: DetailListItem[]) => (
    <div style={detailListStyle}>
      {details.map((detail) => (
        <div key={detail.label} style={detailRowStyle}>
          <Text type="secondary" style={detailLabelStyle}>{detail.label}</Text>
          <div style={detailValueStyle}>{detail.value}</div>
        </div>
      ))}
    </div>
  );

  const shippingAddressText = [
    record?.shipping_address?.street_address,
    record?.shipping_address?.area_name,
    record?.shipping_address?.city,
    record?.shipping_address?.province,
    record?.shipping_address?.postal_code,
    record?.shipping_address?.country_code,
  ]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(", ");

  const getWaybillSourceBadge = () => {
    if (!record?.waybill_number) return null;
    const source = record.waybill_source;
    if (source === "manual") {
      return <Tag color="orange" style={{ marginLeft: token.marginXS }}>{translate("orders.waybillSourceManual")}</Tag>;
    }
    if (hasBiteship) {
      return <Tag color="blue" style={{ marginLeft: token.marginXS }}>{translate("orders.waybillSourceSystem")}</Tag>;
    }
    return null;
  };

  const waybillNumber = record?.waybill_number?.trim() ?? "";
  const shipmentMarker = waybillNumber
    ? (
        <Space wrap style={waybillValueStyle}>
          {renderCopyableText(waybillNumber, true)}
          {getWaybillSourceBadge()}
        </Space>
      )
    : <Text type="secondary">{translate("orders.waybillUnavailable")}</Text>;

  const courierLabel = record?.courier_code ? getFallbackCourierOption(record.courier_code).label : "-";
  const courierServiceLabel = record?.courier_service ? formatDisplayLabel(record.courier_service) : null;
  const courierDescription = record?.courier_code
    ? `${courierLabel}${courierServiceLabel ? ` • ${courierServiceLabel}` : ""}${record.shipping_etd ? ` (${record.shipping_etd})` : ""}`
    : "-";

  const paymentTypeLabel = record?.payment_type
    ? translate(`orders.paymentTypes.${record.payment_type}`, {}, formatDisplayLabel(record.payment_type))
    : "-";

  const buyerDetails: DetailListItem[] = [
    { label: translate("orders.fields.customerName"), value: renderWrappedText(record?.customer?.full_name) },
    { label: translate("orders.fields.customerEmail"), value: renderWrappedText(record?.customer?.email) },
    { label: translate("orders.fields.customerPhone"), value: renderWrappedText(record?.customer?.phone_number) },
    { label: translate("orders.fields.receiverName"), value: renderWrappedText(record?.shipping_address?.receiver_name) },
    { label: translate("orders.fields.receiverPhone"), value: renderWrappedText(record?.shipping_address?.phone_number) },
    { label: translate("orders.fields.shippingAddress"), value: renderWrappedText(shippingAddressText) },
    { label: translate("orders.fields.addressNote"), value: renderWrappedText(record?.shipping_address?.address_note) },
  ];

  const shipmentAndReferenceDetails: DetailListItem[] = [
    { label: translate("orders.fields.productSubtotal"), value: <Text strong style={{ fontSize: token.fontSizeLG, color: token.colorTextHeading }}>{formatCurrency(record?.total_amount)}</Text> },
    { label: translate("orders.fields.shippingCost"), value: <Text>{formatCurrency(record?.shipping_cost)}</Text> },
    { label: translate("orders.fields.courier"), value: <Text>{courierDescription}</Text> },
    { label: translate("orders.fields.waybillNumber"), value: shipmentMarker },
    { label: translate("orders.fields.paymentType"), value: <Text>{paymentTypeLabel}</Text> },
    { label: translate("orders.fields.updatedAt"), value: <Text>{formatAdminDate(record?.updated_at)}</Text> },
    { label: translate("orders.fields.deliveredAt"), value: <Text>{formatAdminDate(record?.delivered_at)}</Text> },
    { label: translate("orders.fields.complaintWindowExpiresAt"), value: <Text>{formatAdminDate(record?.complaint_window_expires_at)}</Text> },
    { label: translate("orders.fields.customerCompletedAt"), value: <Text>{formatAdminDate(record?.customer_completed_at)}</Text> },
  ];

  const integrationMetadataDetails: DetailListItem[] = [
    { label: translate("orders.fields.midtransOrderId"), value: renderCopyableText(record?.midtrans_order_id) },
    { label: translate("orders.fields.midtransTransactionId"), value: renderCopyableText(record?.midtrans_transaction_id) },
    { label: translate("orders.fields.biteshipOrderId"), value: renderCopyableText(record?.biteship_order_id) },
    { label: translate("orders.fields.biteshipTrackingId"), value: renderCopyableText(record?.biteship_tracking_id) },
  ];

  return (
    <div style={detailGridStyle}>
      <Card title={<Title level={5} style={sectionTitleStyle}>{translate("orders.buyerAndShipping")}</Title>}>
        {renderDetailList(buyerDetails)}
      </Card>
      <Card title={<Title level={5} style={sectionTitleStyle}>{translate("orders.totalAndShipping")}</Title>}>
        {renderDetailList(shipmentAndReferenceDetails)}
        <Collapse
          bordered={false}
          ghost
          items={[
            {
              key: "integration-metadata",
              label: translate("orders.integrationMetadata"),
              children: renderDetailList(integrationMetadataDetails),
            },
          ]}
        />
      </Card>
    </div>
  );
};
