import { useGetLocale, useList, useTranslation, useNavigation } from "@refinedev/core";
import { Alert, Button, Card, Col, Row, Space, Spin, Statistic, Table, Tag, Tooltip, Typography, theme, List } from "antd";
import { useMemo, useState } from "react";
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  ShoppingCartOutlined,
  BankOutlined,
  PercentageOutlined,
  WarningOutlined,
  ArrowRightOutlined,
} from "@ant-design/icons";
import { STATUS_COLORS } from "../../constants/orders";
import { buildDashboardKpiViewModel, type DashboardKpiAlert, type DashboardKpiAlertKind } from "./dashboardKpis";
import { MonthlyOperationalTrendCard } from "./MonthlyOperationalTrendCard";
import {
  JAKARTA_TIME_ZONE,
  buildOperationalTrendData,
  getDefaultOperationalTrendRequest,
  isValidBucketStart,
  type MonthlyOperationalTrendData,
  type OperationalMetricRow,
  type OperationalTrendGranularity,
} from "./monthlyOperationalTrends";
import {
  getDashboardPageHeaderStyle,
  getDashboardPrimaryKpiCardStyle,
  getDashboardPrimaryKpiValueStyle,
  getDashboardSecondaryKpiCardStyle,
  getDashboardSecondaryKpiValueStyle,
  visuallyHiddenStyle,
} from "./styles";

const { Text, Title } = Typography;

type DashboardTranslate = ReturnType<typeof useTranslation>["translate"];

interface OperationalAlertLabels {
  description: string;
  message: string;
}

const getOperationalAlertLabels = (
  alert: Pick<DashboardKpiAlert, "kind" | "value">,
  translate: DashboardTranslate,
): OperationalAlertLabels => {
  const alertKind: DashboardKpiAlertKind = alert.kind;

  switch (alertKind) {
    case "metrics-error":
      return {
        message: translate("dashboard.alerts.metricsError.message"),
        description: translate("dashboard.alerts.metricsError.description"),
      };
    case "low-stock-error":
      return {
        message: translate("dashboard.alerts.lowStockError.message"),
        description: translate("dashboard.alerts.lowStockError.description"),
      };
    case "fulfillment-risk":
      return {
        message: translate("dashboard.alerts.fulfillmentRisk.message", { count: alert.value }),
        description: translate("dashboard.alerts.fulfillmentRisk.description", { count: alert.value }),
      };
    case "low-stock-risk":
      return {
        message: translate("dashboard.alerts.lowStockRisk.message", { count: alert.value }),
        description: translate("dashboard.alerts.lowStockRisk.description", { count: alert.value }),
      };
    case "no-risk":
      return {
        message: translate("dashboard.alerts.noRisk.message"),
        description: translate("dashboard.alerts.noRisk.description"),
      };
  }
};

const getDashboardLocale = (language: string | undefined): string => (language?.startsWith("en") ? "en-US" : "id-ID");

const unavailableMetricValue = "-";

const formatDashboardOrderId = (orderId: string): string => {
  if (orderId.length <= 12) {
    return orderId;
  }

  return `${orderId.slice(0, 8)}…${orderId.slice(-4)}`;
};

const emptyMonthlyOperationalTrendData: MonthlyOperationalTrendData = {
  rows: [],
  orderCountChartPoints: [],
  paidOrderCountChartPoints: [],
  completedOrderCountChartPoints: [],
  revenueChartPoints: [],
  totals: {
    orderCount: 0,
    paidOrderCount: 0,
    completedOrderCount: 0,
    revenue: 0,
  },
};

const DASHBOARD_QUERY_STALE_TIME_MS = 60_000;

const hasOperationalMetricRows = (rows: readonly OperationalMetricRow[]): boolean =>
  rows.some((row) => isValidBucketStart(row.bucket_start));

export const Dashboard: React.FC = () => {
  const { translate } = useTranslation();
  const getLocale = useGetLocale();
  const { list: navigateList, show: navigateShow } = useNavigation();
  const { token } = theme.useToken();
  const [trendGranularity, setTrendGranularity] = useState<OperationalTrendGranularity>("day");
  const locale = getDashboardLocale(getLocale());
  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency: "IDR",
        maximumFractionDigits: 0,
      }),
    [locale],
  );
  const decimalFormatter = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        maximumFractionDigits: 1,
      }),
    [locale],
  );
  const dashboardDateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", timeZone: JAKARTA_TIME_ZONE, year: "numeric" }),
    [locale],
  );
  const isDailyTrend = trendGranularity === "day";
  const kpiRequest = useMemo(() => getDefaultOperationalTrendRequest("day"), []);
  const trendRequest = useMemo(() => getDefaultOperationalTrendRequest(trendGranularity), [trendGranularity]);
  const trendGranularityOptions = useMemo(
    () => [
      { label: translate("dashboard.monthlyTrends.granularity.day"), value: "day" as const },
      { label: translate("dashboard.monthlyTrends.granularity.week"), value: "week" as const },
      { label: translate("dashboard.monthlyTrends.granularity.month"), value: "month" as const },
      { label: translate("dashboard.monthlyTrends.granularity.year"), value: "year" as const },
    ],
    [translate],
  );

  // Actionable orders
  const { result: actionableOrdersResult, query: actionableOrdersQuery } = useList({
    resource: "orders",
    pagination: { currentPage: 1, pageSize: 10 },
    sorters: [{ field: "created_at", order: "desc" }],
    filters: [{ field: "status", operator: "in", value: ["processing", "awaiting_shipment"] }],
    queryOptions: { staleTime: DASHBOARD_QUERY_STALE_TIME_MS },
  });

  // Low stock products (stock < 10, active only)
  const { result: lowStockResult, query: lowStockQuery } = useList({
    resource: "products",
    pagination: { currentPage: 1, pageSize: 10 },
    sorters: [{ field: "stock", order: "asc" }],
    filters: [
      { field: "stock", operator: "lt", value: 10 },
      { field: "is_active", operator: "eq", value: true },
    ],
    meta: { count: "exact" },
    queryOptions: { staleTime: DASHBOARD_QUERY_STALE_TIME_MS },
  });

  // Near Expiry products (expiry <= today + 30 days, active only)
  const thirtyDaysFromNow = useMemo(() => {
    const date = new Date();
    date.setDate(date.getDate() + 30);
    return date.toISOString();
  }, []);

  const { result: nearExpiryResult, query: nearExpiryQuery } = useList({
    resource: "products",
    pagination: { currentPage: 1, pageSize: 1 },
    filters: [
      { field: "expiry_date", operator: "nnull", value: null },
      { field: "expiry_date", operator: "lte", value: thirtyDaysFromNow },
      { field: "is_active", operator: "eq", value: true },
    ],
    meta: { count: "exact" },
    queryOptions: { staleTime: DASHBOARD_QUERY_STALE_TIME_MS },
  });

  const { result: kpiMetricsResult, query: kpiMetricsQuery } = useList<OperationalMetricRow>({
    resource: "admin_operational_metrics",
    pagination: { pageSize: kpiRequest.bucketCount },
    filters: [
      { field: "granularity", operator: "eq", value: kpiRequest.granularity },
      { field: "start_date", operator: "eq", value: kpiRequest.startDate },
      { field: "end_date", operator: "eq", value: kpiRequest.endDate },
    ],
    queryOptions: { staleTime: DASHBOARD_QUERY_STALE_TIME_MS },
  });

  const { result: operationalMetricsResult, query: operationalMetricsQuery } = useList<OperationalMetricRow>({
    resource: "admin_operational_metrics",
    pagination: { pageSize: trendRequest.bucketCount },
    filters: [
      { field: "granularity", operator: "eq", value: trendRequest.granularity },
      { field: "start_date", operator: "eq", value: trendRequest.startDate },
      { field: "end_date", operator: "eq", value: trendRequest.endDate },
    ],
    queryOptions: { enabled: !isDailyTrend, staleTime: DASHBOARD_QUERY_STALE_TIME_MS },
  });

  const actionableOrders = (actionableOrdersResult?.data ?? []) as {
    id: string;
    total_amount: string | number;
    status: string;
    created_at: string;
  }[];

  const lowStockProducts = (lowStockResult?.data ?? []) as {
    id: string;
    name: string;
    stock: number;
  }[];

  const nearExpiryCount = nearExpiryResult?.total ?? 0;

  const activeTrendMetricsResult = isDailyTrend ? kpiMetricsResult : operationalMetricsResult;
  const activeTrendMetricsQuery = isDailyTrend ? kpiMetricsQuery : operationalMetricsQuery;
  const operationalMetricRows = activeTrendMetricsResult?.data ?? [];
  const monthlyOperationalTrendData = hasOperationalMetricRows(operationalMetricRows)
    ? buildOperationalTrendData(operationalMetricRows, trendGranularity, locale)
    : emptyMonthlyOperationalTrendData;
  const kpiMetricRows = kpiMetricsResult?.data ?? [];
  const hasKpiMetricsError = Boolean(kpiMetricsQuery?.isError);
  const dashboardKpiTrendData = hasOperationalMetricRows(kpiMetricRows)
    ? buildOperationalTrendData(kpiMetricRows, "day", locale)
    : emptyMonthlyOperationalTrendData;
  const dashboardKpis = buildDashboardKpiViewModel(dashboardKpiTrendData.totals, {
    lowStockErrorCount: lowStockQuery?.isError ? 1 : 0,
    lowStockProductCount: lowStockResult?.total ?? 0,
    metricsErrorCount: Number(hasKpiMetricsError) + (isDailyTrend ? 0 : Number(Boolean(operationalMetricsQuery?.isError))),
  });
  const operationalAlertsLoading = Boolean(
    kpiMetricsQuery?.isLoading || activeTrendMetricsQuery?.isLoading || lowStockQuery?.isLoading,
  );
  const isKpiMetricsLoading = Boolean(kpiMetricsQuery?.isLoading);
  const operationalAlertsSucceeded =
    !operationalAlertsLoading &&
    !kpiMetricsQuery?.isError &&
    !activeTrendMetricsQuery?.isError &&
    !lowStockQuery?.isError;
  const operationalAlerts = dashboardKpis.alerts.filter(
    (alert) => alert.active && (alert.kind !== "no-risk" || operationalAlertsSucceeded) && alert.kind !== "low-stock-risk" && alert.kind !== "low-stock-error",
  );
  const shouldShowOperationalAlertsLoading =
    operationalAlertsLoading && !operationalAlerts.some((alert) => alert.kind !== "no-risk");
  const monthlyOperationalTrendError = activeTrendMetricsQuery?.isError
    ? activeTrendMetricsQuery.error ?? true
    : undefined;
  const pageHeaderStyle = getDashboardPageHeaderStyle(token);
  const primaryKpiCardStyle = getDashboardPrimaryKpiCardStyle(token);
  const secondaryKpiCardStyle = getDashboardSecondaryKpiCardStyle(token);
  const primaryKpiValueStyle = getDashboardPrimaryKpiValueStyle(token);
  const secondaryKpiValueStyle = getDashboardSecondaryKpiValueStyle(token);
  const attentionCardTitle = (
    <Space size={token.marginXS}>
      <WarningOutlined aria-hidden="true" style={{ color: token.colorWarning }} />
      {translate("dashboard.alerts.title")}
    </Space>
  );
  const metricsUnavailableText = translate("dashboard.kpis.unavailable");
  const renderUnavailableMetric = (): string => metricsUnavailableText || unavailableMetricValue;
  const actionableOrdersEmptyText = actionableOrdersQuery?.isError ? (
    <Alert
      type="error"
      showIcon
      message={translate("dashboard.alerts.recentOrdersError.message")}
      description={translate("dashboard.alerts.recentOrdersError.description")}
    />
  ) : translate("dashboard.noRecentOrders");
  const lowStockEmptyText = lowStockQuery?.isError ? (
    <Alert
      type="error"
      showIcon
      message={translate("dashboard.alerts.lowStockError.message")}
      description={translate("dashboard.alerts.lowStockError.description")}
    />
  ) : translate("dashboard.noLowStock");
  const handleMetricsRetry = (): void => {
    const shouldRetryKpiMetrics = Boolean(kpiMetricsQuery?.isError);
    const shouldRetryActiveTrendMetrics = Boolean(activeTrendMetricsQuery?.isError && activeTrendMetricsQuery !== kpiMetricsQuery);

    if (shouldRetryKpiMetrics) {
      kpiMetricsQuery?.refetch?.();
    }

    if (shouldRetryActiveTrendMetrics) {
      activeTrendMetricsQuery?.refetch?.();
    }
  };

  return (
    <>
      <Space direction="vertical" size={token.marginXXS} style={pageHeaderStyle}>
        <Title level={2} style={{ margin: 0 }}>
          {translate("dashboard.overview.title")}
        </Title>
      </Space>

      <Row gutter={[16, 16]} align="stretch" style={{ marginBottom: token.marginLG }}>
        <Col xs={24} xl={12}>
          <Card
            hoverable
            style={{ height: "100%", borderColor: token.colorWarningBorder, borderWidth: 1 }}
            title={attentionCardTitle}
            extra={
              <Tooltip title={translate("dashboard.viewAllOrders")}>
                <Button type="text" shape="circle" icon={<ArrowRightOutlined />} onClick={() => navigateList("orders")} aria-label={translate("dashboard.viewAllOrders")} />
              </Tooltip>
            }
          >
            {Boolean(shouldShowOperationalAlertsLoading || operationalAlerts.length > 0) && (
              <Space direction="vertical" size={token.marginSM} style={{ width: "100%", marginBottom: token.marginMD }}>
                {shouldShowOperationalAlertsLoading ? (
                  <Alert showIcon type="info" message={translate("dashboard.alerts.loading.message")} />
                ) : null}
                {operationalAlerts.map((alert) => {
                  const labels = getOperationalAlertLabels(alert, translate);
                  const retryAction =
                    alert.kind === "metrics-error" ? (
                      <Button size="small" onClick={handleMetricsRetry}>
                        {translate("dashboard.retry")}
                      </Button>
                    ) : undefined;

                  return (
                    <Alert
                      showIcon
                      key={alert.kind}
                      type={alert.severity}
                      message={labels.message}
                      action={retryAction}
                    />
                  );
                })}
              </Space>
            )}

            <Table
              dataSource={actionableOrders}
              rowKey="id"
              pagination={false}
              size="small"
              scroll={{ x: "max-content" }}
              loading={actionableOrdersQuery?.isLoading}
              locale={{ emptyText: actionableOrdersEmptyText }}
              aria-label={translate("dashboard.tables.recentOrdersAriaLabel")}
              onRow={(record) => ({
                onClick: () => navigateShow("orders", record.id),
                style: { cursor: "pointer" },
              })}
            >
              <Table.Column
                dataIndex="id"
                title={translate("dashboard.orderId")}
                width={128}
                render={(value: string) => {
                  const formattedOrderId = formatDashboardOrderId(value);
                  const isTruncated = formattedOrderId !== value;

                  return (
                    <Tooltip title={isTruncated ? value : undefined}>
                      <Text code aria-label={isTruncated ? `${translate("dashboard.fullOrderId")}: ${value}` : undefined} title={isTruncated ? value : undefined}>
                        {formattedOrderId}
                      </Text>
                      {isTruncated ? <span style={visuallyHiddenStyle}>{value}</span> : null}
                    </Tooltip>
                  );
                }}
              />
              <Table.Column
                dataIndex="total_amount"
                title={translate("dashboard.orderTotal")}
                responsive={["sm"]}
                render={(v) => currencyFormatter.format(Number(v ?? 0))}
              />
              <Table.Column
                dataIndex="status"
                title={translate("dashboard.orderStatus")}
                render={(v: string) => (
                  <Tag color={STATUS_COLORS[v] ?? "default"}>{v ? translate(`orderStatus.${v}`) : "-"}</Tag>
                )}
              />
              <Table.Column
                dataIndex="created_at"
                title={translate("dashboard.orderDate")}
                responsive={["md"]}
                render={(v) => (v ? dashboardDateFormatter.format(new Date(v)) : "-")}
              />
            </Table>
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card
            hoverable
            style={{ height: "100%" }}
            title={
              <>
                <WarningOutlined aria-hidden="true" style={{ color: token.colorWarning, marginRight: token.marginXS }} />
                {translate("dashboard.lowStockAlerts")}
              </>
            }
            extra={
              <Tooltip title={translate("dashboard.viewAllProducts")}>
                <Button type="text" shape="circle" icon={<ArrowRightOutlined />} onClick={() => navigateList("products")} aria-label={translate("dashboard.viewAllProducts")} />
              </Tooltip>
            }
          >
            <List
              dataSource={lowStockProducts}
              rowKey="id"
              size="small"
              loading={lowStockQuery?.isLoading}
              locale={{ emptyText: lowStockEmptyText }}
              renderItem={(item) => (
                <List.Item
                  onClick={() => navigateShow("products", item.id)}
                  style={{ 
                    cursor: "pointer", 
                    padding: `${token.paddingSM}px`, 
                    borderRadius: token.borderRadius,
                    transition: "background-color 0.3s ease"
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = token.colorFillAlter; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                  extra={
                    <Tag bordered={false} color={item.stock === 0 ? "error" : "warning"} style={{ marginRight: 0 }}>
                      {item.stock}
                    </Tag>
                  }
                >
                  <Text ellipsis={{ tooltip: item.name }} style={{ maxWidth: '100%', fontSize: token.fontSize }}>
                    {item.name}
                  </Text>
                </List.Item>
              )}
            />
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card
            hoverable
            style={{ height: "100%" }}
            title={
              <>
                <ClockCircleOutlined aria-hidden="true" style={{ color: token.colorWarning, marginRight: token.marginXS }} />
                {translate("dashboard.nearExpiryAlerts")}
              </>
            }
            extra={
              <Tooltip title={translate("dashboard.viewNearExpiry")}>
                <Button type="text" shape="circle" icon={<ArrowRightOutlined />} onClick={() => navigateList("products")} aria-label={translate("dashboard.tables.nearExpiryAriaLabel")} />
              </Tooltip>
            }
          >
            <Space direction="vertical" style={{ width: "100%" }}>
              {nearExpiryQuery?.isLoading ? (
                <Space align="center" style={{ width: "100%", padding: token.padding, justifyContent: "center" }}>
                  <Spin size="small" />
                </Space>
              ) : nearExpiryQuery?.isError ? (
                <Alert type="error" showIcon message={translate("dashboard.alerts.metricsError.message")} />
              ) : nearExpiryCount > 0 ? (
                <Alert
                  type="warning"
                  showIcon
                  message={translate("dashboard.alerts.nearExpiry.message", { count: nearExpiryCount })}
                  description={translate("dashboard.alerts.nearExpiry.description")}
                  action={
                    <Button size="small" onClick={() => navigateList("products")}>
                      {translate("dashboard.viewNearExpiry")}
                    </Button>
                  }
                />
              ) : (
                <Alert
                  type="success"
                  showIcon
                  message={translate("dashboard.noNearExpiry")}
                />
              )}
            </Space>
          </Card>
        </Col>
      </Row>

      <Space direction="vertical" size={token.marginXS} style={{ width: "100%" }}>
        <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} xl={6}>
          <Card style={primaryKpiCardStyle} hoverable>
            <Statistic
              title={translate("dashboard.kpis.revenue30d")}
              value={dashboardKpis.revenue}
              loading={isKpiMetricsLoading}
              prefix={<BankOutlined aria-hidden="true" style={{ color: token.colorSuccess }} />}
              valueStyle={primaryKpiValueStyle}
              formatter={hasKpiMetricsError ? renderUnavailableMetric : (value) => currencyFormatter.format(Number(value ?? 0))}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card style={primaryKpiCardStyle} hoverable>
            <Statistic
              title={translate("dashboard.kpis.orders30d")}
              value={dashboardKpis.orderCount}
              loading={isKpiMetricsLoading}
              prefix={<ShoppingCartOutlined aria-hidden="true" style={{ color: token.colorPrimary }} />}
              valueStyle={primaryKpiValueStyle}
              formatter={hasKpiMetricsError ? renderUnavailableMetric : undefined}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card style={primaryKpiCardStyle} hoverable>
            <Statistic
              title={translate("dashboard.kpis.paymentSuccessRate")}
              value={dashboardKpis.paymentSuccessRate}
              loading={isKpiMetricsLoading}
              prefix={<PercentageOutlined aria-hidden="true" style={{ color: token.colorInfo }} />}
              suffix={hasKpiMetricsError ? undefined : "%"}
              valueStyle={primaryKpiValueStyle}
              formatter={hasKpiMetricsError ? renderUnavailableMetric : (value) => decimalFormatter.format(Number(value ?? 0))}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card style={primaryKpiCardStyle} hoverable>
            <Statistic
              title={translate("dashboard.kpis.averageOrderValue")}
              value={dashboardKpis.averageOrderValue}
              loading={isKpiMetricsLoading}
              prefix={<CheckCircleOutlined aria-hidden="true" style={{ color: token.colorSuccess }} />}
              valueStyle={primaryKpiValueStyle}
              formatter={hasKpiMetricsError ? renderUnavailableMetric : (value) => currencyFormatter.format(Number(value ?? 0))}
            />
          </Card>
        </Col>
        </Row>
      </Space>

      <Row gutter={[16, 16]} style={{ marginTop: token.marginLG }} align="stretch">
        <Col xs={24}>
          <MonthlyOperationalTrendCard
            data={monthlyOperationalTrendData}
            totals={monthlyOperationalTrendData.totals}
            loading={activeTrendMetricsQuery?.isLoading ?? false}
            error={monthlyOperationalTrendError}
            granularity={trendGranularity}
            granularityOptions={trendGranularityOptions}
            onGranularityChange={setTrendGranularity}
            locale={locale}
            labels={{
              title: translate("dashboard.monthlyTrends.title"),
              revenue: translate("dashboard.monthlyTrends.revenue"),
              orderCount: translate("dashboard.monthlyTrends.orderCount"),
              paidOrders: translate("dashboard.monthlyTrends.paidOrders"),
              completedOrders: translate("dashboard.monthlyTrends.completedOrders"),
              periodLabel: translate(`dashboard.monthlyTrends.period.${trendGranularity}`),
              loading: translate("dashboard.monthlyTrends.loading"),
              emptyDescription: translate("dashboard.monthlyTrends.emptyDescription"),
              errorMessage: translate("dashboard.monthlyTrends.errorMessage"),
              zeroValueSummary: translate("dashboard.monthlyTrends.zeroValueSummary"),
              chartAriaLabel: translate("dashboard.monthlyTrends.chartAriaLabel"),
              chartDescription: translate("dashboard.monthlyTrends.chartDescription"),
              revenueTrendTitle: translate("dashboard.monthlyTrends.revenueTrendTitle"),
              revenueTrendAriaLabel: translate("dashboard.monthlyTrends.revenueTrendAriaLabel"),
              revenueTrendDescription: translate("dashboard.monthlyTrends.revenueTrendDescription"),
              retryAction: translate("dashboard.retry"),
              dataTableLabel: translate("dashboard.monthlyTrends.dataTableLabel"),
              periodColumn: translate("dashboard.monthlyTrends.periodColumn"),
              incomingColumn: translate("dashboard.monthlyTrends.incomingColumn"),
              paidColumn: translate("dashboard.monthlyTrends.paidColumn"),
              completedColumn: translate("dashboard.monthlyTrends.completedColumn"),
              revenueColumn: translate("dashboard.monthlyTrends.revenueColumn"),
              granularityAriaLabel: translate("dashboard.monthlyTrends.granularityAriaLabel"),
            }}
          />
        </Col>
      </Row>


    </>
  );
};
