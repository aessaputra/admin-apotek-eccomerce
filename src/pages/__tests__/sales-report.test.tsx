import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SalesReport } from "../reports/sales";

const mocks = vi.hoisted(() => {
  const translate = vi.fn((key: string, fallback?: string) => fallback ?? key);
  const useList = vi.fn();
  const dayStart = "2026-04-01T00:00:00.000Z";
  const dayEnd = "2026-04-30T23:59:59.999Z";

  return {
    translate,
    useList,
    dayStart,
    dayEnd,
  };
});

vi.mock("@refinedev/core", () => ({
  useTranslation: () => ({ translate: mocks.translate }),
  useList: mocks.useList,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "id" } }),
}));

vi.mock("antd", () => {
  const Table = ({ dataSource = [], columns = [], locale, loading }: { dataSource?: Record<string, unknown>[]; columns?: Array<{ title?: React.ReactNode; dataIndex?: string; render?: (value: unknown) => React.ReactNode }>; locale?: { emptyText?: React.ReactNode }; loading?: boolean }) => (
    <div>
      <div>{loading ? "loading" : "ready"}</div>
      {dataSource.length === 0 ? <div>{locale?.emptyText}</div> : null}
      {columns.map((column) => (
        <div key={String(column.title)}>
          <div>{column.title}</div>
          {dataSource.map((record) => {
            const value = column.dataIndex ? record[column.dataIndex] : undefined;
            return <div key={String(record.id ?? record.sale_date ?? record.product_id ?? record.user_id)}>{column.render ? column.render(value) : String(value ?? "")}</div>;
          })}
        </div>
      ))}
    </div>
  );

  return {
    Card: ({ title, children }: { title?: React.ReactNode; children: React.ReactNode }) => <div><div>{title}</div>{children}</div>,
    Col: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Row: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DatePicker: {
      RangePicker: ({ onChange, placeholder }: { onChange: (value: unknown) => void; placeholder?: [string, string] }) => (
        <button
          type="button"
          aria-label={placeholder?.join("-") ?? "range-picker"}
          onClick={() =>
            onChange([
              {
                startOf: () => ({ toISOString: () => mocks.dayStart }),
                endOf: () => ({ toISOString: () => mocks.dayEnd }),
              },
              {
                startOf: () => ({ toISOString: () => mocks.dayStart }),
                endOf: () => ({ toISOString: () => mocks.dayEnd }),
              },
            ])
          }
        >
          range
        </button>
      ),
    },
    Table,
    Typography: {
      Title: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
      Text: ({ children, strong }: { children: React.ReactNode; strong?: boolean }) => strong ? <strong>{children}</strong> : <span>{children}</span>,
    },
  };
});

describe("SalesReport", () => {
  beforeEach(() => {
    mocks.translate.mockClear();
    mocks.useList.mockReset();
  });

  const mockQueryResult = (data: Record<string, unknown>[]) => ({
    result: { data },
    query: { isLoading: false },
  });

  const mockSalesReportHooks = ({
    daily = [],
    topProducts = [],
    soldProducts = [],
    customers = [],
  }: {
    daily?: Record<string, unknown>[];
    topProducts?: Record<string, unknown>[];
    soldProducts?: Record<string, unknown>[];
    customers?: Record<string, unknown>[];
  } = {}) => {
    mocks.useList
      .mockReturnValueOnce(mockQueryResult(daily))
      .mockReturnValueOnce(mockQueryResult(topProducts))
      .mockReturnValueOnce(mockQueryResult(soldProducts))
      .mockReturnValueOnce(mockQueryResult(customers));
  };

  it("renders report sections, formatted values, and empty states", () => {
    mockSalesReportHooks({
      daily: [{ sale_date: "2026-04-01T00:00:00.000Z", orders_count: 2, total_revenue: 15000, average_order_value: 7500 }],
      soldProducts: [{ id: "item-1", product_name: "Paracetamol", quantity: 2, unit_price: 15000, subtotal: 30000 }],
      customers: [{ user_id: "user-1", full_name: "Alice", phone_number: "08123", orders_count: 3, total_revenue: 20000 }],
    });

    render(<SalesReport />);

    expect(screen.getByText("Laporan Penjualan")).not.toBeNull();
    expect(screen.getByText("Ringkasan Penjualan Harian")).not.toBeNull();
    expect(screen.getByText("Produk Terlaris")).not.toBeNull();
    expect(screen.getByText("Product Terjual")).not.toBeNull();
    expect(screen.getByText("Customer Terbesar")).not.toBeNull();
    expect(screen.getAllByText("Produk").length).toBeGreaterThan(0);
    expect(screen.getByText("Jumlah")).not.toBeNull();
    expect(screen.getByText("Harga Satuan")).not.toBeNull();
    expect(screen.getByText("Subtotal")).not.toBeNull();
    expect(screen.getByText("Paracetamol")).not.toBeNull();
    expect(screen.getAllByText("2").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Rp\s*15\.000/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Rp\s*30\.000/)).not.toBeNull();
    expect(screen.getAllByText(/Rp/).length).toBeGreaterThan(0);
    expect(screen.getByText("Belum ada data penjualan produk")).not.toBeNull();
    expect(screen.getByText("Alice")).not.toBeNull();
  });

  it("renders the sold-products empty state without affecting other sections", () => {
    mockSalesReportHooks({
      daily: [{ sale_date: "2026-04-01T00:00:00.000Z", orders_count: 1, total_revenue: 10000, average_order_value: 10000 }],
      topProducts: [{ product_id: "product-1", product_name: "Amoxicillin", category_name: "Antibiotik", total_qty_sold: 4, total_revenue: 60000 }],
      soldProducts: [],
      customers: [{ user_id: "user-1", full_name: "Alice", phone_number: "08123", orders_count: 3, total_revenue: 20000 }],
    });

    render(<SalesReport />);

    expect(screen.getByText("Product Terjual")).not.toBeNull();
    expect(screen.getByText("Belum ada data produk terjual")).not.toBeNull();
    expect(screen.getByText("Ringkasan Penjualan Harian")).not.toBeNull();
    expect(screen.getByText("Produk Terlaris")).not.toBeNull();
    expect(screen.getByText("Customer Terbesar")).not.toBeNull();
  });

  it("renders localized fallback for sold products without a product name", () => {
    mockSalesReportHooks({
      soldProducts: [{ id: "item-missing", product_name: null, quantity: 1, unit_price: 0, subtotal: 0 }],
    });

    render(<SalesReport />);

    expect(screen.getByText("Produk tidak tersedia")).not.toBeNull();
    expect(screen.queryByText("null")).toBeNull();
    expect(screen.queryByText("undefined")).toBeNull();
  });

  it("rebuilds daily report filters when the date range changes", async () => {
    mocks.useList.mockReturnValue({ result: { data: [] }, query: { isLoading: false } });

    render(<SalesReport />);

    fireEvent.click(screen.getByRole("button", { name: "Dari tanggal-Sampai tanggal" }));

    await act(async () => {});

    const latestCalls = mocks.useList.mock.calls.slice(-4).map(([params]) => params);

    expect(latestCalls[0]).toEqual(
      expect.objectContaining({
        resource: "report_daily_sales",
        filters: [
          { field: "sale_date", operator: "gte", value: mocks.dayStart },
          { field: "sale_date", operator: "lte", value: mocks.dayEnd },
        ],
      })
    );

    expect(latestCalls[2]).toEqual(
      expect.objectContaining({
        resource: "report_sold_products",
        filters: [
          { field: "sale_date", operator: "gte", value: mocks.dayStart },
          { field: "sale_date", operator: "lte", value: mocks.dayEnd },
        ],
        pagination: { pageSize: 10 },
      })
    );
  });
});
