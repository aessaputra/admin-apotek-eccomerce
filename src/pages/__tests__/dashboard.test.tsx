import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Dashboard } from "../dashboard";

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
      "orderStatus.shipped": "Handed to Courier",
    };

    return translations[key] ?? key;
  });
  const navigateList = vi.fn();

  return {
    useList,
    translate,
    navigateList,
  };
});

vi.mock("@refinedev/core", () => ({
  useList: mocks.useList,
  useTranslation: () => ({ translate: mocks.translate }),
  useNavigation: () => ({ list: mocks.navigateList }),
}));

vi.mock("antd", async () => {
  const ReactModule = await import("react");

  const TableComponent = ({ children, dataSource = [] }: { children?: React.ReactNode; dataSource?: Record<string, unknown>[] }) => (
    <div>
      {ReactModule.Children.map(children, (child) => {
        if (!ReactModule.isValidElement<{ dataIndex?: string; render?: (value: unknown, record: Record<string, unknown>) => React.ReactNode }>(child)) {
          return child;
        }

        const dataIndex = child.props.dataIndex;
        const renderValue = child.props.render;

        return (
          <div>
            {dataSource.map((record) => {
              const value = dataIndex ? record[dataIndex] : undefined;
              return <div key={String(record.id)}>{renderValue ? renderValue(value, record) : String(value ?? "")}</div>;
            })}
          </div>
        );
      })}
    </div>
  );

  const Column = (_props: unknown) => null;
  const Table = Object.assign(TableComponent, { Column });

  return {
    Card: ({ title, extra, children }: { title?: React.ReactNode; extra?: React.ReactNode; children: React.ReactNode }) => <div><div>{title}</div><div>{extra}</div>{children}</div>,
    Col: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Row: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Statistic: ({ title, value }: { title?: React.ReactNode; value?: React.ReactNode }) => <div><span>{title}</span><span>{value}</span></div>,
    Table,
    Tag: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
    Typography: {
      Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
    },
    Button: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => <button type="button" onClick={onClick}>{children}</button>,
    Empty: ({ description }: { description?: React.ReactNode }) => <div>{description}</div>,
  };
});

vi.mock("@ant-design/icons", () => ({
  ShoppingCartOutlined: () => <span>cart</span>,
  UserOutlined: () => <span>user</span>,
  InboxOutlined: () => <span>inbox</span>,
  DollarOutlined: () => <span>dollar</span>,
  WarningOutlined: () => <span>warning</span>,
}));

describe("Dashboard", () => {
  beforeEach(() => {
    mocks.useList.mockReset();
    mocks.translate.mockClear();
    mocks.navigateList.mockReset();

    mocks.useList
      .mockReturnValueOnce({ result: { total: 1 } })
      .mockReturnValueOnce({ result: { total: 2 } })
      .mockReturnValueOnce({ result: { total: 3 } })
      .mockReturnValueOnce({ result: { data: [{ total_amount: 10000 }] } })
      .mockReturnValueOnce({
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
      })
      .mockReturnValueOnce({
        result: { data: [] },
        query: { isLoading: false },
      });
  });

  it("renders translated order status labels in recent orders", () => {
    render(<Dashboard />);

    expect(screen.getByText("Handed to Courier")).not.toBeNull();
    expect(screen.queryByText("shipped")).toBeNull();
  });
});
