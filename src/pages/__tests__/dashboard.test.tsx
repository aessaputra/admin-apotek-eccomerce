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
}

interface DashboardQueryState {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
}

interface DashboardQueryOptions {
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
      "dashboard.totalOrders": "Total Orders",
      "dashboard.totalCustomers": "Total Customers",
      "dashboard.totalProducts": "Total Products",
      "dashboard.totalRevenue": "Total Revenue",
      "dashboard.overview.title": "Operations Overview",
      "dashboard.overview.subtitle": "Monitor orders, sales, stock, and key items from the last 30 days.",
      "dashboard.kpis.revenue30d": "Sales Value",
      "dashboard.kpis.orders30d": "Incoming Orders",
      "dashboard.kpis.paymentSuccessRate": "Payment Rate",
      "dashboard.kpis.averageOrderValue": "Average Order",
      "dashboard.kpis.fulfillmentRisk": "Paid, Not Completed",
      "dashboard.kpis.lowStockSkus": "Low-Stock SKUs",
      "dashboard.alerts.title": "Follow-up Queue",
      "dashboard.alerts.metricsError.message": "Metrics unavailable",
      "dashboard.alerts.metricsError.description": "Some metrics could not be loaded. Review the trend panel and retry shortly.",
      "dashboard.alerts.lowStockError.message": "Couldn’t load low-stock data",
      "dashboard.alerts.lowStockError.description": "Refresh the dashboard or check your connection.",
      "dashboard.alerts.fulfillmentRisk.message": "{{count}} paid orders are not completed yet",
      "dashboard.alerts.fulfillmentRisk.description": "Open the orders list to continue fulfillment, shipping, or completion confirmation for paid orders.",
      "dashboard.alerts.lowStockRisk.message": "{{count}} active low-stock SKUs",
      "dashboard.alerts.lowStockRisk.description": "Active products below 10 units need restock review. Check the low-stock table for the most urgent SKUs.",
      "dashboard.alerts.noRisk.message": "No urgent queue items",
      "dashboard.alerts.noRisk.description": "Metrics loaded successfully, with no orders or stock items requiring immediate follow-up.",
      "dashboard.alerts.loading.message": "Checking the follow-up queue",
      "dashboard.alerts.loading.description": "Metrics and stock counts are still loading. Queue status will update shortly.",
      "dashboard.recentOrders": "Recent Orders",
      "dashboard.viewAll": "View All",
      "dashboard.orderTotal": "Total",
      "dashboard.orderStatus": "Status",
      "dashboard.orderDate": "Date",
      "dashboard.lowStockAlerts": "Stock to Replenish",
      "dashboard.productName": "Product",
      "dashboard.currentStock": "Stock",
      "dashboard.noRecentOrders": "No orders yet",
      "dashboard.noLowStock": "All stock levels OK",
      "dashboard.tables.recentOrdersAriaLabel": "Recent orders table",
      "dashboard.tables.lowStockAriaLabel": "Low stock products table",
      "dashboard.monthlyTrends.title": "Operational Trends",
      "dashboard.monthlyTrends.revenue": "Sales Value",
      "dashboard.monthlyTrends.orderCount": "Incoming Orders",
      "dashboard.monthlyTrends.paidOrders": "Paid",
      "dashboard.monthlyTrends.completedOrders": "Completed",
      "dashboard.monthlyTrends.dataTableLabel": "Order trend data table",
      "dashboard.monthlyTrends.periodColumn": "Period",
      "dashboard.monthlyTrends.incomingColumn": "Incoming",
      "dashboard.monthlyTrends.paidColumn": "Paid",
      "dashboard.monthlyTrends.completedColumn": "Completed",
      "dashboard.monthlyTrends.revenueColumn": "Revenue",
      "dashboard.monthlyTrends.latest12Months": "Latest 12 months",
      "dashboard.monthlyTrends.period.day": "Last 30 days",
      "dashboard.monthlyTrends.period.week": "Last 12 weeks",
      "dashboard.monthlyTrends.period.month": "Last 12 months",
      "dashboard.monthlyTrends.period.year": "Last 5 years",
      "dashboard.monthlyTrends.granularity.day": "Daily",
      "dashboard.monthlyTrends.granularity.week": "Weekly",
      "dashboard.monthlyTrends.granularity.month": "Monthly",
      "dashboard.monthlyTrends.granularity.year": "Yearly",
      "dashboard.monthlyTrends.loading": "Loading order trend data...",
      "dashboard.monthlyTrends.emptyDescription": "No order trend data is available yet.",
      "dashboard.monthlyTrends.errorMessage": "Failed to load order trends.",
      "dashboard.monthlyTrends.zeroValueSummary": "All order trend metrics are zero.",
      "dashboard.monthlyTrends.chartAriaLabel": "Order trend line chart: incoming, paid, and completed",
      "dashboard.monthlyTrends.chartDescription": "Incoming, paid, and completed orders for the selected period.",
      "orderStatus.shipped": "Handed to Courier",
    };

    const translated = translations[key] ?? fallback ?? key;

    return params?.count !== undefined ? translated.replace(/\{\{count\}\}/g, String(params.count)) : translated;
  });
  const navigateList = vi.fn();
  const line = vi.fn<(props: LineMockProps) => void>();
  const tableColumn = vi.fn<(props: { dataIndex?: string | readonly string[]; responsive?: readonly string[] }) => void>();

  return {
    useList,
    translate,
    navigateList,
    line,
    tableColumn,
  };
});

vi.mock("@refinedev/core", () => ({
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

  const Column = (_props: TableColumnProps) => null;
  const Table = Object.assign(TableComponent, { Column });

  return {
    Alert: ({ description, message, type }: { description?: React.ReactNode; message?: React.ReactNode; type?: string }) => (
      <div data-alert-type={type} role="alert">
        <div>{message}</div>
        {description ? <div>{description}</div> : null}
      </div>
    ),
    Card: ({ title, extra, children }: { title?: React.ReactNode; extra?: React.ReactNode; children?: React.ReactNode }) => (
      <section>
        <div>{title}</div>
        <div>{extra}</div>
        {children}
      </section>
    ),
    Col: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    Row: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    Radio: {
      Group: ({
        onChange,
        options,
        value,
      }: {
        onChange?: (event: { target: { value: string } }) => void;
        options?: { label: string; value: string }[];
        value?: string;
      }) => (
        <div>
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
      title,
      value,
      suffix,
      formatter,
    }: {
      title?: React.ReactNode;
      value?: React.ReactNode;
      suffix?: React.ReactNode;
      formatter?: (value?: React.ReactNode) => React.ReactNode;
    }) => (
      <div>
        <span>{title}</span>
        <span>{formatter ? formatter(value) : value}{suffix}</span>
      </div>
    ),
    Table,
    Tag: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
    Typography: {
      Paragraph: ({ children, id }: { children?: React.ReactNode; id?: string }) => <p id={id}>{children}</p>,
      Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
      Title: ({ children }: { children?: React.ReactNode }) => <h3>{children}</h3>,
    },
    Button: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => (
      <button type="button" onClick={onClick}>{children}</button>
    ),
    Empty: ({ description }: { description?: React.ReactNode }) => <div>{description}</div>,
    Skeleton: () => <div data-testid="monthly-trend-skeleton" />,
    Space: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    Tooltip: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    theme: {
      useToken: () => ({
        token: {
          borderRadiusLG: 8,
          colorBorderSecondary: "#d9d9d9",
          colorFillAlter: "#fafafa",
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
  CheckCircleOutlined: () => <span>check-circle</span>,
  ClockCircleOutlined: () => <span>clock-circle</span>,
  ShoppingCartOutlined: () => <span>cart</span>,
  UserOutlined: () => <span>user</span>,
  InboxOutlined: () => <span>inbox</span>,
  DollarOutlined: () => <span>dollar</span>,
  PercentageOutlined: () => <span>percentage</span>,
  WarningOutlined: () => <span>warning</span>,
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

  mocks.useList.mockImplementation((params: { resource: string; meta?: Record<string, unknown>; pagination?: Record<string, unknown>; filters?: { field: string; value?: unknown }[]; queryOptions?: { enabled?: boolean } }) => {
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
          data: [
            {
              id: "order-1",
              total_amount: 10000,
              status: "shipped",
              created_at: "2026-04-01T00:00:00.000Z",
            },
          ],
        },
        query: { isLoading: false },
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
    expect(mocks.tableColumn).toHaveBeenCalledWith({ dataIndex: "total_amount", responsive: ["sm"] });
    expect(mocks.tableColumn).toHaveBeenCalledWith({ dataIndex: "created_at", responsive: ["md"] });
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
    });
    expect(mocks.useList).toHaveBeenCalledWith({
      resource: "admin_operational_metrics",
      pagination: { pageSize: 30 },
      filters: [
        { field: "granularity", operator: "eq", value: "day" },
        { field: "start_date", operator: "eq", value: "2026-03-17" },
        { field: "end_date", operator: "eq", value: "2026-04-15" },
      ],
      queryOptions: { enabled: false },
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
      queryOptions: { enabled: true },
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

    expect(pageText).toContain(`Sales Value${currencyFormatter.format(10000)}`);
    expect(pageText).toContain("Incoming Orders1");
    expect(mocks.useList).toHaveBeenCalledWith({
      resource: "admin_operational_metrics",
      pagination: { pageSize: 30 },
      filters: [
        { field: "granularity", operator: "eq", value: "day" },
        { field: "start_date", operator: "eq", value: "2026-03-17" },
        { field: "end_date", operator: "eq", value: "2026-04-15" },
      ],
    });
    expect(mocks.useList).toHaveBeenLastCalledWith({
      resource: "admin_operational_metrics",
      pagination: { pageSize: 12 },
      filters: [
        { field: "granularity", operator: "eq", value: "week" },
        { field: "start_date", operator: "eq", value: "2026-01-26" },
        { field: "end_date", operator: "eq", value: "2026-04-19" },
      ],
      queryOptions: { enabled: true },
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

    expect(pageText).toContain(`Sales Value${currencyFormatter.format(10000)}`);
    expect(pageText).toContain("Incoming Orders1");
    expect(mocks.useList).toHaveBeenCalledWith({
      resource: "admin_operational_metrics",
      pagination: { pageSize: 30 },
      filters: [
        { field: "granularity", operator: "eq", value: "day" },
        { field: "start_date", operator: "eq", value: "2026-03-17" },
        { field: "end_date", operator: "eq", value: "2026-04-15" },
      ],
    });
    expect(mocks.useList).toHaveBeenLastCalledWith({
      resource: "admin_operational_metrics",
      pagination: { pageSize: 30 },
      filters: [
        { field: "granularity", operator: "eq", value: "day" },
        { field: "start_date", operator: "eq", value: "2026-03-17" },
        { field: "end_date", operator: "eq", value: "2026-04-15" },
      ],
      queryOptions: { enabled: false },
    });
  });

  it("renders dashboard KPI values from operational totals and exact low-stock count", () => {
    setupDashboardQueries();

    render(<Dashboard />);

    const pageText = document.body.textContent ?? "";

    expect(screen.getByText("Operations Overview")).not.toBeNull();
    expect(screen.getByText("Monitor orders, sales, stock, and key items from the last 30 days.")).not.toBeNull();
    expect(screen.getAllByText("Sales Value").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Incoming Orders").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Payment Rate")).not.toBeNull();
    expect(screen.getByText("Average Order")).not.toBeNull();
    expect(screen.getByText("Paid, Not Completed")).not.toBeNull();
    expect(screen.getByText("Low-Stock SKUs")).not.toBeNull();
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

    expect(pageText).toContain("Payment Rate0%");
    expect(pageText).toContain(`Average Order${currencyFormatter.format(0)}`);
    expect(pageText).not.toContain("NaN");
    expect(pageText).not.toContain("Infinity");
  });

  describe("operational alerts", () => {
    it("renders a no-risk state when KPI risks are clear and queries succeed", () => {
      setupDashboardQueries({ monthlyMetricRows: healthyMonthlyMetricRows, lowStockTotal: 0 });

      render(<Dashboard />);

      expect(screen.getByText("Follow-up Queue")).not.toBeNull();
      expect(screen.getByText("No urgent queue items")).not.toBeNull();
      expect(screen.queryByText("Metrics loaded successfully, with no orders or stock items requiring immediate follow-up.")).toBeNull();
      expect(screen.queryByText("Paid orders need fulfillment")).toBeNull();
      expect(screen.queryByText("Active low-stock SKUs")).toBeNull();
      expect(screen.queryByText("Metrics unavailable")).toBeNull();
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
      expect(screen.queryByText("Metrics and stock counts are still loading. Queue status will update shortly.")).toBeNull();
      expect(screen.queryByText("No urgent queue items")).toBeNull();
      expect(screen.queryByText("Metrics loaded successfully, with no orders or stock items requiring immediate follow-up.")).toBeNull();
    });

    it("renders a generic metrics-error alert without raw thrown details", () => {
      setupDashboardQueries({
        monthlyMetricRows: healthyMonthlyMetricRows,
        kpiQuery: { isError: true, error: new Error("database host leaked") },
        lowStockTotal: 0,
      });

      render(<Dashboard />);

      expect(screen.getByText("Metrics unavailable")).not.toBeNull();
      expect(screen.getByText("Some metrics could not be loaded. Review the trend panel and retry shortly.")).not.toBeNull();
      expect(screen.getAllByRole("alert").some((alert) => alert.textContent === "Failed to load order trends.")).toBe(true);
      expect(screen.queryByText("database host leaked")).toBeNull();
      expect(document.body.textContent).not.toContain("database host leaked");
    });

    it("renders a paid-not-fulfilled warning when paid orders exceed completed orders", () => {
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

      expect(screen.getByText("2 paid orders are not completed yet")).not.toBeNull();
      expect(screen.getByText("Open the orders list to continue fulfillment, shipping, or completion confirmation for paid orders.")).not.toBeNull();
      expect(screen.queryByText("No urgent queue items")).toBeNull();
    });

    it("renders a low-stock data error when the stock query fails", () => {
      setupDashboardQueries({
        monthlyMetricRows: healthyMonthlyMetricRows,
        lowStockQuery: { isError: true, error: new Error("stock table leaked") },
        lowStockTotal: 0,
      });

      render(<Dashboard />);

      expect(screen.getByText("Couldn’t load low-stock data")).not.toBeNull();
      expect(screen.getByText("Refresh the dashboard or check your connection.")).not.toBeNull();
      expect(screen.queryByText("No urgent queue items")).toBeNull();
      expect(document.body.textContent).not.toContain("stock table leaked");
    });

    it("renders a low-stock warning when active SKU count is above zero", () => {
      setupDashboardQueries({ monthlyMetricRows: healthyMonthlyMetricRows, lowStockTotal: 2 });

      render(<Dashboard />);

      expect(screen.getByText("2 active low-stock SKUs")).not.toBeNull();
      expect(screen.getByText("Active products below 10 units need restock review. Check the low-stock table for the most urgent SKUs.")).not.toBeNull();
      expect(screen.queryByText("No urgent queue items")).toBeNull();
    });

    it("preserves recent order and low-stock query contracts plus View All navigation", () => {
      setupDashboardQueries();

      render(<Dashboard />);

      expect(mocks.useList).toHaveBeenCalledWith({
        resource: "orders",
        pagination: { currentPage: 1, pageSize: 5 },
        sorters: [{ field: "created_at", order: "desc" }],
      });
      expect(mocks.useList).toHaveBeenCalledWith(
        expect.objectContaining({
          resource: "products",
          pagination: { currentPage: 1, pageSize: 10 },
          sorters: [{ field: "stock", order: "asc" }],
          meta: { count: "exact" },
        }),
      );

      const viewAllButtons = screen.getAllByRole("button", { name: "View All" });
      fireEvent.click(viewAllButtons[0]);
      fireEvent.click(viewAllButtons[1]);

      expect(mocks.navigateList).toHaveBeenCalledWith("orders");
      expect(mocks.navigateList).toHaveBeenCalledWith("products");
    });
  });

  it("renders populated order trends with labels and the translated summary", () => {
    setupDashboardQueries();

    render(<Dashboard />);

    const pageText = document.body.textContent ?? "";

    expect(screen.getByText("Operational Trends")).not.toBeNull();
    expect(screen.getByRole("img", { name: "Order trend line chart: incoming, paid, and completed" })).not.toBeNull();
    expect(screen.getByText("Incoming, paid, and completed orders for the selected period.")).not.toBeNull();
    expect(pageText).toContain("Daily");
    expect(pageText).toContain(currencyFormatter.format(125000));
    expect(pageText).toContain("Incoming Orders5");
    expect(pageText).toContain("Paid3");
    expect(pageText).toContain("Completed2");
  });

  it("renders the order trend loading state while the aggregate query is pending", () => {
    setupDashboardQueries({ kpiQuery: { isLoading: true } });

    render(<Dashboard />);

    expect(screen.getByText("Operational Trends")).not.toBeNull();
    expect(screen.getByTestId("monthly-trend-skeleton")).not.toBeNull();
    expect(screen.getByText("Loading order trend data...")).not.toBeNull();
    expect(mocks.line).not.toHaveBeenCalled();
  });

  it("renders the order trend empty state when no aggregate rows are returned", () => {
    setupDashboardQueries({ monthlyMetricRows: [] });

    render(<Dashboard />);

    expect(screen.getByText("No order trend data is available yet.")).not.toBeNull();
    expect(screen.queryByTestId("monthly-trend-line")).toBeNull();
    expect(mocks.line).not.toHaveBeenCalled();
  });

  it("renders the order trend empty state when aggregate rows only have malformed bucket starts", () => {
    setupDashboardQueries({ monthlyMetricRows: [createMonthlyMetricRow("bad-date", { order_count: 5, paid_order_count: 4, completed_order_count: 3, revenue: 250000 })] });

    render(<Dashboard />);

    expect(screen.getByText("No order trend data is available yet.")).not.toBeNull();
    expect(screen.queryByTestId("monthly-trend-line")).toBeNull();
    expect(mocks.line).not.toHaveBeenCalled();
  });

  it("renders the order trend error state without exposing failed query details", () => {
    setupDashboardQueries({
      monthlyMetricRows: [],
      kpiQuery: { isError: true, error: new Error("database host leaked") },
    });

    render(<Dashboard />);

    expect(screen.getByText("Metrics unavailable")).not.toBeNull();
    expect(screen.getAllByRole("alert").some((alert) => alert.textContent === "Failed to load order trends.")).toBe(true);
    expect(screen.queryByText("database host leaked")).toBeNull();
    expect(mocks.line).not.toHaveBeenCalled();
  });

  it("renders zero-value aggregate rows as a chart with the zero summary instead of Empty", () => {
    setupDashboardQueries({ monthlyMetricRows: [createMonthlyMetricRow("2026-04-01")] });

    render(<Dashboard />);

    const pageText = document.body.textContent ?? "";

    expect(screen.getByText("All order trend metrics are zero.")).not.toBeNull();
    expect(screen.queryByText("No order trend data is available yet.")).toBeNull();
    expect(screen.getByTestId("monthly-trend-line")).not.toBeNull();
    expect(pageText).toContain(currencyFormatter.format(0));
    expect(mocks.line.mock.calls[0]?.[0].data.every((point) => point.value === 0)).toBe(true);
  });

  it("keeps existing dashboard cards, tables, and navigation actions available", () => {
    setupDashboardQueries();

    render(<Dashboard />);

    expect(screen.getAllByText("Sales Value").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Incoming Orders").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Payment Rate")).not.toBeNull();
    expect(screen.getByText("Average Order")).not.toBeNull();
    expect(screen.getByText("Paid, Not Completed")).not.toBeNull();
    expect(screen.getByText("Low-Stock SKUs")).not.toBeNull();
    expect(screen.getByText("Recent Orders")).not.toBeNull();
    expect(screen.getByText("Handed to Courier")).not.toBeNull();
    expect(screen.getByText("Stock to Replenish")).not.toBeNull();
    expect(screen.getByText("Bandage")).not.toBeNull();

    const viewAllButtons = screen.getAllByRole("button", { name: "View All" });
    fireEvent.click(viewAllButtons[0]);
    fireEvent.click(viewAllButtons[1]);

    expect(mocks.navigateList).toHaveBeenCalledWith("orders");
    expect(mocks.navigateList).toHaveBeenCalledWith("products");
  });
});
