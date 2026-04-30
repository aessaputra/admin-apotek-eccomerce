import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MonthlyOperationalTrendCard, type MonthlyOperationalTrendCardProps } from "../MonthlyOperationalTrendCard";
import {
  buildMonthlyOperationalTrendData,
  type MonthlyOperationalMetricRow,
  type MonthlyOperationalTrendData,
} from "../monthlyOperationalTrends";

interface LineMockDatum {
  monthStart: string;
  metric: string;
  seriesLabel: string;
  value: number;
}

interface LineMockProps {
  data: LineMockDatum[];
  xField: string;
  yField: string;
  colorField: string;
  seriesField: string;
  axis?: {
    x?: {
      tickCount?: number;
      labelFormatter?: (value: string) => string;
    };
    y?: {
      labelFormatter?: (value: number | string) => string;
    };
  };
}

const chartMocks = vi.hoisted(() => ({
  line: vi.fn<(props: LineMockProps) => void>(),
}));

vi.mock("@ant-design/charts", async () => {
  const ReactModule = await import("react");

  return {
    Line: (props: LineMockProps) => {
      chartMocks.line(props);

      return ReactModule.createElement(
        "div",
        { "data-testid": "line-chart" },
        props.data.map((point) =>
          ReactModule.createElement(
            "span",
            { key: `${point.metric}-${point.monthStart}` },
            `${point.seriesLabel}:${point.value}`,
          ),
        ),
      );
    },
  };
});

vi.mock("antd", () => ({
  Alert: ({ message }: { message?: React.ReactNode }) => <div role="alert">{message}</div>,
  Card: ({ title, extra, children }: { title?: React.ReactNode; extra?: React.ReactNode; children?: React.ReactNode }) => (
    <section>
      <h2>{title}</h2>
      <div>{extra}</div>
      {children}
    </section>
  ),
  Col: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Empty: ({ description }: { description?: React.ReactNode }) => <div>{description}</div>,
  Row: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Radio: {
    Group: ({ options, value }: { options?: { label: string; value: string }[]; value?: string }) => (
      <div data-testid="granularity-control">
        {options?.map((option) => (
          <button aria-pressed={option.value === value} key={option.value} type="button">
            {option.label}
          </button>
        ))}
      </div>
    ),
  },
  Skeleton: () => <div data-testid="trend-skeleton" />,
  Space: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Statistic: ({
    title,
    value,
    formatter,
  }: {
    title?: React.ReactNode;
    value?: number;
    formatter?: (value?: number) => React.ReactNode;
  }) => (
    <div>
      <span>{title}</span>
      <span>{formatter ? formatter(value) : value}</span>
    </div>
  ),
  Tooltip: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Typography: {
    Paragraph: ({ children, id }: { children?: React.ReactNode; id?: string }) => <p id={id}>{children}</p>,
    Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  },
}));

const REFERENCE_DATE = new Date("2026-04-15T00:00:00.000Z");
const labels = {
  title: "Order trends",
  revenue: "Revenue",
  orderCount: "Incoming",
  paidOrders: "Paid",
  completedOrders: "Completed",
  periodLabel: "Last 12 months",
  loading: "Loading order trend data...",
  emptyDescription: "No order trend data is available yet.",
  errorMessage: "Failed to load order trends.",
  zeroValueSummary: "All order trend metrics are zero.",
  chartAriaLabel: "Order trend line chart: incoming, paid, and completed",
  chartDescription: "Incoming, paid, and completed orders for the selected period.",
};
const granularityOptions = [
  { label: "Daily", value: "day" as const },
  { label: "Weekly", value: "week" as const },
  { label: "Monthly", value: "month" as const },
  { label: "Yearly", value: "year" as const },
];
const currencyFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

const createMetricRow = (monthStart: string, values: Partial<MonthlyOperationalMetricRow> = {}): MonthlyOperationalMetricRow => ({
  month_start: monthStart,
  order_count: 0,
  paid_order_count: 0,
  completed_order_count: 0,
  revenue: 0,
  ...values,
});

const populatedTrendData = buildMonthlyOperationalTrendData(
  [
    createMetricRow("2026-02-01", {
      order_count: 2,
      paid_order_count: 1,
      completed_order_count: 1,
      revenue: 100000,
    }),
    createMetricRow("2026-04-01", {
      order_count: 4,
      paid_order_count: 3,
      completed_order_count: 2,
      revenue: 525000,
    }),
  ],
  REFERENCE_DATE,
);

const renderCard = (props: Partial<MonthlyOperationalTrendCardProps> = {}) => {
  const data = props.data ?? populatedTrendData;

  return render(
    <MonthlyOperationalTrendCard
      data={data}
      totals={props.totals ?? data.totals}
      loading={props.loading ?? false}
      error={props.error}
      labels={props.labels ?? labels}
      granularity={props.granularity ?? "month"}
      granularityOptions={props.granularityOptions ?? granularityOptions}
      onGranularityChange={props.onGranularityChange ?? vi.fn()}
    />,
  );
};

const getLineProps = (): LineMockProps => {
  const lineProps = chartMocks.line.mock.calls[0]?.[0];

  if (!lineProps) {
    throw new Error("Line chart was not rendered");
  }

  return lineProps;
};

const createEmptyTrendData = (): MonthlyOperationalTrendData => ({
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
});

describe("MonthlyOperationalTrendCard", () => {
  beforeEach(() => {
    chartMocks.line.mockClear();
  });

  it("renders populated operational trends with a count-only line chart and IDR revenue statistic", () => {
    renderCard();

    expect(screen.getByText(labels.title)).not.toBeNull();
    expect(document.body.textContent).toContain(currencyFormatter.format(populatedTrendData.totals.revenue));
    expect(screen.getByTestId("granularity-control").textContent).toContain("Monthly");
    expect(screen.getByRole("img", { name: labels.chartAriaLabel })).not.toBeNull();
    expect(screen.getByText(labels.chartDescription)).not.toBeNull();

    const lineProps = getLineProps();

    expect(lineProps.xField).toBe("monthLabel");
    expect(lineProps.yField).toBe("value");
    expect(lineProps.colorField).toBe("seriesLabel");
    expect(lineProps.seriesField).toBe("seriesLabel");
    expect(lineProps.axis?.x?.tickCount).toBe(6);
    expect(lineProps.axis?.x?.labelFormatter?.("2026-04")).toBe("Apr 26");
    expect(lineProps.axis?.y?.labelFormatter?.(12500).replace(/\u00a0/g, " ")).toBe("12,5 rb");
    expect(lineProps.data).toHaveLength(36);
    expect(lineProps.data.some((point) => point.metric === "revenue")).toBe(false);
    expect(new Set(lineProps.data.map((point) => point.seriesLabel))).toEqual(
      new Set([labels.orderCount, labels.paidOrders, labels.completedOrders]),
    );
  });

  it("renders a deterministic loading state before chart content", () => {
    renderCard({ loading: true });

    expect(screen.getByTestId("trend-skeleton")).not.toBeNull();
    expect(screen.getByText(labels.loading)).not.toBeNull();
    expect(chartMocks.line).not.toHaveBeenCalled();
  });

  it("renders a safe generic error without leaking the error details", () => {
    renderCard({ error: new Error("database connection leaked details") });

    expect(screen.getByRole("alert").textContent).toBe(labels.errorMessage);
    expect(screen.queryByText("database connection leaked details")).toBeNull();
    expect(chartMocks.line).not.toHaveBeenCalled();
  });

  it("renders an empty state when transformed rows are absent", () => {
    const emptyTrendData = createEmptyTrendData();

    renderCard({ data: emptyTrendData, totals: emptyTrendData.totals });

    expect(screen.getByText(labels.emptyDescription)).not.toBeNull();
    expect(chartMocks.line).not.toHaveBeenCalled();
  });

  it("renders zero-value rows with the line chart and zero summary", () => {
    const zeroTrendData = buildMonthlyOperationalTrendData([], REFERENCE_DATE);

    renderCard({ data: zeroTrendData, totals: zeroTrendData.totals });

    expect(screen.getByRole("alert").textContent).toBe(labels.zeroValueSummary);
    expect(screen.queryByText(labels.emptyDescription)).toBeNull();
    expect(document.body.textContent).toContain(currencyFormatter.format(0));
    expect(getLineProps().data.every((point) => point.value === 0)).toBe(true);
  });
});
