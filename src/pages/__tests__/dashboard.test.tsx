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
  monthlyMetricRows?: OperationalMetricRow[];
  monthlyQuery?: Partial<DashboardQueryState>;
}

const mocks = vi.hoisted(() => {
  const useList = vi.fn();
  const translate = vi.fn((key: string) => {
    const translations: Record<string, string> = {
      "dashboard.totalOrders": "Total Orders",
      "dashboard.totalCustomers": "Total Customers",
      "dashboard.totalProducts": "Total Products",
      "dashboard.totalRevenue": "Total Revenue",
      "dashboard.recentOrders": "Recent Orders",
      "dashboard.viewAll": "View All",
      "dashboard.orderTotal": "Total",
      "dashboard.orderStatus": "Status",
      "dashboard.orderDate": "Date",
      "dashboard.lowStockAlerts": "Low Stock",
      "dashboard.productName": "Product",
      "dashboard.currentStock": "Stock",
      "dashboard.noRecentOrders": "No orders yet",
      "dashboard.noLowStock": "All stock levels OK",
      "dashboard.monthlyTrends.title": "Order trends",
      "dashboard.monthlyTrends.revenue": "Revenue",
      "dashboard.monthlyTrends.orderCount": "Incoming",
      "dashboard.monthlyTrends.paidOrders": "Paid",
      "dashboard.monthlyTrends.completedOrders": "Completed",
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

    return translations[key] ?? key;
  });
  const navigateList = vi.fn();
  const line = vi.fn<(props: LineMockProps) => void>();

  return {
    useList,
    translate,
    navigateList,
    line,
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
    title?: React.ReactNode;
    render?: (value: unknown, record: Record<string, unknown>) => React.ReactNode;
  }

  interface TableProps {
    children?: React.ReactNode;
    dataSource?: Record<string, unknown>[];
    locale?: { emptyText?: React.ReactNode };
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

  const TableComponent = ({ children, dataSource = [], locale }: TableProps) => (
    <div>
      {dataSource.length === 0 && locale?.emptyText ? <div>{locale.emptyText}</div> : null}
      {ReactModule.Children.map(children, (child) => {
        if (!ReactModule.isValidElement<TableColumnProps>(child)) {
          return child;
        }

        const { dataIndex, render: renderValue, title } = child.props;

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
    Alert: ({ message }: { message?: React.ReactNode }) => <div role="alert">{message}</div>,
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
      formatter,
    }: {
      title?: React.ReactNode;
      value?: React.ReactNode;
      formatter?: (value?: React.ReactNode) => React.ReactNode;
    }) => (
      <div>
        <span>{title}</span>
        <span>{formatter ? formatter(value) : value}</span>
      </div>
    ),
    Table,
    Tag: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
    Typography: {
      Paragraph: ({ children, id }: { children?: React.ReactNode; id?: string }) => <p id={id}>{children}</p>,
      Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
    },
    Button: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => (
      <button type="button" onClick={onClick}>{children}</button>
    ),
    Empty: ({ description }: { description?: React.ReactNode }) => <div>{description}</div>,
    Skeleton: () => <div data-testid="monthly-trend-skeleton" />,
    Space: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    Tooltip: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  };
});

vi.mock("@ant-design/icons", () => ({
  ShoppingCartOutlined: () => <span>cart</span>,
  UserOutlined: () => <span>user</span>,
  InboxOutlined: () => <span>inbox</span>,
  DollarOutlined: () => <span>dollar</span>,
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

const setupDashboardQueries = ({ monthlyMetricRows = populatedMonthlyMetricRows, monthlyQuery = {} }: DashboardQueryOptions = {}) => {
  mocks.useList.mockImplementation((params: { resource: string; meta?: Record<string, unknown>; pagination?: Record<string, unknown> }) => {
    if (params.resource === "orders" && params.meta?.count === "exact") {
      return { result: { total: 1 } };
    }

    if (params.resource === "profiles") {
      return { result: { total: 2 } };
    }

    if (params.resource === "products" && params.meta?.count === "exact") {
      return { result: { total: 3 } };
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
        result: { data: [{ id: "product-1", name: "Bandage", stock: 4 }] },
        query: { isLoading: false },
      };
    }

    if (params.resource === "admin_operational_metrics") {
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

  it("queries revenue using settled payment status", () => {
    setupDashboardQueries();

    render(<Dashboard />);

    expect(mocks.useList).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: "orders",
        pagination: { mode: "off" },
        filters: expect.arrayContaining([
          expect.objectContaining({
            field: "payment_status",
            operator: "eq",
            value: "settlement",
          }),
        ]),
        meta: { select: "total_amount" },
      }),
    );
  });

  it("queries operational metrics from the aggregate RPC resource", () => {
    setupDashboardQueries();

    render(<Dashboard />);

    expect(mocks.useList).toHaveBeenCalledWith({
      resource: "admin_operational_metrics",
      pagination: { pageSize: 12 },
      filters: [
        { field: "granularity", operator: "eq", value: "month" },
        { field: "start_date", operator: "eq", value: "2025-05-01" },
        { field: "end_date", operator: "eq", value: "2026-04-30" },
      ],
    });
  });

  it("updates operational metric filters when a new granularity is selected", () => {
    setupDashboardQueries();

    render(<Dashboard />);
    fireEvent.click(screen.getByRole("button", { name: "Daily" }));

    expect(mocks.useList).toHaveBeenLastCalledWith({
      resource: "admin_operational_metrics",
      pagination: { pageSize: 30 },
      filters: [
        { field: "granularity", operator: "eq", value: "day" },
        { field: "start_date", operator: "eq", value: "2026-03-17" },
        { field: "end_date", operator: "eq", value: "2026-04-15" },
      ],
    });
  });

  it("renders populated order trends with labels and the translated summary", () => {
    setupDashboardQueries();

    render(<Dashboard />);

    const pageText = document.body.textContent ?? "";

    expect(screen.getByText("Order trends")).not.toBeNull();
    expect(screen.getByRole("img", { name: "Order trend line chart: incoming, paid, and completed" })).not.toBeNull();
    expect(screen.getByText("Incoming, paid, and completed orders for the selected period.")).not.toBeNull();
    expect(pageText).toContain("Monthly");
    expect(pageText).toContain(currencyFormatter.format(125000));
    expect(pageText).toContain("Incoming: 5");
    expect(pageText).toContain("Paid: 3");
    expect(pageText).toContain("Completed: 2");
  });

  it("renders the order trend loading state while the aggregate query is pending", () => {
    setupDashboardQueries({ monthlyQuery: { isLoading: true } });

    render(<Dashboard />);

    expect(screen.getByText("Order trends")).not.toBeNull();
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
      monthlyQuery: { isError: true, error: new Error("database host leaked") },
    });

    render(<Dashboard />);

    expect(screen.getByRole("alert").textContent).toBe("Failed to load order trends.");
    expect(screen.queryByText("database host leaked")).toBeNull();
    expect(mocks.line).not.toHaveBeenCalled();
  });

  it("renders zero-value aggregate rows as a chart with the zero summary instead of Empty", () => {
    setupDashboardQueries({ monthlyMetricRows: [createMonthlyMetricRow("2026-04-01")] });

    render(<Dashboard />);

    const pageText = document.body.textContent ?? "";

    expect(screen.getByRole("alert").textContent).toBe("All order trend metrics are zero.");
    expect(screen.queryByText("No order trend data is available yet.")).toBeNull();
    expect(screen.getByTestId("monthly-trend-line")).not.toBeNull();
    expect(pageText).toContain(currencyFormatter.format(0));
    expect(mocks.line.mock.calls[0]?.[0].data.every((point) => point.value === 0)).toBe(true);
  });

  it("keeps existing dashboard cards, tables, and navigation actions available", () => {
    setupDashboardQueries();

    render(<Dashboard />);

    expect(screen.getByText("Total Orders")).not.toBeNull();
    expect(screen.getByText("Total Customers")).not.toBeNull();
    expect(screen.getByText("Total Products")).not.toBeNull();
    expect(screen.getByText("Total Revenue")).not.toBeNull();
    expect(screen.getByText("Recent Orders")).not.toBeNull();
    expect(screen.getByText("Handed to Courier")).not.toBeNull();
    expect(screen.getByText("Low Stock")).not.toBeNull();
    expect(screen.getByText("Bandage")).not.toBeNull();

    const viewAllButtons = screen.getAllByRole("button", { name: "View All" });
    fireEvent.click(viewAllButtons[0]);
    fireEvent.click(viewAllButtons[1]);

    expect(mocks.navigateList).toHaveBeenCalledWith("orders");
    expect(mocks.navigateList).toHaveBeenCalledWith("products");
  });
});
