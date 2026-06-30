import { useGetLocale, useList, useTranslation, useNavigation } from "@refinedev/core";
import { Alert, Button, Card, Col, Row, Space, Statistic, Table, Tag, Tooltip, Typography, theme } from "antd";
import { useMemo, useState } from "react";
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  ShoppingCartOutlined,
  BankOutlined,
  PercentageOutlined,
  WarningOutlined,
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
  const { list: navigateList } = useNavigation();
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

  // Recent 5 orders
  const { result: recentOrdersResult, query: recentOrdersQuery } = useList({
    resource: "orders",
    pagination: { currentPage: 1, pageSize: 5 },
    sorters: [{ field: "created_at", order: "desc" }],
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

  const recentOrders = (recentOrdersResult?.data ?? []) as {
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
    (alert) => alert.active && (alert.kind !== "no-risk" || operationalAlertsSucceeded),
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
  const recentOrdersEmptyText = recentOrdersQuery?.isError ? (
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

      <Card title={attentionCardTitle} style={{ marginBottom: token.marginLG }}>
        <Row gutter={[16, 16]} align="stretch">
          <Col xs={24} lg={14}>
            <Space direction="vertical" size={token.marginSM} style={{ width: "100%" }}>
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
          </Col>
          <Col xs={24} lg={10}>
            <Row gutter={[16, 16]} style={{ height: "100%" }} align="stretch">
              <Col xs={24} sm={12} lg={24} xl={24} style={{ display: "flex" }}>
                <Card style={{ ...secondaryKpiCardStyle, flex: 1, width: "100%" }} hoverable>
                  <Statistic
                    title={translate("dashboard.kpis.fulfillmentRisk")}
                    value={dashboardKpis.fulfillmentRisk}
                    loading={isKpiMetricsLoading}
                    prefix={<ClockCircleOutlined aria-hidden="true" style={{ color: token.colorWarning }} />}
                    valueStyle={secondaryKpiValueStyle}
                  />
                </Card>
              </Col>
            </Row>
          </Col>
        </Row>
      </Card>

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

      {/* Recent orders + Low stock */}
      <Row gutter={[16, 16]} style={{ marginTop: token.marginLG }}>
        <Col xs={24} lg={14}>
          <Card
            hoverable
            title={translate("dashboard.recentOrders")}
            extra={
              <Button type="link" size="small" onClick={() => navigateList("orders")}>
                {translate("dashboard.viewAllOrders")}
              </Button>
            }
          >
            <Table
              dataSource={recentOrders}
              rowKey="id"
              pagination={false}
              size="small"
              scroll={{ x: "max-content" }}
              loading={recentOrdersQuery?.isLoading}
              locale={{ emptyText: recentOrdersEmptyText }}
              aria-label={translate("dashboard.tables.recentOrdersAriaLabel")}
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
        <Col xs={24} lg={10}>
          <Card
            hoverable
            title={
              <>
                <WarningOutlined aria-hidden="true" style={{ color: token.colorWarning, marginRight: token.marginXS }} />
                {translate("dashboard.lowStockAlerts")}
              </>
            }
            extra={
              <Button type="link" size="small" onClick={() => navigateList("products")}>
                {translate("dashboard.viewAllProducts")}
              </Button>
            }
          >
            <Table
              dataSource={lowStockProducts}
              rowKey="id"
              pagination={false}
              size="small"
              scroll={{ x: "max-content" }}
              loading={lowStockQuery?.isLoading}
              locale={{ emptyText: lowStockEmptyText }}
              aria-label={translate("dashboard.tables.lowStockAriaLabel")}
            >
              <Table.Column dataIndex="name" title={translate("dashboard.productName")} render={(value: string) => <Text ellipsis={{ tooltip: value }}>{value}</Text>} />
              <Table.Column
                dataIndex="stock"
                title={translate("dashboard.currentStock")}
                width={80}
                render={(v: number) => (
                  <Text type={v === 0 ? "danger" : "warning"} strong>
                    {v}
                  </Text>
                )}
              />
            </Table>
          </Card>
        </Col>
      </Row>
    </>
  );
};
