import { Line } from "@ant-design/charts";
import { Alert, Card, Col, Empty, Radio, Row, Skeleton, Space, Statistic, Tooltip, Typography, theme } from "antd";
import type { RadioChangeEvent } from "antd";
import { useId, useMemo } from "react";
import { currencyFormatter } from "../../utils/formatters";
import type {
  MonthlyOperationalTrendChartPoint,
  MonthlyOperationalTrendData,
  MonthlyOperationalTrendTotals,
  OperationalTrendGranularity,
} from "./monthlyOperationalTrends";
import {
  getDashboardTrendStatTileStyle,
  getDashboardTrendStatValueStyle,
  visuallyHiddenStyle,
} from "./styles";

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
  periodLabel: string;
  loading: string;
  emptyDescription: string;
  errorMessage: string;
  zeroValueSummary: string;
  chartAriaLabel: string;
  chartDescription: string;
  dataTableLabel: string;
  periodColumn: string;
  incomingColumn: string;
  paidColumn: string;
  completedColumn: string;
  revenueColumn: string;
  granularityAriaLabel: string;
}

export interface MonthlyOperationalTrendGranularityOption {
  label: string;
  value: OperationalTrendGranularity;
}

export interface MonthlyOperationalTrendCardProps {
  data: MonthlyOperationalTrendData;
  totals: MonthlyOperationalTrendTotals;
  loading: boolean;
  error?: unknown;
  labels: MonthlyOperationalTrendCardLabels;
  granularity: OperationalTrendGranularity;
  granularityOptions: readonly MonthlyOperationalTrendGranularityOption[];
  onGranularityChange: (granularity: OperationalTrendGranularity) => void;
}

const compactNumberFormatter = new Intl.NumberFormat("id-ID", {
  maximumFractionDigits: 1,
  notation: "compact",
});

const compactMonthFormatter = new Intl.DateTimeFormat("id-ID", {
  month: "short",
  timeZone: "Asia/Jakarta",
  year: "2-digit",
});

export const MonthlyOperationalTrendCard: React.FC<MonthlyOperationalTrendCardProps> = ({
  data,
  totals,
  loading,
  error,
  labels,
  granularity,
  granularityOptions,
  onGranularityChange,
}) => {
  const { token } = theme.useToken();
  const chartDescriptionId = useId();
  const formattedRevenue = useMemo(() => currencyFormatter.format(totals.revenue), [totals.revenue]);
  const revenueSummary = useMemo(
    () =>
      [
        labels.periodLabel,
        `${labels.revenue}: ${formattedRevenue}`,
        `${labels.orderCount}: ${totals.orderCount}`,
        `${labels.paidOrders}: ${totals.paidOrderCount}`,
        `${labels.completedOrders}: ${totals.completedOrderCount}`,
      ].join(" · "),
    [
      formattedRevenue,
      labels.completedOrders,
      labels.orderCount,
      labels.paidOrders,
      labels.periodLabel,
      labels.revenue,
      totals.completedOrderCount,
      totals.orderCount,
      totals.paidOrderCount,
    ],
  );
  const countSummary = useMemo(
    () =>
      [
        `${labels.orderCount}: ${totals.orderCount}`,
        `${labels.paidOrders}: ${totals.paidOrderCount}`,
        `${labels.completedOrders}: ${totals.completedOrderCount}`,
      ].join(" · "),
    [
      labels.completedOrders,
      labels.orderCount,
      labels.paidOrders,
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
        x: {
          labelFormatter: formatCompactMonthTick,
          tickCount: 6,
        },
        y: {
          labelFormatter: formatCompactCountTick,
        },
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
    [countChartData],
  );
  const hasRows = data.rows.length > 0;
  const hasOnlyZeroValues =
    totals.orderCount === 0 &&
    totals.paidOrderCount === 0 &&
    totals.completedOrderCount === 0 &&
    totals.revenue === 0;

  const handleGranularityChange = (event: RadioChangeEvent): void => {
    onGranularityChange(event.target.value as OperationalTrendGranularity);
  };

  const statTileStyle = getDashboardTrendStatTileStyle(token);
  const statValueStyle = getDashboardTrendStatValueStyle(token);

  return (
    <Card style={{ height: "100%" }}>
      <Row gutter={[16, 12]} align="middle" justify="space-between" style={{ marginBottom: token.marginMD }}>
        <Col xs={24} md={12}>
          <Space direction="vertical" size={0}>
            <Typography.Text strong style={{ fontSize: token.fontSizeLG }}>
              {labels.title}
            </Typography.Text>
            <Typography.Text type="secondary">{labels.periodLabel}</Typography.Text>
          </Space>
        </Col>
        <Col xs={24} md={12} style={{ display: "flex", justifyContent: "flex-end" }}>
          <Radio.Group
            aria-label={labels.granularityAriaLabel}
            optionType="button"
            buttonStyle="solid"
            size="small"
            value={granularity}
            options={granularityOptions.map((option) => ({ label: option.label, value: option.value }))}
            onChange={handleGranularityChange}
          />
        </Col>
      </Row>

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
          <Row gutter={[12, 12]}>
            <Col xs={24} sm={12} lg={6}>
              <Tooltip title={revenueSummary}>
                <div style={statTileStyle}>
                  <Statistic
                    title={labels.revenue}
                    value={totals.revenue}
                    formatter={() => formattedRevenue}
                    valueStyle={statValueStyle}
                  />
                </div>
              </Tooltip>
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <Tooltip title={countSummary}>
                <div style={statTileStyle}>
                  <Statistic title={labels.orderCount} value={totals.orderCount} valueStyle={statValueStyle} />
                </div>
              </Tooltip>
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <Tooltip title={countSummary}>
                <div style={statTileStyle}>
                  <Statistic title={labels.paidOrders} value={totals.paidOrderCount} valueStyle={statValueStyle} />
                </div>
              </Tooltip>
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <Tooltip title={countSummary}>
                <div style={statTileStyle}>
                  <Statistic title={labels.completedOrders} value={totals.completedOrderCount} valueStyle={statValueStyle} />
                </div>
              </Tooltip>
            </Col>
          </Row>

          <Typography.Paragraph
            id={chartDescriptionId}
            type="secondary"
            style={{ marginBottom: 0, fontSize: token.fontSizeSM }}
          >
            {labels.chartDescription}
          </Typography.Paragraph>

          {hasOnlyZeroValues ? <Alert type="info" showIcon message={labels.zeroValueSummary} /> : null}

          <div role="img" aria-label={labels.chartAriaLabel} aria-describedby={chartDescriptionId}>
            <Line {...chartConfig} />
          </div>

          <div style={visuallyHiddenStyle}>
            <table aria-label={labels.dataTableLabel}>
              <caption>{labels.dataTableLabel}</caption>
              <thead>
                <tr>
                  <th scope="col">{labels.periodColumn}</th>
                  <th scope="col">{labels.incomingColumn}</th>
                  <th scope="col">{labels.paidColumn}</th>
                  <th scope="col">{labels.completedColumn}</th>
                  <th scope="col">{labels.revenueColumn}</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, index) => (
                  <tr key={index}>
                    <th scope="row">{row.monthLabel}</th>
                    <td>{row.orderCount}</td>
                    <td>{row.paidOrderCount}</td>
                    <td>{row.completedOrderCount}</td>
                    <td>{currencyFormatter.format(row.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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

const formatCompactMonthTick = (monthLabel: string): string => {
  const [year, month] = monthLabel.split("-");
  const yearNumber = Number(year);
  const monthIndex = Number(month) - 1;

  if (!Number.isInteger(yearNumber) || !Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex > 11) {
    return monthLabel;
  }

  return compactMonthFormatter.format(new Date(Date.UTC(yearNumber, monthIndex, 1)));
};

const formatCompactCountTick = (value: number | string): string => {
  const numericValue = typeof value === "number" ? value : Number(value);

  return Number.isFinite(numericValue) ? compactNumberFormatter.format(numericValue) : String(value);
};
