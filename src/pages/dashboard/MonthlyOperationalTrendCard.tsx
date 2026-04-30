import { Line } from "@ant-design/charts";
import { Alert, Card, Col, Empty, Row, Skeleton, Space, Statistic, Tooltip, Typography } from "antd";
import { useId, useMemo } from "react";
import type {
  MonthlyOperationalTrendChartPoint,
  MonthlyOperationalTrendData,
  MonthlyOperationalTrendTotals,
} from "./monthlyOperationalTrends";

type CountMetricKey = "orderCount" | "paidOrderCount" | "completedOrderCount";

interface CountTrendChartPoint {
  monthStart: string;
  monthLabel: string;
  metric: CountMetricKey;
  seriesLabel: string;
  value: number;
}

export interface MonthlyOperationalTrendCardLabels {
  title: string;
  revenue: string;
  orderCount: string;
  paidOrders: string;
  completedOrders: string;
  latest12Months: string;
  loading: string;
  emptyDescription: string;
  errorMessage: string;
  zeroValueSummary: string;
  chartAriaLabel: string;
  chartDescription: string;
}

export interface MonthlyOperationalTrendCardProps {
  data: MonthlyOperationalTrendData;
  totals: MonthlyOperationalTrendTotals;
  loading: boolean;
  error?: unknown;
  labels: MonthlyOperationalTrendCardLabels;
}

const currencyFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

export const MonthlyOperationalTrendCard: React.FC<MonthlyOperationalTrendCardProps> = ({
  data,
  totals,
  loading,
  error,
  labels,
}) => {
  const chartDescriptionId = useId();
  const formattedRevenue = useMemo(() => currencyFormatter.format(totals.revenue), [totals.revenue]);
  const revenueSummary = useMemo(
    () =>
      [
        labels.latest12Months,
        `${labels.revenue}: ${formattedRevenue}`,
        `${labels.orderCount}: ${totals.orderCount}`,
        `${labels.paidOrders}: ${totals.paidOrderCount}`,
        `${labels.completedOrders}: ${totals.completedOrderCount}`,
      ].join(" · "),
    [
      formattedRevenue,
      labels.completedOrders,
      labels.latest12Months,
      labels.orderCount,
      labels.paidOrders,
      labels.revenue,
      totals.completedOrderCount,
      totals.orderCount,
      totals.paidOrderCount,
    ],
  );
  const countChartData = useMemo<CountTrendChartPoint[]>(
    () => [
      ...mapCountPoints(data.orderCountChartPoints, "orderCount", labels.orderCount),
      ...mapCountPoints(data.paidOrderCountChartPoints, "paidOrderCount", labels.paidOrders),
      ...mapCountPoints(data.completedOrderCountChartPoints, "completedOrderCount", labels.completedOrders),
    ],
    [
      data.completedOrderCountChartPoints,
      data.orderCountChartPoints,
      data.paidOrderCountChartPoints,
      labels.completedOrders,
      labels.orderCount,
      labels.paidOrders,
    ],
  );
  const chartConfig = useMemo(
    () => ({
      data: countChartData,
      xField: "monthLabel",
      yField: "value",
      colorField: "seriesLabel",
      seriesField: "seriesLabel",
      height: 280,
      autoFit: true,
      axis: {
        x: { title: labels.latest12Months },
        y: { title: labels.orderCount },
      },
      legend: {
        color: {
          position: "bottom",
        },
      },
      tooltip: {
        title: "monthLabel",
      },
    }),
    [countChartData, labels.latest12Months, labels.orderCount],
  );
  const hasRows = data.rows.length > 0;
  const hasOnlyZeroValues =
    totals.orderCount === 0 &&
    totals.paidOrderCount === 0 &&
    totals.completedOrderCount === 0 &&
    totals.revenue === 0;

  return (
    <Card title={labels.title}>
      {loading ? (
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <Skeleton active paragraph={{ rows: 4 }} title={false} />
          <Typography.Text>{labels.loading}</Typography.Text>
        </Space>
      ) : error ? (
        <Alert type="error" showIcon message={labels.errorMessage} />
      ) : !hasRows ? (
        <Empty description={labels.emptyDescription} />
      ) : (
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <Row gutter={[16, 16]} align="middle">
            <Col xs={24} md={8}>
              <Tooltip title={revenueSummary}>
                <Statistic title={labels.revenue} value={totals.revenue} formatter={() => formattedRevenue} />
              </Tooltip>
            </Col>
            <Col xs={24} md={16}>
              <Typography.Paragraph id={chartDescriptionId} style={{ marginBottom: 8 }}>
                {labels.chartDescription}
              </Typography.Paragraph>
              <Typography.Text>{revenueSummary}</Typography.Text>
            </Col>
          </Row>

          {hasOnlyZeroValues ? <Alert type="info" showIcon message={labels.zeroValueSummary} /> : null}

          <ul style={{ margin: 0, paddingInlineStart: 20 }}>
            <li>
              {labels.orderCount}: {totals.orderCount}
            </li>
            <li>
              {labels.paidOrders}: {totals.paidOrderCount}
            </li>
            <li>
              {labels.completedOrders}: {totals.completedOrderCount}
            </li>
          </ul>

          <div role="img" aria-label={labels.chartAriaLabel} aria-describedby={chartDescriptionId}>
            <Line {...chartConfig} />
          </div>
        </Space>
      )}
    </Card>
  );
};

const mapCountPoints = (
  points: readonly MonthlyOperationalTrendChartPoint[],
  metric: CountMetricKey,
  seriesLabel: string,
): CountTrendChartPoint[] =>
  points.map(({ monthStart, monthLabel, value }) => ({
    monthStart,
    monthLabel,
    metric,
    seriesLabel,
    value,
  }));
