import { type CSSProperties, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useShow, useTranslation } from "@refinedev/core";
import { Show } from "@refinedev/antd";
import { Typography, Table, Tag, Form, Select, Input, Button, Card, App, Timeline, Spin, Tooltip, Switch, Alert, Space, Collapse, theme, Row, Col } from "antd";
import type { TableColumnsType } from "antd";
import { SyncOutlined, InfoCircleOutlined, LockOutlined, WarningOutlined } from "@ant-design/icons";
import {
  STATUS_COLORS,
  PAYMENT_COLORS,
  getAvailableOrderTransitions,
  getStatusOptions,
} from "../../constants/orders";
import { getFallbackCourierOption } from "../../constants/couriers";
import { supabaseClient } from "../../providers/supabase-client";
import { getFunctionsErrorMessage } from "../../utils/functions-error";

const { Title, Text } = Typography;

interface OrderItem {
  id: string;
  product_id: string;
  quantity: number;
  price_at_purchase: string | number;
  product_sku_at_purchase?: string | null;
  products?: { name: string } | null;
}

interface OrderRecord {
  id: string;
  user_id: string;
  shipping_address_id?: string | null;
  total_amount: string | number;
  status: string;
  customer_completion_stage?: string | null;
  delivered_at?: string | null;
  complaint_window_expires_at?: string | null;
  customer_completed_at?: string | null;
  customer_completion_source?: string | null;
  payment_status: string;
  shipping_cost?: string | number | null;
  courier_code?: string | null;
  courier_service?: string | null;
  shipping_etd?: string | null;
  waybill_number?: string | null;
  waybill_source?: string | null;
  payment_type?: string | null;
  midtrans_order_id?: string | null;
  midtrans_transaction_id?: string | null;
  biteship_order_id?: string | null;
  biteship_tracking_id?: string | null;
  created_at: string;
  updated_at?: string | null;
  customer?: {
    full_name?: string | null;
    phone_number?: string | null;
    email?: string | null;
  } | null;
  shipping_address?: {
    receiver_name?: string | null;
    phone_number?: string | null;
    street_address?: string | null;
    city?: string | null;
    province?: string | null;
    postal_code?: string | null;
    area_name?: string | null;
    address_note?: string | null;
    country_code?: string | null;
  } | null;
  order_items?: OrderItem[];
}

interface Activity {
  id: string;
  action: string;
  old_status: string | null;
  new_status: string | null;
  actor_type: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface BiteshipExceptionInfo {
  status: string;
  alertType: "warning" | "error" | "info";
  messageKey: string;
}

interface DetailListItem {
  label: string;
  value: ReactNode;
}

// Statuses where the status dropdown is locked (terminal states)
const TERMINAL_STATUSES = ["delivered", "cancelled"];
// Only lock for terminal statuses - shipped can still transition to delivered
const LOCKED_STATUSES = ["delivered", "cancelled"];
const FULFILLMENT_STATUSES_REQUIRING_SETTLEMENT = ["processing", "awaiting_shipment", "shipped", "in_transit", "delivered"];

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

const hasMeaningfulValue = (value: string | null | undefined) => Boolean(value?.trim());

const getMeaningfulValue = (value: string | null | undefined) => {
  const trimmedValue = value?.trim();

  return trimmedValue || "-";
};

const formatBiteshipStatusLabel = (value: string | null | undefined) => {
  if (!value) {
    return "-";
  }

  return value
    .split(/[_-]/g)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
};

export const OrderShow: React.FC = () => {
  const { translate } = useTranslation();
  const { token } = theme.useToken();
  // Order reads already resolve through the `orders` -> `order_read_model`
  // mapping in the data provider. That provider also hydrates `order_items`
  // separately, so this page intentionally avoids a nested select here.
  const { result: record, query } = useShow<OrderRecord>();
  const { isLoading } = query;
  const orderLoadError = query.error;

  const { modal } = App.useApp();
  const [form] = Form.useForm<{ status: string; waybill_number?: string; waybill_override_reason?: string }>();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loadingActivities, setLoadingActivities] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [manualWaybillMode, setManualWaybillMode] = useState(false);

  const items = record?.order_items ?? [];
  const hasBiteship = !!record?.biteship_order_id;
  const hasProviderManagedShipment =
    hasBiteship || !!record?.biteship_tracking_id || record?.waybill_source === "system";
  const currentStatus = record?.status ?? "";
  const isPaymentSettled = record?.payment_status === "settlement";
  const isTerminalStatus = TERMINAL_STATUSES.includes(currentStatus);
  const canSyncTracking = hasBiteship && !isTerminalStatus && isPaymentSettled;
  const showTrackingPaymentGuard = hasBiteship && !isTerminalStatus && !isPaymentSettled;

  // Status dropdown lock: only lock for terminal statuses (delivered, cancelled)
  // shipped CAN still transition to delivered, so don't lock it
  const isStatusDropdownLocked = LOCKED_STATUSES.includes(currentStatus);

  // Save button: disabled only for terminal statuses
  const isFormDisabled = isTerminalStatus;

  // Waybill fully locked after shipped/delivered — no override possible
  const isWaybillFullyLocked = ["shipped", "delivered"].includes(currentStatus);

  const isWaybillAutoGenerated = hasProviderManagedShipment && !!record?.waybill_number;
  const showManualWaybillToggle = hasProviderManagedShipment && !isWaybillFullyLocked;
  const showManualWaybillField = !hasProviderManagedShipment || manualWaybillMode;
  const isWaybillInputDisabled = isWaybillFullyLocked;
  const showOverrideReason = manualWaybillMode && hasBiteship && !isWaybillFullyLocked;
  const requiresManualWaybillForSelectedStatus = (status: string) =>
    status === "shipped" && (!hasProviderManagedShipment || manualWaybillMode);

  const latestSyncActivity = activities.find((activity) => activity.action === "sync_tracking");

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

  const loadActivities = useCallback(async () => {
    if (!record?.id) return;
    setLoadingActivities(true);
    setActivityError(null);
    try {
      const { data, error } = await supabaseClient
        .from("order_activities")
        .select("*")
        .eq("order_id", record.id)
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
  }, [record?.id, translate]);

  useEffect(() => {
    if (record?.id) {
      loadActivities();
    }
  }, [record?.id, loadActivities]);

  const refreshOrderState = useCallback(async () => {
    await query.refetch();
    await loadActivities();
  }, [loadActivities, query]);

  const invokeOrderManager = async (values: {
    action: "transition_status" | "sync_tracking";
    orderId: string;
    payload?: Record<string, unknown>;
  }) => {
    const { data, error } = await supabaseClient.functions.invoke("order-manager", {
      body: values,
    });
    if (error) {
      const msg = await getFunctionsErrorMessage(error, "Order manager request failed");
      throw new Error(msg);
    }
    return data;
  };

  const handleSyncTracking = async () => {
    if (!record?.biteship_order_id || isTerminalStatus) return;
    if (!isPaymentSettled) {
      modal.error({
        title: translate("orders.paymentGuard.syncTitle"),
        content: translate("orders.paymentGuard.syncDescription"),
      });
      return;
    }

    setSyncing(true);
    try {
      const result = await invokeOrderManager({
        action: "sync_tracking",
        orderId: record.id,
      });

      const syncedStatus = typeof result?.data?.status === "string" ? result.data.status : undefined;
      const syncedStatusLabel = syncedStatus
        ? translate(`orderStatus.${syncedStatus}`, {}, formatDisplayLabel(syncedStatus))
        : translate("orders.trackingSynced");

      modal.success({
        title: translate("orders.trackingSynced"),
        content: translate("orders.trackingSyncSuccess", { status: syncedStatusLabel }, `Status updated to ${syncedStatusLabel}`),
      });
      await refreshOrderState();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      modal.error({ title: translate("orders.syncFailed"), content: msg });
    } finally {
      setSyncing(false);
    }
  };

  const doMutate = async (values: { status: string; waybill_number?: string; waybill_override_reason?: string }) => {
    if (!record?.id) return;

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        to: values.status,
        waybill_number: values.waybill_number?.trim() || undefined,
      };

      // If manual waybill mode is on and there's a Biteship order, mark as manual override
      if (manualWaybillMode && hasBiteship && values.waybill_number?.trim()) {
        payload.waybill_source = "manual";
        payload.waybill_override_reason = values.waybill_override_reason?.trim() || undefined;
      } else if (values.waybill_number?.trim() && !hasBiteship) {
        payload.waybill_source = "manual";
      }

      await invokeOrderManager({
        action: "transition_status",
        orderId: record.id,
        payload,
      });

      modal.success({
        title: translate("notifications.success"),
        content: translate("orders.saveSuccess"),
      });
      setManualWaybillMode(false);
      await refreshOrderState();
    } catch (err) {
      const msg = err instanceof Error ? err.message : translate("orders.saveError");
      modal.error({
        title: translate("notifications.error"),
        content: msg,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = (values: { status: string; waybill_number?: string; waybill_override_reason?: string }) => {
    const isBlockedFulfillmentTransition = !isPaymentSettled && FULFILLMENT_STATUSES_REQUIRING_SETTLEMENT.includes(values.status);

    if (isBlockedFulfillmentTransition) {
      modal.error({
        title: translate("orders.paymentGuard.transitionTitle"),
        content: translate("orders.paymentGuard.transitionDescription"),
      });
      return;
    }

    if (values.status === "cancelled") {
      const cancelContentKey = isPaymentSettled ? "orders.cancelContentPaid" : "orders.cancelContentUnpaid";
      modal.confirm({
        title: translate("orders.cancelConfirm"),
        content: translate(cancelContentKey),
        okText: translate("orders.cancelOk"),
        cancelText: translate("orders.cancelButton"),
        okButtonProps: { danger: true },
        onOk: () => doMutate(values),
      });
      return;
    }
    doMutate(values);
  };

  const STATUS_OPTIONS = getStatusOptions(translate);
  const current = record?.status ?? "";
  const allowed = getAvailableOrderTransitions(current, {
    hasProviderManagedShipment,
    allowManualWaybillOverride: manualWaybillMode,
  });
  const paymentSafeAllowed = isPaymentSettled
    ? allowed
    : allowed.filter((status) => !FULFILLMENT_STATUSES_REQUIRING_SETTLEMENT.includes(status));
  const blockedFulfillmentTransitions = allowed.filter(
    (status) => !paymentSafeAllowed.includes(status) && FULFILLMENT_STATUSES_REQUIRING_SETTLEMENT.includes(status),
  );
  const baseOptions = isStatusDropdownLocked
    ? STATUS_OPTIONS.filter((opt) => opt.value === current)
    : STATUS_OPTIONS.filter((opt) => paymentSafeAllowed.includes(String(opt.value)));
  const currentInOptions = baseOptions.some((opt) => opt.value === current);
  const availableStatusOptions = currentInOptions
    ? baseOptions
    : [...baseOptions, { value: current, label: translate(`orderStatus.${current}`, {}, formatDisplayLabel(current)) }];
  const hasRealNextStatusTransition = availableStatusOptions.some(
    (option) => option.value !== current,
  );
  const isSaveDisabled = isFormDisabled || !hasRealNextStatusTransition;
  const hasPaymentGuardedFulfillment = blockedFulfillmentTransitions.length > 0;
  const hasSyncOnlyProviderManagedTransition = hasProviderManagedShipment
    && isPaymentSettled
    && !isStatusDropdownLocked
    && !hasRealNextStatusTransition
    && canSyncTracking;
  const actionGuideDescription = isStatusDropdownLocked
    ? translate("orders.actionGuide.lockedDescription")
    : hasSyncOnlyProviderManagedTransition
      ? translate("orders.actionGuide.syncOnlyDescription")
      : isPaymentSettled
        ? translate("orders.actionGuide.settledDescription")
        : translate("orders.actionGuide.unsettledDescription");

  useEffect(() => {
    if (record) {
      form.setFieldsValue({ status: record.status ?? "pending", waybill_number: record.waybill_number ?? "" });
    }
  }, [record, form]);

  const getActivityIcon = (action: string) => {
    switch (action) {
      case "payment_success": return <Tag color="green" aria-hidden="true">$</Tag>;
      case "payment_updated": return <Tag color="orange" aria-hidden="true">$</Tag>;
      case "status_update": return <Tag color="blue" aria-hidden="true">↻</Tag>;
      case "sync_tracking": return <Tag color="cyan" aria-hidden="true">⟳</Tag>;
      case "shipping_created": return <Tag color="purple" aria-hidden="true">📦</Tag>;
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

  const paymentTypeLabel = record?.payment_type
    ? translate(`orders.paymentTypes.${record.payment_type}`, {}, formatDisplayLabel(record.payment_type))
    : "-";
  const courierLabel = record?.courier_code ? getFallbackCourierOption(record.courier_code).label : "-";
  const courierServiceLabel = record?.courier_service ? formatDisplayLabel(record.courier_service) : null;
  const courierDescription = record?.courier_code
    ? `${courierLabel}${courierServiceLabel ? ` • ${courierServiceLabel}` : ""}${record.shipping_etd ? ` (${record.shipping_etd})` : ""}`
    : "-";
  const currentOrderStatusLabel = record?.status
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
      if (value == null) {
        return "-";
      }

      const amount = Number(value);

      return Number.isFinite(amount) ? currencyFormatter.format(amount) : "-";
    },
    [currencyFormatter],
  );
  const formatAdminDate = useCallback((value: string | null | undefined) => {
    if (!value) {
      return "-";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return value;
    }

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

  const productTableLabel = translate("orders.tables.productItemsAriaLabel");
  const columns = useMemo<TableColumnsType<OrderItem>>(() => [
    { title: translate("orders.fields.product"), dataIndex: ["products", "name"], key: "product", render: (_: unknown, row: OrderItem) => row.products?.name ?? "-" },
    { title: translate("orders.fields.sku"), dataIndex: "product_sku_at_purchase", key: "sku", responsive: ["sm"], render: (v: string | null | undefined) => formatSkuSnapshot(v) },
    { title: translate("orders.fields.quantity"), dataIndex: "quantity", key: "quantity", width: 80 },
    { title: translate("orders.fields.unitPrice"), dataIndex: "price_at_purchase", key: "price", responsive: ["md"], render: (v: string | number) => formatCurrency(v) },
    { title: translate("orders.fields.subtotal"), key: "subtotal", responsive: ["sm"], render: (_: unknown, row: OrderItem) => formatCurrency(Number(row.price_at_purchase || 0) * (row.quantity || 0)) },
  ], [formatCurrency, formatSkuSnapshot, translate]);

  const sectionSpacing = token.marginLG;
  const detailGridStyle: CSSProperties = {
    display: "grid",
    gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${token.screenMD}px), 1fr))`,
    gap: sectionSpacing,
    alignItems: "start",
  };
  const pageStackStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: sectionSpacing,
  };
  const compactCardBodyStyle: CSSProperties = {
    paddingBlock: token.paddingSM,
    paddingInline: token.paddingLG,
  };
  const sectionTitleStyle: CSSProperties = { marginTop: 0 };
  const statusSummaryGridStyle: CSSProperties = {
    display: "grid",
    gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${token.screenMD / 3}px), 1fr))`,
    gap: token.marginMD,
  };
  const detailListStyle: CSSProperties = {
    display: "grid",
    gap: token.marginMD,
  };
  const detailRowStyle: CSSProperties = {
    display: "grid",
    gap: token.marginXXS,
    minWidth: 0,
    maxWidth: "100%",
  };
  const detailLabelStyle: CSSProperties = {
    color: token.colorTextTertiary,
    fontSize: token.fontSizeSM,
    lineHeight: token.lineHeightSM,
  };
  const detailValueStyle: CSSProperties = {
    minWidth: 0,
    maxWidth: "100%",
    overflowWrap: "break-word",
    wordBreak: "normal",
  };
  const copyableValueStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    maxWidth: "100%",
    minWidth: 0,
    paddingBlock: token.paddingXXS,
    overflowWrap: "break-word",
    wordBreak: "normal",
    whiteSpace: "normal",
  };
  const waybillValueStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: token.marginXS,
    maxWidth: "100%",
    minWidth: 0,
  };

  const renderCopyableText = (value: string | null | undefined, strong = false) => {
    const displayValue = getMeaningfulValue(value);

    return (
      <Text strong={strong} copyable={hasMeaningfulValue(value) ? true : undefined} style={copyableValueStyle}>
        {displayValue}
      </Text>
    );
  };

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

  const waybillNumber = record?.waybill_number?.trim() ?? "";
  const shipmentMarker = waybillNumber
    ? (
        <Space wrap style={waybillValueStyle}>
          {renderCopyableText(waybillNumber, true)}
          {getWaybillSourceBadge()}
        </Space>
      )
    : <Text type="secondary">{translate("orders.waybillUnavailable")}</Text>;

  const statusSummaryDetails: DetailListItem[] = [
    {
      label: translate("orders.fields.id"),
      value: renderCopyableText(record?.id, true),
    },
    {
      label: translate("orders.currentOrderStatus"),
      value: (
        <Space size={token.marginXS} wrap>
          <Tag color={STATUS_COLORS[record?.status ?? ""] ?? "default"}>{currentOrderStatusLabel}</Tag>
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
      value: <Tag color={PAYMENT_COLORS[record?.payment_status ?? ""] ?? "default"}>{currentPaymentStatusLabel}</Tag>,
    },
    {
      label: translate("orders.customerCompletionStage"),
      value: <Tag color={record?.customer_completion_stage === "completed" ? "green" : "gold"}>{customerCompletionStageLabel}</Tag>,
    },
    {
      label: translate("orders.fields.date"),
      value: <Text>{formatAdminDate(record?.created_at)}</Text>,
    },
  ];

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
    { label: translate("orders.fields.productSubtotal"), value: <Text strong>{formatCurrency(record?.total_amount)}</Text> },
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

  return (
    <Show isLoading={isLoading}>
      <div style={pageStackStyle}>
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
        <Row gutter={[24, 24]}>
          <Col xs={24} lg={16}>
            <div style={pageStackStyle}>
              <Card title={<Title level={5} style={sectionTitleStyle}>{translate("orders.productList")}</Title>}>
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
              </Card>

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

              <Card title={<Title level={5} style={sectionTitleStyle}>{translate("orders.activityTitle")}</Title>} styles={{ body: compactCardBodyStyle }}>
                {activityError ? (
                  <Alert
                    type="error"
                    showIcon
                    message={translate("orders.activity.loadErrorTitle")}
                    description={activityError}
                    action={<Button size="small" onClick={loadActivities}>{translate("buttons.retry", {}, "Coba lagi")}</Button>}
                  />
                ) : loadingActivities ? (
                  <div role="status" aria-live="polite">
                    <Space>
                      <Spin size="small" />
                      <Text type="secondary">{translate("orders.activity.loading", {}, "Memuat aktivitas pesanan...")}</Text>
                    </Space>
                  </div>
                ) : activities.length === 0 ? <Text type="secondary">{translate("orders.noActivities")}</Text> : (
                  <Timeline items={activities.map((activity) => ({ dot: getActivityIcon(activity.action), children: <div><div>{getActivityText(activity)}</div><Text type="secondary" style={{ fontSize: token.fontSizeSM }}>{formatAdminDate(activity.created_at)}</Text></div> }))} />
                )}
              </Card>
            </div>
          </Col>

          <Col xs={24} lg={8}>
            <div style={pageStackStyle}>
              <Card title={<Title level={5} style={sectionTitleStyle}>{translate("orders.orderInfo")}</Title>}>
                <div style={statusSummaryGridStyle}>
                  {statusSummaryDetails.map((detail) => (
                    <div key={detail.label} style={detailRowStyle}>
                      <Text type="secondary" style={detailLabelStyle}>{detail.label}</Text>
                      <div style={detailValueStyle}>{detail.value}</div>
                    </div>
                  ))}
                </div>
              </Card>

              <Card
                title={
                  <span>
                    {translate("orders.actionsTitle")}
                    {isStatusDropdownLocked && (
                      <Tooltip title={translate("orders.tooltips.webhookControlled")}>
                        <InfoCircleOutlined aria-label={translate("orders.accessibility.webhookControlled")} style={{ marginLeft: token.marginXS, color: token.colorWarning }} />
                      </Tooltip>
                    )}
                  </span>
                }
              >
                <Text type="secondary">{translate("orders.actionsDescription")}</Text>

                {hasPaymentGuardedFulfillment && (
                  <Alert
                    style={{ marginTop: token.marginMD }}
                    type="warning"
                    showIcon
                    message={translate("orders.paymentGuard.transitionTitle")}
                    description={translate("orders.paymentGuard.transitionDescription")}
                  />
                )}

                {showTrackingPaymentGuard && (
                  <Alert
                    style={{ marginTop: token.marginMD }}
                    type="warning"
                    showIcon
                    message={translate("orders.paymentGuard.syncTitle")}
                    description={translate("orders.paymentGuard.syncDescription")}
                  />
                )}

                {canSyncTracking && (
                  <div style={{ marginTop: token.marginMD }}>
                    <Button type="default" icon={<SyncOutlined spin={syncing} />} onClick={handleSyncTracking} loading={syncing}>
                      {translate("orders.syncTracking")}
                    </Button>
                  </div>
                )}

                {hasProviderManagedShipment && !manualWaybillMode && !isWaybillFullyLocked && (
                  <Alert
                    style={{ marginTop: token.marginMD, marginBottom: token.marginMD }}
                    type="info"
                    showIcon
                    message={translate("orders.providerManagedWaybillHelp")}
                  />
                )}

              <Form form={form} layout="vertical" onFinish={handleUpdate} initialValues={{ status: record?.status ?? "pending", waybill_number: record?.waybill_number ?? "" }}>
                <Form.Item
                  name="status"
                  label={translate("orders.nextOrderStatus")}
                  rules={[{ required: true }]}
                  tooltip={isStatusDropdownLocked ? translate("orders.tooltips.statusSystemControlled") : undefined}
                >
                  <Select options={availableStatusOptions} style={{ minWidth: 160 }} disabled={isStatusDropdownLocked || isSaveDisabled} />
                </Form.Item>

                {showManualWaybillToggle && (
                  <Form.Item label={translate("orders.enableManualWaybill")}>
                    <Switch
                      size="small"
                      checked={manualWaybillMode}
                      onChange={setManualWaybillMode}
                      checkedChildren={translate("orders.waybillModeManual")}
                      unCheckedChildren={translate("orders.waybillModeAuto")}
                    />
                  </Form.Item>
                )}

                {showManualWaybillField && (
                  <Form.Item
                    name="waybill_number"
                    label={translate("orders.fields.waybillNumber")}
                    tooltip={isWaybillFullyLocked
                      ? translate("orders.tooltips.waybillLocked")
                      : isWaybillAutoGenerated
                        ? translate("orders.tooltips.waybillAuto")
                        : translate("orders.tooltips.waybillManual")}
                    dependencies={["status"]}
                    rules={[
                      ({ getFieldValue }) => ({
                        validator(_, value) {
                          if (!requiresManualWaybillForSelectedStatus(String(getFieldValue("status") ?? ""))) {
                            return Promise.resolve();
                          }
                          if (String(value ?? "").trim()) return Promise.resolve();
                          const shippedStatusLabel = translate("orderStatus.shipped", {}, formatDisplayLabel("shipped"));
                          return Promise.reject(new Error(translate("orders.waybillRequired", { status: shippedStatusLabel })));
                        },
                      }),
                    ]}
                  >
                    <Input
                      placeholder={translate("orders.waybillPlaceholder")}
                      disabled={isWaybillInputDisabled || isSaveDisabled}
                      suffix={isWaybillFullyLocked ? <LockOutlined aria-label={translate("orders.accessibility.waybillLocked")} style={{ color: token.colorTextTertiary }} /> : undefined}
                    />
                  </Form.Item>
                )}

                {showOverrideReason && (
                  <>
                    <Alert
                      message={translate("orders.manualWaybillWarning")}
                      type="warning"
                      showIcon
                      icon={<WarningOutlined />}
                      style={{ marginBottom: token.marginMD }}
                    />
                    <Form.Item
                      name="waybill_override_reason"
                      label={translate("orders.waybillOverrideReason")}
                      rules={[{ required: true, message: translate("orders.waybillOverridePlaceholder") }]}
                    >
                      <Input.TextArea
                        placeholder={translate("orders.waybillOverridePlaceholder")}
                        rows={2}
                      />
                    </Form.Item>
                  </>
                )}

                <Form.Item>
                  <Button type="primary" htmlType="submit" loading={saving} disabled={isSaveDisabled}>
                    {translate("buttons.save")}
                  </Button>
                </Form.Item>
              </Form>
              </Card>
            </div>
          </Col>
        </Row>
      </div>
    </Show>
  );
};
