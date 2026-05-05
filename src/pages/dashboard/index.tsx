import { useList, useTranslation, useNavigation } from "@refinedev/core";
import { Alert, Button, Card, Col, Row, Space, Statistic, Table, Tag, Typography, theme } from "antd";
import { useMemo, useState } from "react";
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  ShoppingCartOutlined,
  InboxOutlined,
  DollarOutlined,
  PercentageOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { STATUS_COLORS } from "../../constants/orders";
import { currencyFormatter } from "../../utils/formatters";
import { buildDashboardKpiViewModel, type DashboardKpiAlert, type DashboardKpiAlertKind } from "./dashboardKpis";
import { MonthlyOperationalTrendCard } from "./MonthlyOperationalTrendCard";
import {
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
} from "./styles";

const { Text, Title, Paragraph } = Typography;

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

const decimalFormatter = new Intl.NumberFormat("id-ID", {
  maximumFractionDigits: 1,
});

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

const hasOperationalMetricRows = (rows: readonly OperationalMetricRow[]): boolean =>
  rows.some((row) => isValidBucketStart(row.bucket_start));

export const Dashboard: React.FC = () => {
  const { translate } = useTranslation();
  const { list: navigateList } = useNavigation();
  const { token } = theme.useToken();
  const [trendGranularity, setTrendGranularity] = useState<OperationalTrendGranularity>("day");
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
  });

  const { result: kpiMetricsResult, query: kpiMetricsQuery } = useList<OperationalMetricRow>({
    resource: "admin_operational_metrics",
    pagination: { pageSize: kpiRequest.bucketCount },
    filters: [
      { field: "granularity", operator: "eq", value: kpiRequest.granularity },
      { field: "start_date", operator: "eq", value: kpiRequest.startDate },
      { field: "end_date", operator: "eq", value: kpiRequest.endDate },
    ],
  });

  const { result: operationalMetricsResult, query: operationalMetricsQuery } = useList<OperationalMetricRow>({
    resource: "admin_operational_metrics",
    pagination: { pageSize: trendRequest.bucketCount },
    filters: [
      { field: "granularity", operator: "eq", value: trendRequest.granularity },
      { field: "start_date", operator: "eq", value: trendRequest.startDate },
      { field: "end_date", operator: "eq", value: trendRequest.endDate },
    ],
    queryOptions: { enabled: !isDailyTrend },
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
    ? buildOperationalTrendData(operationalMetricRows, trendGranularity)
    : emptyMonthlyOperationalTrendData;
  const kpiMetricRows = kpiMetricsResult?.data ?? [];
  const dashboardKpiTrendData = hasOperationalMetricRows(kpiMetricRows)
    ? buildOperationalTrendData(kpiMetricRows, "day")
    : emptyMonthlyOperationalTrendData;
  const dashboardKpis = buildDashboardKpiViewModel(dashboardKpiTrendData.totals, {
    lowStockErrorCount: lowStockQuery?.isError ? 1 : 0,
    lowStockProductCount: lowStockResult?.total ?? 0,
    metricsErrorCount: Number(Boolean(kpiMetricsQuery?.isError)) + (isDailyTrend ? 0 : Number(Boolean(operationalMetricsQuery?.isError))),
  });
  const operationalAlertsLoading = Boolean(
    kpiMetricsQuery?.isLoading || activeTrendMetricsQuery?.isLoading || lowStockQuery?.isLoading,
  );
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
      <WarningOutlined style={{ color: token.colorWarning }} />
      {translate("dashboard.alerts.title")}
    </Space>
  );

  return (
    <>
      <Space direction="vertical" size={token.marginXXS} style={pageHeaderStyle}>
        <Title level={2} style={{ margin: 0 }}>
          {translate("dashboard.overview.title")}
        </Title>
        <Paragraph type="secondary" style={{ margin: 0 }}>
          {translate("dashboard.overview.subtitle")}
        </Paragraph>
      </Space>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} xl={6}>
          <Card style={primaryKpiCardStyle}>
            <Statistic
              title={translate("dashboard.kpis.revenue30d")}
              value={dashboardKpis.revenue}
              prefix={<DollarOutlined />}
              valueStyle={primaryKpiValueStyle}
              formatter={(value) => currencyFormatter.format(Number(value ?? 0))}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card style={primaryKpiCardStyle}>
            <Statistic
              title={translate("dashboard.kpis.orders30d")}
              value={dashboardKpis.orderCount}
              prefix={<ShoppingCartOutlined />}
              valueStyle={primaryKpiValueStyle}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card style={primaryKpiCardStyle}>
            <Statistic
              title={translate("dashboard.kpis.paymentSuccessRate")}
              value={dashboardKpis.paymentSuccessRate}
              prefix={<PercentageOutlined />}
              suffix="%"
              valueStyle={primaryKpiValueStyle}
              formatter={(value) => decimalFormatter.format(Number(value ?? 0))}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card style={primaryKpiCardStyle}>
            <Statistic
              title={translate("dashboard.kpis.averageOrderValue")}
              value={dashboardKpis.averageOrderValue}
              prefix={<CheckCircleOutlined />}
              valueStyle={primaryKpiValueStyle}
              formatter={(value) => currencyFormatter.format(Number(value ?? 0))}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: token.marginLG }} align="stretch">
        <Col xs={24} xl={16}>
          <MonthlyOperationalTrendCard
            data={monthlyOperationalTrendData}
            totals={monthlyOperationalTrendData.totals}
            loading={activeTrendMetricsQuery?.isLoading ?? false}
            error={monthlyOperationalTrendError}
            granularity={trendGranularity}
            granularityOptions={trendGranularityOptions}
            onGranularityChange={setTrendGranularity}
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
              dataTableLabel: translate("dashboard.monthlyTrends.dataTableLabel"),
              periodColumn: translate("dashboard.monthlyTrends.periodColumn"),
              incomingColumn: translate("dashboard.monthlyTrends.incomingColumn"),
              paidColumn: translate("dashboard.monthlyTrends.paidColumn"),
              completedColumn: translate("dashboard.monthlyTrends.completedColumn"),
              revenueColumn: translate("dashboard.monthlyTrends.revenueColumn"),
            }}
          />
        </Col>

        <Col xs={24} xl={8}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: token.marginMD,
              height: "100%",
            }}
          >
            <Card title={attentionCardTitle}>
              <Space direction="vertical" size={token.marginSM} style={{ width: "100%" }}>
                {shouldShowOperationalAlertsLoading ? (
                  <Alert showIcon type="info" message={translate("dashboard.alerts.loading.message")} />
                ) : null}
                {operationalAlerts.map((alert) => {
                  const labels = getOperationalAlertLabels(alert, translate);
                  const compactAlert = alert.kind === "no-risk";

                  return (
                    <Alert
                      showIcon
                      key={alert.kind}
                      type={alert.severity}
                      message={labels.message}
                      description={compactAlert ? undefined : labels.description}
                    />
                  );
                })}
              </Space>
            </Card>

            <Row gutter={[16, 16]} style={{ flex: 1 }} align="stretch">
              <Col xs={24} sm={12} xl={24} style={{ display: "flex" }}>
                <Card style={{ ...secondaryKpiCardStyle, flex: 1, width: "100%" }}>
                  <Statistic
                    title={translate("dashboard.kpis.fulfillmentRisk")}
                    value={dashboardKpis.fulfillmentRisk}
                    prefix={<ClockCircleOutlined />}
                    valueStyle={secondaryKpiValueStyle}
                  />
                </Card>
              </Col>
              <Col xs={24} sm={12} xl={24} style={{ display: "flex" }}>
                <Card style={{ ...secondaryKpiCardStyle, flex: 1, width: "100%" }}>
                  <Statistic
                    title={translate("dashboard.kpis.lowStockSkus")}
                    value={dashboardKpis.lowStockRisk}
                    prefix={<InboxOutlined />}
                    valueStyle={secondaryKpiValueStyle}
                  />
                </Card>
              </Col>
            </Row>
          </div>
        </Col>
      </Row>

      {/* Recent orders + Low stock */}
      <Row gutter={[16, 16]} style={{ marginTop: token.marginLG }}>
        <Col xs={24} lg={14}>
          <Card
            title={translate("dashboard.recentOrders")}
            extra={
              <Button type="link" size="small" onClick={() => navigateList("orders")}>
                {translate("dashboard.viewAll")}
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
              locale={{ emptyText: translate("dashboard.noRecentOrders") }}
              aria-label={translate("dashboard.tables.recentOrdersAriaLabel")}
            >
              <Table.Column
                dataIndex="id"
                title="ID"
                width={128}
                render={(value: string) => <Text code>{formatDashboardOrderId(value)}</Text>}
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
                render={(v) => (v ? new Date(v).toLocaleDateString("id-ID") : "-")}
              />
            </Table>
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card
            title={
              <>
                <WarningOutlined style={{ color: token.colorWarning, marginRight: token.marginXS }} />
                {translate("dashboard.lowStockAlerts")}
              </>
            }
            extra={
              <Button type="link" size="small" onClick={() => navigateList("products")}>
                {translate("dashboard.viewAll")}
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
              locale={{ emptyText: translate("dashboard.noLowStock") }}
              aria-label={translate("dashboard.tables.lowStockAriaLabel")}
            >
              <Table.Column dataIndex="name" title={translate("dashboard.productName")} />
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
