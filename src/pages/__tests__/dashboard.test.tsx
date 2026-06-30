import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dashboard } from "../dashboard";
import type { OperationalMetricRow } from "../dashboard/monthlyOperationalTrends";

interface LineMockDatum {
  monthLabel: string;
  seriesLabel: string;
  value: number;
}

interface LineMockProps {
  data: LineMockDatum[];
  point?: Record<string, unknown>;
  scale?: { color?: { domain?: string[]; range?: string[] } };
  style?: Record<string, unknown>;
}

interface DashboardQueryState {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  isFetching?: boolean;
  refetch?: () => void;
}

interface DashboardQueryOptions {
  recentOrders?: { id: string; total_amount: string | number; status: string; created_at: string }[];
  kpiMetricRows?: OperationalMetricRow[];
  kpiQuery?: Partial<DashboardQueryState>;
  lowStockQuery?: Partial<DashboardQueryState>;
  lowStockProducts?: { id: string; name: string; stock: number }[];
  monthlyMetricRows?: OperationalMetricRow[];
  monthlyQuery?: Partial<DashboardQueryState>;
  lowStockTotal?: number;
}

const mocks = vi.hoisted(() => {
  const useList = vi.fn();
  const translate = vi.fn((key: string, params?: Record<string, unknown>, fallback?: string) => {
    const translations: Record<string, string> = {
      "dashboard.overview.title": "Store Performance",
      "dashboard.overview.subtitle": "Monitor orders, sales, stock, and follow-up queues from the last 30 days.",
      "dashboard.kpis.revenue30d": "Sales",
      "dashboard.kpis.orders30d": "Orders",
      "dashboard.kpis.paymentSuccessRate": "Paid Order Rate",
      "dashboard.kpis.averageOrderValue": "Average Order Value",
      "dashboard.kpis.lowStockSkus": "Low-Stock Products",
      "dashboard.kpis.unavailable": "Unavailable",
      "dashboard.kpis.periodNote": "Summary figures use the last 30 days. The trend chart follows the selected period.",
      "dashboard.kpis.revenue30dContext": "Sales counts settled paid orders only.",
      "dashboard.kpis.orders30dContext": "Incoming orders created in the last 30 days.",
      "dashboard.kpis.paymentSuccessRateContext": "Paid orders divided by incoming orders.",
      "dashboard.kpis.averageOrderValueContext": "Sales divided by paid orders.",
      "dashboard.kpis.fulfillmentRiskContext": "Paid orders minus delivered orders.",
      "dashboard.alerts.title": "Needs Follow-Up",
      "dashboard.alerts.metricsError.message": "Summary unavailable",
      "dashboard.alerts.metricsError.description": "Some summary figures could not be loaded. Retry the dashboard or check the trend panel.",
      "dashboard.alerts.lowStockError.message": "Couldn’t load low-stock data",
      "dashboard.alerts.recentOrdersError.message": "Couldn’t load recent orders",
      "dashboard.alerts.recentOrdersError.description": "The order list has not loaded. Refresh before treating the queue as empty.",
      "dashboard.alerts.fulfillmentRisk.message": "{{count}} paid orders are pending delivery",
      "dashboard.alerts.fulfillmentRisk.description": "Open the orders list to review paid orders that have not reached Delivered status.",
      "dashboard.alerts.lowStockRisk.message": "{{count}} active products are low on stock",
      "dashboard.alerts.lowStockRisk.description": "Active products below 10 units need restock review.",
      "dashboard.alerts.noRisk.message": "No urgent queue items",
      "dashboard.alerts.noRisk.description": "Summary data loaded successfully, with no orders or stock items needing immediate follow-up.",
      "dashboard.alerts.loading.message": "Checking the follow-up queue",
      "dashboard.alerts.loading.description": "Summary and stock counts are still loading. Queue status will update shortly.",
      "dashboard.recentOrders": "Recent Orders",
      "dashboard.viewAll": "View All",
      "dashboard.viewAllOrders": "View all orders",
      "dashboard.viewAllProducts": "View all products",
      "dashboard.orderTotal": "Total",
      "dashboard.orderStatus": "Status",
      "dashboard.orderDate": "Date",
      "dashboard.lowStockAlerts": "Low Stock",
      "dashboard.productName": "Product",
      "dashboard.currentStock": "Stock",
      "dashboard.noRecentOrders": "No orders yet",
      "dashboard.noLowStock": "All stock levels OK",
      "dashboard.tables.recentOrdersAriaLabel": "Recent orders table",
      "dashboard.tables.lowStockAriaLabel": "Low stock products table",
      "dashboard.orderId": "Order ID",
      "dashboard.fullOrderId": "Full order ID",
      "dashboard.monthlyTrends.title": "Order Trends",
      "dashboard.monthlyTrends.revenue": "Sales",
      "dashboard.monthlyTrends.orderCount": "Incoming Orders",
      "dashboard.monthlyTrends.paidOrders": "Paid Orders",
      "dashboard.monthlyTrends.completedOrders": "Delivered",
      "dashboard.monthlyTrends.dataTableLabel": "Order trend data table",
      "dashboard.monthlyTrends.periodColumn": "Period",
      "dashboard.monthlyTrends.incomingColumn": "Incoming",
      "dashboard.monthlyTrends.paidColumn": "Paid",
      "dashboard.monthlyTrends.completedColumn": "Delivered",
      "dashboard.monthlyTrends.revenueColumn": "Sales",
      "dashboard.monthlyTrends.latest12Months": "Latest 12 months",
      "dashboard.monthlyTrends.period.day": "Last 30 days",
      "dashboard.monthlyTrends.period.week": "Last 12 weeks",
      "dashboard.monthlyTrends.period.month": "Last 12 months",
      "dashboard.monthlyTrends.period.year": "Last 5 years",
      "dashboard.monthlyTrends.granularity.day": "Daily",
      "dashboard.monthlyTrends.granularity.week": "Weekly",
      "dashboard.monthlyTrends.granularity.month": "Monthly",
      "dashboard.monthlyTrends.granularity.year": "Yearly",
      "dashboard.monthlyTrends.granularityAriaLabel": "Choose order trend period",
      "dashboard.monthlyTrends.loading": "Loading order trends...",
      "dashboard.monthlyTrends.emptyDescription": "No order trends are available yet.",
      "dashboard.monthlyTrends.errorMessage": "Failed to load order trends.",
      "dashboard.monthlyTrends.zeroValueSummary": "All order trend figures are still zero.",
      "dashboard.monthlyTrends.chartAriaLabel": "Order trend line chart: incoming, paid, and delivered orders",
      "dashboard.monthlyTrends.revenueTrendTitle": "Revenue Trend",
      "dashboard.monthlyTrends.revenueTrendAriaLabel": "Revenue trend line chart",
      "dashboard.monthlyTrends.revenueTrendDescription": "Sales from settled paid orders across the selected period.",
      "dashboard.retry": "Try again",
      "dashboard.monthlyTrends.chartDescription": "Incoming, paid, and delivered order counts for the selected period.",
      "orderStatus.shipped": "Handed to Courier",
    };

    const translated = translations[key] ?? fallback ?? key;

    return params?.count !== undefined ? translated.replace(/\{\{count\}\}/g, String(params.count)) : translated;
  });
  const navigateList = vi.fn();
  const col = vi.fn<(props: { xs?: number; sm?: number; lg?: number; xl?: number }) => void>();
  const line = vi.fn<(props: LineMockProps) => void>();
  const tableColumn = vi.fn<(props: { dataIndex?: string | readonly string[]; responsive?: readonly string[] }) => void>();

  return {
    useList,
    translate,
    navigateList,
    col,
    line,
    tableColumn,
  };
});

vi.mock("@refinedev/core", () => ({
  useGetLocale: () => () => "id",
  useList: mocks.useList,
  useTranslation: () => ({ translate: mocks.translate }),
  useNavigation: () => ({ list: mocks.navigateList }),
}));

vi.mock("@ant-design/charts", async () => {
  const ReactModule = await import("react");

  return {
    Line: (props: LineMockProps) => {
      mocks.line(props);

      return ReactModule.createElement(
        "div",
        { "data-testid": "monthly-trend-line" },
        props.data.map((point, index) =>
          ReactModule.createElement(
            "span",
            { key: `${point.seriesLabel}-${point.monthLabel}-${index}` },
            `${point.monthLabel}:${point.seriesLabel}:${point.value}`,
          ),
        ),
      );
    },
  };
});

vi.mock("antd", async () => {
  const ReactModule = await import("react");

  type DataIndex = string | readonly string[];

  interface TableColumnProps {
    dataIndex?: DataIndex;
    responsive?: readonly string[];
    title?: React.ReactNode;
    render?: (value: unknown, record: Record<string, unknown>) => React.ReactNode;
  }

  interface TableProps {
    children?: React.ReactNode;
    dataSource?: Record<string, unknown>[];
    locale?: { emptyText?: React.ReactNode };
    "aria-label"?: string;
  }

  interface ColProps {
    children?: React.ReactNode;
    xs?: number;
    sm?: number;
    lg?: number;
    xl?: number;
  }

  const getRecordValue = (record: Record<string, unknown>, dataIndex?: DataIndex): unknown => {
    if (!dataIndex) {
      return undefined;
    }

    if (typeof dataIndex === "string") {
      return record[dataIndex];
    }

    return dataIndex.reduce<unknown>((value, key) => {
      if (value && typeof value === "object") {
        return (value as Record<string, unknown>)[key];
      }

      return undefined;
    }, record);
  };

  const TableComponent = ({ children, dataSource = [], locale, "aria-label": ariaLabel }: TableProps) => (
    <div aria-label={ariaLabel} role="table">
      {dataSource.length === 0 && locale?.emptyText ? <div>{locale.emptyText}</div> : null}
      {ReactModule.Children.map(children, (child) => {
        if (!ReactModule.isValidElement<TableColumnProps>(child)) {
          return child;
        }

        const { dataIndex, render: renderValue, responsive, title } = child.props;

        mocks.tableColumn({ dataIndex, responsive });

        return (
          <div>
            <div>{title}</div>
            {dataSource.map((record, index) => {
              const value = getRecordValue(record, dataIndex);

              return <div key={String(record.id ?? index)}>{renderValue ? renderValue(value, record) : String(value ?? "")}</div>;
            })}
          </div>
        );
      })}
    </div>
  );

  const Column = () => null;
  const Table = Object.assign(TableComponent, { Column });

  return {
    Alert: ({ action, description, message, type }: { action?: React.ReactNode; description?: React.ReactNode; message?: React.ReactNode; type?: string }) => (
      <div data-alert-type={type} role="alert">
        <div>{message}</div>
        {description ? <div>{description}</div> : null}
        {action ? <div>{action}</div> : null}
      </div>
    ),
    Card: ({ title, extra, children }: { title?: React.ReactNode; extra?: React.ReactNode; children?: React.ReactNode }) => (
      <section>
        <div>{title}</div>
        <div>{extra}</div>
        {children}
      </section>
    ),
    Col: ({ children, xs, sm, lg, xl }: ColProps) => {
      mocks.col({ xs, sm, lg, xl });

      return <div>{children}</div>;
    },
    Row: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    Radio: {
      Group: ({
        "aria-label": ariaLabel,
        onChange,
        options,
        value,
      }: {
        "aria-label"?: string;
        onChange?: (event: { target: { value: string } }) => void;
        options?: { label: string; value: string }[];
        value?: string;
      }) => (
        <div aria-label={ariaLabel} role="radiogroup">
          {options?.map((option) => (
            <button
              aria-pressed={option.value === value}
              key={option.value}
              onClick={() => onChange?.({ target: { value: option.value } })}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      ),
    },
    Statistic: ({
      prefix,
      title,
      value,
      suffix,
      formatter,
      loading,
    }: {
      title?: React.ReactNode;
      prefix?: React.ReactNode;
      value?: React.ReactNode;
      suffix?: React.ReactNode;
      formatter?: (value?: React.ReactNode) => React.ReactNode;
      loading?: boolean;
    }) => (
      <div>
        {prefix}
        <span>{title}</span>
        {loading ? (
          <span data-testid="statistic-loading">Loading statistic</span>
        ) : (
          <span>
            {formatter ? formatter(value) : value}
            {suffix}
          </span>
        )}
      </div>
    ),
    Table,
    Tag: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
    Typography: {
      Paragraph: ({ children, id }: { children?: React.ReactNode; id?: string }) => <p id={id}>{children}</p>,
      Text: ({
        "aria-label": ariaLabel,
        children,
        title,
      }: {
        "aria-label"?: string;
        children?: React.ReactNode;
        title?: string;
      }) => <span aria-label={ariaLabel} title={title}>{children}</span>,
      Title: ({ children }: { children?: React.ReactNode }) => <h3>{children}</h3>,
    },
    Button: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => (
      <button type="button" onClick={onClick}>{children}</button>
    ),
    Empty: ({ description }: { description?: React.ReactNode }) => <div>{description}</div>,
    Skeleton: () => <div data-testid="monthly-trend-skeleton" />,
    Space: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    Tooltip: ({ children, title }: { children?: React.ReactNode; title?: React.ReactNode }) => <div title={typeof title === "string" ? title : undefined}>{children}</div>,
    theme: {
      useToken: () => ({
        token: {
          borderRadiusLG: 8,
          colorBorderSecondary: "#d9d9d9",
          colorFillAlter: "#fafafa",
          colorInfo: "#13c2c2",
          colorPrimary: "#1677ff",
          colorSuccess: "#52c41a",
          colorWarning: "#faad14",
          fontSizeHeading3: 24,
          fontSizeHeading4: 20,
          fontSizeLG: 16,
          fontSizeSM: 12,
          fontWeightStrong: 600,
          marginLG: 24,
          marginMD: 16,
          marginSM: 12,
          marginXS: 8,
          marginXXS: 4,
          paddingSM: 12,
        },
      }),
    },
  };
});

vi.mock("@ant-design/icons", () => ({
  CheckCircleOutlined: () => <span aria-hidden="true" data-testid="check-circle-icon" />,
  BankOutlined: () => <span aria-hidden="true" data-testid="bank-icon" />,
  ClockCircleOutlined: () => <span aria-hidden="true" data-testid="clock-circle-icon" />,
  ShoppingCartOutlined: () => <span aria-hidden="true" data-testid="cart-icon" />,
  UserOutlined: () => <span aria-hidden="true" data-testid="user-icon" />,
  InboxOutlined: () => <span aria-hidden="true" data-testid="inbox-icon" />,
  PercentageOutlined: () => <span aria-hidden="true" data-testid="percentage-icon" />,
  WarningOutlined: () => <span aria-hidden="true" data-testid="warning-icon" />,
}));

const currencyFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

const createMonthlyMetricRow = (
  bucketStart: string,
  values: Partial<OperationalMetricRow> = {},
): OperationalMetricRow => ({
  bucket_start: bucketStart,
  bucket_end: bucketStart,
  order_count: 0,
  paid_order_count: 0,
  completed_order_count: 0,
  revenue: 0,
  ...values,
});

const populatedMonthlyMetricRows = [
  createMonthlyMetricRow("2026-03-01", {
    order_count: "3",
    paid_order_count: "2",
    completed_order_count: "1",
    revenue: "100000",
  }),
  createMonthlyMetricRow("2026-04-01", {
    order_count: "2",
    paid_order_count: "1",
    completed_order_count: "1",
    revenue: "25000",
  }),
];

const healthyMonthlyMetricRows = [
  createMonthlyMetricRow("2026-04-15", {
    order_count: 1,
    paid_order_count: 1,
    completed_order_count: 1,
    revenue: 10000,
  }),
];

const setupDashboardQueries = ({
  recentOrders,
  kpiMetricRows,
  kpiQuery = {},
  lowStockQuery = {},
  lowStockProducts,
  monthlyMetricRows = populatedMonthlyMetricRows,
  monthlyQuery = {},
  lowStockTotal = 1,
}: DashboardQueryOptions = {}) => {
  const lowStockRows = lowStockProducts ?? (lowStockTotal > 0 ? [{ id: "product-1", name: "Bandage", stock: 4 }] : []);
  const kpiRows = kpiMetricRows ?? monthlyMetricRows;

  mocks.useList.mockImplementation((params: { resource: string; meta?: Record<string, unknown>; pagination?: Record<string, unknown>; filters?: { field: string; value?: unknown }[]; queryOptions?: { enabled?: boolean; staleTime?: number } }) => {
    if (params.resource === "orders" && params.meta?.count === "exact") {
      return { result: { total: 1 } };
    }

    if (params.resource === "profiles") {
      return { result: { total: 2 } };
    }

    if (params.resource === "orders" && params.pagination?.mode === "off") {
      return { result: { data: [{ total_amount: 10000 }] } };
    }

    if (params.resource === "orders") {
      return {
        result: {
          data: recentOrders ?? [
            {
              id: "order-1234567890",
              total_amount: 10000,
              status: "shipped",
              created_at: "2026-04-01T00:00:00.000Z",
            },
          ],
        },
        query: { isLoading: false, isError: false, error: null },
      };
    }

    if (params.resource === "products") {
      return {
        result: { data: lowStockRows, total: lowStockTotal },
        query: { isLoading: false, isError: false, error: null, ...lowStockQuery },
      };
    }

    if (params.resource === "admin_operational_metrics") {
      const granularity = params.filters?.find((filter) => filter.field === "granularity")?.value;

      if (params.queryOptions?.enabled === false) {
        return {
          result: undefined,
          query: { isLoading: false, isError: false, error: null },
        };
      }

      if (granularity === "day") {
        return {
          result: { data: kpiRows },
          query: { isLoading: false, isError: false, error: null, ...kpiQuery },
        };
      }

      return {
        result: { data: monthlyMetricRows },
        query: { isLoading: false, isError: false, error: null, ...monthlyQuery },
      };
    }

    return { result: { data: [] }, query: { isLoading: false } };
  });
};

describe("Dashboard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T00:00:00.000Z"));
    mocks.useList.mockReset();
    mocks.translate.mockClear();
    mocks.navigateList.mockReset();
    mocks.col.mockClear();
    mocks.line.mockClear();
    mocks.tableColumn.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders translated order status labels in recent orders", () => {
    setupDashboardQueries();

    render(<Dashboard />);

    expect(screen.getByText("Handed to Courier")).not.toBeNull();
    expect(screen.queryByText("shipped")).toBeNull();
  });

  it("labels dashboard tables and keeps non-essential recent order columns responsive", () => {
    setupDashboardQueries();

    render(<Dashboard />);

    expect(screen.getByRole("table", { name: "Recent orders table" })).not.toBeNull();
    expect(screen.getByRole("table", { name: "Low stock products table" })).not.toBeNull();
    expect(screen.getByLabelText("Full order ID: order-1234567890")).not.toBeNull();
    expect(screen.getByText("order-1234567890")).not.toBeNull();
    expect(mocks.tableColumn).toHaveBeenCalledWith({ dataIndex: "total_amount", responsive: ["sm"] });
    expect(mocks.tableColumn).toHaveBeenCalledWith({ dataIndex: "created_at", responsive: ["md"] });
    expect(screen.getByText("Order ID")).not.toBeNull();
  });

  it("does not duplicate accessible text when an order ID is already short", () => {
    setupDashboardQueries({
      recentOrders: [
        {
          id: "order-1",
          total_amount: 10000,
          status: "shipped",
          created_at: "2026-04-01T00:00:00.000Z",
        },
      ],
    });

    render(<Dashboard />);

    expect(screen.getByText("order-1")).not.toBeNull();
    expect(screen.queryByLabelText("Full order ID: order-1")).toBeNull();
    expect(screen.queryAllByText("order-1")).toHaveLength(1);
  });

  it("keeps KPI cards honest while metric values are loading", () => {
    setupDashboardQueries({ kpiQuery: { isLoading: true } });

    render(<Dashboard />);

    expect(screen.getByText("Sales")).not.toBeNull();
    expect(screen.getByText("Orders")).not.toBeNull();
    expect(screen.getByText("Paid Order Rate")).not.toBeNull();
    expect(screen.getByText("Average Order Value")).not.toBeNull();
    expect(screen.getAllByTestId("statistic-loading").length).toBeGreaterThanOrEqual(4);
    expect(document.body.textContent).not.toContain(currencyFormatter.format(0));
  });

  it("queries low-stock SKUs with an exact active product count", () => {
    setupDashboardQueries();

    render(<Dashboard />);

    expect(mocks.useList).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: "products",
        pagination: { currentPage: 1, pageSize: 10 },
        filters: expect.arrayContaining([
          expect.objectContaining({
            field: "stock",
            operator: "lt",
            value: 10,
          }),
          expect.objectContaining({
            field: "is_active",
            operator: "eq",
            value: true,
          }),
        ]),
        meta: { count: "exact" },
      }),
    );
  });

  it("queries operational metrics from the aggregate RPC resource", () => {
    setupDashboardQueries();

    render(<Dashboard />);

    expect(mocks.useList).toHaveBeenCalledWith({
      resource: "admin_operational_metrics",
      pagination: { pageSize: 30 },
      filters: [
        { field: "granularity", operator: "eq", value: "day" },
        { field: "start_date", operator: "eq", value: "2026-03-17" },
        { field: "end_date", operator: "eq", value: "2026-04-15" },
      ],
      queryOptions: { staleTime: 60_000 },
    });
    expect(mocks.useList).toHaveBeenCalledWith({
      resource: "admin_operational_metrics",
      pagination: { pageSize: 30 },
      filters: [
        { field: "granularity", operator: "eq", value: "day" },
        { field: "start_date", operator: "eq", value: "2026-03-17" },
        { field: "end_date", operator: "eq", value: "2026-04-15" },
      ],
      queryOptions: { enabled: false, staleTime: 60_000 },
    });
  });

  it("updates operational metric filters when a new granularity is selected", () => {
    setupDashboardQueries();

    render(<Dashboard />);
    fireEvent.click(screen.getByRole("button", { name: "Weekly" }));

    expect(mocks.useList).toHaveBeenLastCalledWith({
      resource: "admin_operational_metrics",
      pagination: { pageSize: 12 },
      filters: [
        { field: "granularity", operator: "eq", value: "week" },
        { field: "start_date", operator: "eq", value: "2026-01-26" },
        { field: "end_date", operator: "eq", value: "2026-04-19" },
      ],
      queryOptions: { enabled: true, staleTime: 60_000 },
    });
  });

  it("keeps headline KPI cards on the fixed 30-day window when trend granularity changes", () => {
    setupDashboardQueries({
      kpiMetricRows: [
        createMonthlyMetricRow("2026-04-15", {
          order_count: 1,
          paid_order_count: 1,
          completed_order_count: 1,
          revenue: 10000,
        }),
      ],
      monthlyMetricRows: [
        createMonthlyMetricRow("2026-04-14", {
          order_count: 9,
          paid_order_count: 9,
          completed_order_count: 9,
          revenue: 900000,
        }),
      ],
      lowStockTotal: 0,
    });

    render(<Dashboard />);
    fireEvent.click(screen.getByRole("button", { name: "Weekly" }));

    const pageText = document.body.textContent ?? "";

    expect(pageText).toContain(`Sales${currencyFormatter.format(10000)}`);
    expect(pageText).toContain("Orders1");
    expect(mocks.useList).toHaveBeenCalledWith({
      resource: "admin_operational_metrics",
      pagination: { pageSize: 30 },
      filters: [
        { field: "granularity", operator: "eq", value: "day" },
        { field: "start_date", operator: "eq", value: "2026-03-17" },
        { field: "end_date", operator: "eq", value: "2026-04-15" },
      ],
      queryOptions: { staleTime: 60_000 },
    });
    expect(mocks.useList).toHaveBeenLastCalledWith({
      resource: "admin_operational_metrics",
      pagination: { pageSize: 12 },
      filters: [
        { field: "granularity", operator: "eq", value: "week" },
        { field: "start_date", operator: "eq", value: "2026-01-26" },
        { field: "end_date", operator: "eq", value: "2026-04-19" },
      ],
      queryOptions: { enabled: true, staleTime: 60_000 },
    });
  });

  it("switches back to day trend reusing KPI data without stale weekly rows", () => {
    setupDashboardQueries({
      kpiMetricRows: [
        createMonthlyMetricRow("2026-04-15", {
          order_count: 1,
          paid_order_count: 1,
          completed_order_count: 1,
          revenue: 10000,
        }),
      ],
      monthlyMetricRows: [
        createMonthlyMetricRow("2026-04-14", {
          order_count: 9,
          paid_order_count: 9,
          completed_order_count: 9,
          revenue: 900000,
        }),
      ],
      lowStockTotal: 0,
    });

    render(<Dashboard />);
    fireEvent.click(screen.getByRole("button", { name: "Weekly" }));
    fireEvent.click(screen.getByRole("button", { name: "Daily" }));

    const pageText = document.body.textContent ?? "";

    expect(pageText).toContain(`Sales${currencyFormatter.format(10000)}`);
    expect(pageText).toContain("Orders1");
    expect(mocks.useList).toHaveBeenCalledWith({
      resource: "admin_operational_metrics",
      pagination: { pageSize: 30 },
      filters: [
        { field: "granularity", operator: "eq", value: "day" },
        { field: "start_date", operator: "eq", value: "2026-03-17" },
        { field: "end_date", operator: "eq", value: "2026-04-15" },
      ],
      queryOptions: { staleTime: 60_000 },
    });
    expect(mocks.useList).toHaveBeenLastCalledWith({
      resource: "admin_operational_metrics",
      pagination: { pageSize: 30 },
      filters: [
        { field: "granularity", operator: "eq", value: "day" },
        { field: "start_date", operator: "eq", value: "2026-03-17" },
        { field: "end_date", operator: "eq", value: "2026-04-15" },
      ],
      queryOptions: { enabled: false, staleTime: 60_000 },
    });
  });

  it("renders dashboard KPI values from operational totals and exact low-stock count", () => {
    setupDashboardQueries();

    render(<Dashboard />);

    const pageText = document.body.textContent ?? "";

    expect(screen.getByText("Store Performance")).not.toBeNull();
    expect(screen.getAllByText("Sales").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Orders").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Paid Order Rate")).not.toBeNull();
    expect(screen.getByText("Average Order Value")).not.toBeNull();
    expect(screen.queryByText("Low-Stock Products")).toBeNull();
    expect(pageText).toContain(currencyFormatter.format(125000));
    expect(pageText).toContain("60%");
    expect(pageText).toContain(currencyFormatter.format(125000 / 3));
    expect(pageText).toContain("1");
    expect(screen.queryByText("Total Orders")).toBeNull();
    expect(screen.queryByText("Total Customers")).toBeNull();
    expect(screen.queryByText("Total Products")).toBeNull();
    expect(screen.queryByText("Total Revenue")).toBeNull();
    expect(screen.queryByText("dashboard.overview.title")).toBeNull();
    expect(screen.queryByText("dashboard.alerts.title")).toBeNull();
  });

  it("renders zero-denominator KPI values without NaN or Infinity", () => {
    setupDashboardQueries({ monthlyMetricRows: [createMonthlyMetricRow("2026-04-15")], lowStockTotal: 0 });

    render(<Dashboard />);

    const pageText = document.body.textContent ?? "";

    expect(pageText).toContain("Paid Order Rate0%");
    expect(pageText).toContain(`Average Order Value${currencyFormatter.format(0)}`);
    expect(pageText).not.toContain("NaN");
    expect(pageText).not.toContain("Infinity");
  });

  describe("operational alerts", () => {
    it("renders a no-risk state when KPI risks are clear and queries succeed", () => {
      setupDashboardQueries({ monthlyMetricRows: healthyMonthlyMetricRows, lowStockTotal: 0 });

      render(<Dashboard />);

      expect(screen.getByText("Needs Follow-Up")).not.toBeNull();
      expect(screen.getByText("No urgent queue items")).not.toBeNull();
      expect(screen.queryByText("Summary data loaded successfully, with no orders or stock items needing immediate follow-up.")).toBeNull();
      expect(screen.queryByText("Paid orders need fulfillment")).toBeNull();
      expect(screen.queryByText("Active low-stock SKUs")).toBeNull();
      expect(screen.queryByText("Summary unavailable")).toBeNull();
    });

    it("renders a neutral loading alert instead of no-risk while risk queries are pending", () => {
      setupDashboardQueries({
        monthlyMetricRows: healthyMonthlyMetricRows,
        monthlyQuery: { isLoading: true },
        lowStockQuery: { isLoading: true },
        lowStockTotal: 0,
      });

      render(<Dashboard />);

      expect(screen.getByText("Checking the follow-up queue")).not.toBeNull();
      expect(screen.queryByText("Summary and stock counts are still loading. Queue status will update shortly.")).toBeNull();
      expect(screen.queryByText("No urgent queue items")).toBeNull();
      expect(screen.queryByText("Summary data loaded successfully, with no orders or stock items needing immediate follow-up.")).toBeNull();
    });

    it("renders a generic metrics-error alert without raw thrown details", () => {
      setupDashboardQueries({
        monthlyMetricRows: healthyMonthlyMetricRows,
        kpiQuery: { isError: true, error: new Error("database host leaked") },
        lowStockTotal: 0,
      });

      render(<Dashboard />);

      expect(screen.getByText("Summary unavailable")).not.toBeNull();
      expect(screen.getAllByRole("alert").some((alert) => alert.textContent === "Failed to load order trends.")).toBe(true);
      expect(screen.getAllByText("Unavailable").length).toBeGreaterThanOrEqual(4);
      expect(screen.queryByText("database host leaked")).toBeNull();
      expect(document.body.textContent).not.toContain("database host leaked");
      expect(document.body.textContent).not.toContain("Paid Order Rate0%");
    });

    it("retries dashboard summary metrics from the error alert", () => {
      const refetchMetrics = vi.fn();

      setupDashboardQueries({
        monthlyMetricRows: healthyMonthlyMetricRows,
        kpiQuery: { isError: true, error: new Error("database host leaked"), refetch: refetchMetrics },
        lowStockTotal: 0,
      });

      render(<Dashboard />);
      fireEvent.click(screen.getAllByRole("button", { name: "Try again" })[0]);

      expect(refetchMetrics).toHaveBeenCalledTimes(1);
    });

    it("retries the active trend query when a selected non-daily period fails", () => {
      const refetchMetrics = vi.fn();
      const refetchTrend = vi.fn();

      setupDashboardQueries({
        kpiQuery: { refetch: refetchMetrics },
        monthlyQuery: { isError: true, error: new Error("weekly trend leaked"), refetch: refetchTrend },
        lowStockTotal: 0,
      });

      render(<Dashboard />);
      fireEvent.click(screen.getByRole("button", { name: "Weekly" }));
      fireEvent.click(screen.getAllByRole("button", { name: "Try again" })[0]);

      expect(refetchTrend).toHaveBeenCalledTimes(1);
      expect(refetchMetrics).not.toHaveBeenCalled();
      expect(document.body.textContent).not.toContain("weekly trend leaked");
    });

    it("shows table error states instead of healthy empty copy when dashboard tables fail", () => {
      setupDashboardQueries({
        monthlyMetricRows: healthyMonthlyMetricRows,
        recentOrders: [],
        lowStockProducts: [],
        lowStockTotal: 0,
        lowStockQuery: { isError: true, error: new Error("stock table leaked") },
      });
      mocks.useList.mockImplementation((params: { resource: string }) => {
        if (params.resource === "orders") {
          return {
            result: { data: [] },
            query: { isLoading: false, isError: true, error: new Error("orders table leaked") },
          };
        }

        if (params.resource === "products") {
          return {
            result: { data: [], total: 0 },
            query: { isLoading: false, isError: true, error: new Error("stock table leaked") },
          };
        }

        return {
          result: { data: healthyMonthlyMetricRows },
          query: { isLoading: false, isError: false, error: null },
        };
      });

      render(<Dashboard />);

      expect(screen.getByText("Couldn’t load recent orders")).not.toBeNull();
      expect(screen.getAllByText("Couldn’t load low-stock data").length).toBeGreaterThanOrEqual(1);
      expect(screen.queryByText("No orders yet")).toBeNull();
      expect(screen.queryByText("All stock levels OK")).toBeNull();
      expect(document.body.textContent).not.toContain("orders table leaked");
      expect(document.body.textContent).not.toContain("stock table leaked");
    });

    it("renders a paid-not-delivered warning when paid orders exceed delivered orders", () => {
      setupDashboardQueries({
        monthlyMetricRows: [
          createMonthlyMetricRow("2026-04-15", {
            order_count: 4,
            paid_order_count: 3,
            completed_order_count: 1,
            revenue: 30000,
          }),
        ],
        lowStockTotal: 0,
      });

      render(<Dashboard />);

      expect(screen.getByText("2 paid orders are pending delivery")).not.toBeNull();
      expect(screen.queryByText("No urgent queue items")).toBeNull();
    });

    it("renders a low-stock data error when the stock query fails", () => {
      setupDashboardQueries({
        monthlyMetricRows: healthyMonthlyMetricRows,
        lowStockQuery: { isError: true, error: new Error("stock table leaked") },
        lowStockTotal: 0,
      });

      render(<Dashboard />);

      expect(screen.getAllByText("Couldn’t load low-stock data").length).toBeGreaterThanOrEqual(2);
      expect(screen.queryByText("No urgent queue items")).toBeNull();
      expect(document.body.textContent).not.toContain("stock table leaked");
    });

    it("renders a low-stock warning when active SKU count is above zero", () => {
      setupDashboardQueries({ monthlyMetricRows: healthyMonthlyMetricRows, lowStockTotal: 2 });

      render(<Dashboard />);

      expect(screen.getByText("2 active products are low on stock")).not.toBeNull();
      expect(screen.queryByText("No urgent queue items")).toBeNull();
    });

    it("preserves recent order and low-stock query contracts plus View All navigation", () => {
      setupDashboardQueries();

      render(<Dashboard />);

      expect(mocks.useList).toHaveBeenCalledWith({
        resource: "orders",
        pagination: { currentPage: 1, pageSize: 5 },
        sorters: [{ field: "created_at", order: "desc" }],
        queryOptions: { staleTime: 60_000 },
      });
      expect(mocks.useList).toHaveBeenCalledWith(
        expect.objectContaining({
          resource: "products",
          pagination: { currentPage: 1, pageSize: 10 },
          sorters: [{ field: "stock", order: "asc" }],
          meta: { count: "exact" },
        }),
      );

      fireEvent.click(screen.getByRole("button", { name: "View all orders" }));
      fireEvent.click(screen.getByRole("button", { name: "View all products" }));

      expect(mocks.navigateList).toHaveBeenCalledWith("orders");
      expect(mocks.navigateList).toHaveBeenCalledWith("products");
    });
  });

  it("renders populated order trends with labels and the translated summary", () => {
    setupDashboardQueries();

    render(<Dashboard />);

    const pageText = document.body.textContent ?? "";

    expect(screen.getByText("Order Trends")).not.toBeNull();
    expect(screen.getByRole("radiogroup", { name: "Choose order trend period" })).not.toBeNull();
    expect(screen.getByRole("img", { name: "Order trend line chart: incoming, paid, and delivered orders" })).not.toBeNull();
    expect(screen.getByText("Incoming, paid, and delivered order counts for the selected period.")).not.toBeNull();
    expect(pageText).toContain("Daily");
    expect(pageText).toContain(currencyFormatter.format(125000));

  });

  it("renders the order trend loading state while the aggregate query is pending", () => {
    setupDashboardQueries({ kpiQuery: { isLoading: true } });

    render(<Dashboard />);

    expect(screen.getByText("Order Trends")).not.toBeNull();
    expect(screen.getByTestId("monthly-trend-skeleton")).not.toBeNull();
    expect(screen.getByText("Loading order trends...")).not.toBeNull();
    expect(mocks.line).not.toHaveBeenCalled();
  });

  it("renders the order trend empty state when no aggregate rows are returned", () => {
    setupDashboardQueries({ monthlyMetricRows: [] });

    render(<Dashboard />);

    expect(screen.getByText("No order trends are available yet.")).not.toBeNull();
    expect(screen.queryByTestId("monthly-trend-line")).toBeNull();
    expect(mocks.line).not.toHaveBeenCalled();
  });

  it("renders the order trend empty state when aggregate rows only have malformed bucket starts", () => {
    setupDashboardQueries({ monthlyMetricRows: [createMonthlyMetricRow("bad-date", { order_count: 5, paid_order_count: 4, completed_order_count: 3, revenue: 250000 })] });

    render(<Dashboard />);

    expect(screen.getByText("No order trends are available yet.")).not.toBeNull();
    expect(screen.queryByTestId("monthly-trend-line")).toBeNull();
    expect(mocks.line).not.toHaveBeenCalled();
  });

  it("renders the order trend error state without exposing failed query details", () => {
    setupDashboardQueries({
      monthlyMetricRows: [],
      kpiQuery: { isError: true, error: new Error("database host leaked") },
    });

    render(<Dashboard />);

    expect(screen.getByText("Summary unavailable")).not.toBeNull();
    expect(screen.getAllByRole("alert").some((alert) => alert.textContent === "Failed to load order trends.")).toBe(true);
    expect(screen.queryByText("database host leaked")).toBeNull();
    expect(mocks.line).not.toHaveBeenCalled();
  });

  it("renders zero-value aggregate rows as a chart with the zero summary instead of Empty", () => {
    setupDashboardQueries({ monthlyMetricRows: [createMonthlyMetricRow("2026-04-01")] });

    render(<Dashboard />);

    const pageText = document.body.textContent ?? "";

    expect(screen.getByText("All order trend figures are still zero.")).not.toBeNull();
    expect(screen.queryByText("No order trends are available yet.")).toBeNull();
    expect(screen.getByTestId("monthly-trend-line")).not.toBeNull();
    expect(pageText).toContain(currencyFormatter.format(0));
    expect(mocks.line.mock.calls[0]?.[0].data.every((point) => point.value === 0)).toBe(true);
  });

  it("keeps existing dashboard cards, tables, and navigation actions available", () => {
    setupDashboardQueries();

    render(<Dashboard />);

    expect(screen.getAllByText("Sales").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Orders").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Paid Order Rate")).not.toBeNull();
    expect(screen.getByText("Average Order Value")).not.toBeNull();
    expect(screen.queryByText("Low-Stock Products")).toBeNull();
    expect(screen.getByText("Recent Orders")).not.toBeNull();
    expect(screen.getByText("Handed to Courier")).not.toBeNull();
    expect(screen.queryByText("Low-Stock Products")).toBeNull();
    expect(screen.getAllByText("Low Stock").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Bandage")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "View all orders" }));
    fireEvent.click(screen.getByRole("button", { name: "View all products" }));

    expect(mocks.navigateList).toHaveBeenCalledWith("orders");
    expect(mocks.navigateList).toHaveBeenCalledWith("products");
  });
});
