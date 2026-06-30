import { Line } from "@ant-design/charts";
import { Alert, Button, Card, Col, Empty, Radio, Row, Skeleton, Space, Statistic, Tooltip, Typography, theme } from "antd";
import type { RadioChangeEvent } from "antd";
import { useId, useMemo } from "react";
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
type RevenueMetricKey = "revenue";

interface CountTrendChartPoint {
  monthStart: string;
  monthLabel: string;
  metric: CountMetricKey;
  seriesLabel: string;
  value: number;
}

interface RevenueTrendChartPoint {
  monthStart: string;
  monthLabel: string;
  metric: RevenueMetricKey;
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
  revenueTrendTitle: string;
  revenueTrendAriaLabel: string;
  revenueTrendDescription: string;
  retryAction: string;
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
  onRetry?: () => void;
  locale?: string;
}

const TREND_METRIC_PATTERNS: Record<CountMetricKey, { lineDash?: number[]; opacity: number; shape: string }> = {
  orderCount: { opacity: 1, shape: "circle" },
  paidOrderCount: { lineDash: [6, 4], opacity: 0.9, shape: "square" },
  completedOrderCount: { lineDash: [2, 4], opacity: 0.9, shape: "diamond" },
};

export const MonthlyOperationalTrendCard: React.FC<MonthlyOperationalTrendCardProps> = ({
  data,
  totals,
  loading,
  error,
  labels,
  granularity,
  granularityOptions,
  onGranularityChange,
  onRetry,
  locale = "id-ID",
}) => {
  const { token } = theme.useToken();
  const chartDescriptionId = useId();
  const revenueChartDescriptionId = useId();
  const compactNumberFormatter = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        maximumFractionDigits: 1,
        notation: "compact",
      }),
    [locale],
  );
  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency: "IDR",
        maximumFractionDigits: 0,
      }),
    [locale],
  );
  const formattedRevenue = useMemo(() => currencyFormatter.format(totals.revenue), [currencyFormatter, totals.revenue]);
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
  const revenueChartData = useMemo<RevenueTrendChartPoint[]>(
    () => mapRevenuePoints(data.revenueChartPoints, labels.revenue),
    [data.revenueChartPoints, labels.revenue],
  );
  const metricColorRange = useMemo(
    () => [token.colorPrimary, token.colorSuccess, token.colorInfo],
    [token.colorInfo, token.colorPrimary, token.colorSuccess],
  );
  const metricDomain = useMemo(
    () => [labels.orderCount, labels.paidOrders, labels.completedOrders],
    [labels.completedOrders, labels.orderCount, labels.paidOrders],
  );
  const monthTickFormatter = useMemo(
    () => createCompactMonthTickFormatter(locale),
    [locale],
  );
  const countTickFormatter = useMemo(
    () => createCompactCountTickFormatter(compactNumberFormatter),
    [compactNumberFormatter],
  );
  const revenueTickFormatter = useMemo(
    () => createCurrencyTickFormatter(currencyFormatter),
    [currencyFormatter],
  );
  const chartConfig = useMemo(
    () => ({
      data: countChartData,
      xField: "monthLabel",
      yField: "value",
      colorField: "seriesLabel",
      seriesField: "seriesLabel",
      scale: {
        color: {
          domain: metricDomain,
          range: metricColorRange,
        },
      },
      style: {
        lineWidth: 2,
        lineDash: (seriesRows: CountTrendChartPoint[]) => getMetricPattern(seriesRows[0]?.metric).lineDash,
        opacity: (seriesRows: CountTrendChartPoint[]) => getMetricPattern(seriesRows[0]?.metric).opacity,
      },
      point: {
        shapeField: (point: CountTrendChartPoint) => getMetricPattern(point.metric).shape,
        sizeField: 4,
      },
      height: 280,
      autoFit: true,
      axis: {
        x: {
          labelFormatter: monthTickFormatter,
          tickCount: 6,
        },
        y: {
          labelFormatter: countTickFormatter,
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
    [countChartData, countTickFormatter, metricColorRange, metricDomain, monthTickFormatter],
  );
  const revenueChartConfig = useMemo(
    () => ({
      data: revenueChartData,
      xField: "monthLabel",
      yField: "value",
      colorField: "seriesLabel",
      seriesField: "seriesLabel",
      style: {
        lineWidth: 2,
      },
      point: {
        sizeField: 4,
      },
      height: 240,
      autoFit: true,
      axis: {
        x: {
          labelFormatter: monthTickFormatter,
          tickCount: 6,
        },
        y: {
          labelFormatter: revenueTickFormatter,
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
    [monthTickFormatter, revenueChartData, revenueTickFormatter],
  );
  const hasRows = data.rows.length > 0;
  const hasOnlyZeroValues =
    totals.orderCount === 0 &&
    totals.paidOrderCount === 0 &&
    totals.completedOrderCount === 0 &&
    totals.revenue === 0;
  const shouldRenderRevenueTrend = revenueChartData.length > 1;

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
        <Col xs={24} md={12} style={{ display: "flex", justifyContent: "flex-end", minWidth: 0 }}>
          <Radio.Group
            aria-label={labels.granularityAriaLabel}
            optionType="button"
            buttonStyle="solid"
            size="middle"
            value={granularity}
            options={granularityOptions.map((option) => ({ label: option.label, value: option.value }))}
            onChange={handleGranularityChange}
            style={{ display: "flex", flexWrap: "wrap", gap: token.marginXXS, justifyContent: "flex-end" }}
          />
        </Col>
      </Row>

      {loading ? (
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <Skeleton active paragraph={{ rows: 4 }} title={false} />
          <Typography.Text>{labels.loading}</Typography.Text>
        </Space>
      ) : error ? (
        <Alert
          type="error"
          showIcon
          message={labels.errorMessage}
          action={onRetry ? <Button onClick={onRetry}>{labels.retryAction}</Button> : undefined}
        />
      ) : !hasRows ? (
        <Empty description={labels.emptyDescription} />
      ) : (
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>


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

          {shouldRenderRevenueTrend ? (
            <Space direction="vertical" size={token.marginXXS} style={{ width: "100%" }}>
              <Typography.Text strong>{labels.revenueTrendTitle}</Typography.Text>
              <Typography.Paragraph
                id={revenueChartDescriptionId}
                type="secondary"
                style={{ marginBottom: 0, fontSize: token.fontSizeSM }}
              >
                {labels.revenueTrendDescription}
              </Typography.Paragraph>
              <div role="img" aria-label={labels.revenueTrendAriaLabel} aria-describedby={revenueChartDescriptionId}>
                <Line {...revenueChartConfig} />
              </div>
            </Space>
          ) : null}

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

const mapRevenuePoints = (
  points: readonly MonthlyOperationalTrendChartPoint[],
  seriesLabel: string,
): RevenueTrendChartPoint[] =>
  points.map(({ monthStart, monthLabel, value }) => ({
    monthStart,
    monthLabel,
    metric: "revenue",
    seriesLabel,
    value,
  }));

const getMetricPattern = (metric: CountMetricKey | undefined): { lineDash?: number[]; opacity: number; shape: string } =>
  metric ? TREND_METRIC_PATTERNS[metric] : TREND_METRIC_PATTERNS.orderCount;

const createCompactMonthTickFormatter = (locale: string) => (monthLabel: string): string => {
  const [year, month] = monthLabel.split("-");
  const yearNumber = Number(year);
  const monthIndex = Number(month) - 1;

  if (!Number.isInteger(yearNumber) || !Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex > 11) {
    return monthLabel;
  }

  return new Intl.DateTimeFormat(locale, { month: "short", timeZone: "Asia/Jakarta", year: "2-digit" }).format(new Date(Date.UTC(yearNumber, monthIndex, 1)));
};

const createCompactCountTickFormatter = (formatter: Intl.NumberFormat) => (value: number | string): string => {
  const numericValue = typeof value === "number" ? value : Number(value);

  return Number.isFinite(numericValue) ? formatter.format(numericValue) : String(value);
};

const createCurrencyTickFormatter = (formatter: Intl.NumberFormat) => (value: number | string): string => {
  const numericValue = typeof value === "number" ? value : Number(value);

  return Number.isFinite(numericValue) ? formatter.format(numericValue) : String(value);
};
