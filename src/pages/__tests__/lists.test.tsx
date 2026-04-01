import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CategoryList } from "../categories/list";
import { CustomerList } from "../customers/list";
import { OrderList } from "../orders/list";
import { ProductList } from "../products/list";

const mocks = vi.hoisted(() => {
  const translate = vi.fn((key: string) => key);
  const useTable = vi.fn();
  const handleBan = vi.fn();
  const handleUnban = vi.fn();

  return {
    translate,
    useTable,
    handleBan,
    handleUnban,
  };
});

vi.mock("@refinedev/core", () => ({
  useTranslation: () => ({ translate: mocks.translate }),
}));

vi.mock("../../hooks/useBanToggle", () => ({
  useBanToggle: () => ({
    handleBan: mocks.handleBan,
    handleUnban: mocks.handleUnban,
    isPending: false,
  }),
}));

vi.mock("@refinedev/antd", async () => {
  return {
    List: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    useTable: mocks.useTable,
    DateField: ({ value }: { value: string }) => <span>{value}</span>,
    ShowButton: ({ recordItemId, resource }: { recordItemId: string; resource?: string }) => (
      <button type="button">show:{resource ?? "default"}:{recordItemId}</button>
    ),
    EditButton: ({ recordItemId }: { recordItemId: string }) => <button type="button">edit:{recordItemId}</button>,
    DeleteButton: ({ recordItemId }: { recordItemId: string }) => <button type="button">delete:{recordItemId}</button>,
    FilterDropdown: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    getDefaultSortOrder: (field: string) => (field === "created_at" ? "descend" : "ascend"),
    getDefaultFilter: (field: string) => (field === "status" ? ["pending"] : field === "payment_status" ? ["settlement"] : undefined),
  };
});

vi.mock("antd", async () => {
  const ReactModule = await import("react");

  const Column = (props: Record<string, unknown>) =>
    ReactModule.createElement("mock-column", props as never);

  const resolveValue = (record: Record<string, unknown>, dataIndex: unknown): unknown => {
    if (Array.isArray(dataIndex)) {
      return dataIndex.reduce<unknown>((current, key) => {
        if (current == null) return undefined;
        if (typeof key === "number" && Array.isArray(current)) {
          return current[key];
        }
        if (typeof current === "object") {
          return (current as Record<string, unknown>)[String(key)];
        }
        return undefined;
      }, record);
    }

    if (typeof dataIndex === "string") {
      return record[dataIndex];
    }

    return undefined;
  };

  const Table = ({ dataSource = [], children }: { dataSource?: Record<string, unknown>[]; children: React.ReactNode }) => {
    const columns = ReactModule.Children.toArray(children).filter(ReactModule.isValidElement);

    return (
      <div data-testid="table">
        {columns.map((column, columnIndex) => {
          const props = column.props as Record<string, unknown>;
          const columnKey = String(column.key ?? props.dataIndex ?? props.title ?? `column-${columnIndex}`);
          const filterDropdown = props.filterDropdown as
            | ((props: Record<string, unknown>) => React.ReactNode)
            | undefined;

          return (
            <div key={columnKey} data-testid={columnKey}>
              <div>{String(props.title ?? "")}</div>
              {filterDropdown ? filterDropdown({}) : null}
              {dataSource.map((record, rowIndex) => {
                const render = props.render as
                  | ((value: unknown, record: Record<string, unknown>) => React.ReactNode)
                  | undefined;
                const value = resolveValue(record, props.dataIndex);
                const rowKey = String(record.id ?? `${columnKey}-${rowIndex}`);

                return (
                  <div key={`${columnKey}-${rowKey}`}>
                    {render ? render(value, record) : typeof value === "string" || typeof value === "number" ? String(value) : value == null ? "" : JSON.stringify(value)}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    );
  };

  Table.Column = Column;

  return {
    Table,
  Space: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Avatar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Input: ({ placeholder }: { placeholder?: string }) => <input placeholder={placeholder} readOnly />,
  Tooltip: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Tag: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Button: ({ children, onClick, loading }: { children: React.ReactNode; onClick?: () => void; loading?: boolean }) => (
    <button type="button" data-loading={String(Boolean(loading))} onClick={onClick}>
      {children}
    </button>
  ),
  Image: ({ src }: { src: string }) => <span>{src}</span>,
  Select: ({ placeholder }: { placeholder?: string }) => <select aria-label={placeholder ?? "select"} />,
  };
});

describe("list pages", () => {
  beforeEach(() => {
    mocks.translate.mockClear();
    mocks.useTable.mockReset();
    mocks.handleBan.mockReset();
    mocks.handleUnban.mockReset();
  });

  it("renders customer rows and triggers ban/unban actions", () => {
    mocks.useTable.mockReturnValue({
      tableProps: {
        dataSource: [
          {
            id: "cust-1",
            full_name: "Alice",
            avatar_url: null,
            phone_number: "08123",
            created_at: "2026-04-01",
            is_banned: false,
          },
          {
            id: "cust-2",
            full_name: "Bob",
            avatar_url: null,
            phone_number: "08234",
            created_at: "2026-04-02",
            is_banned: true,
          },
        ],
      },
      sorters: [],
    });

    render(<CustomerList />);

    expect(screen.getByText("Alice")).not.toBeNull();
    expect(screen.getByText("Bob")).not.toBeNull();
    expect(screen.getByText("customers.statusActive")).not.toBeNull();
    expect(screen.getByText("customers.statusBanned")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "customers.ban" }));
    fireEvent.click(screen.getByRole("button", { name: "customers.unban" }));

    expect(mocks.handleBan).toHaveBeenCalledWith(
      expect.objectContaining({ id: "cust-1", full_name: "Alice" })
    );
    expect(mocks.handleUnban).toHaveBeenCalledWith(
      expect.objectContaining({ id: "cust-2", full_name: "Bob" })
    );
  });

  it("renders product list values and row action buttons", () => {
    mocks.useTable.mockReturnValue({
      tableProps: {
        dataSource: [
          {
            id: "prod-1",
            product_images: [{ url: "https://example.com/image.png" }],
            name: "Vitamin C",
            slug: "vitamin-c",
            categories: { name: "Supplements" },
            price: 15000,
            stock: 5,
            weight: 200,
            is_active: true,
          },
        ],
      },
    });

    render(<ProductList />);

    expect(screen.getByText("Vitamin C")).not.toBeNull();
    expect(screen.getByText("vitamin-c")).not.toBeNull();
    expect(screen.getByText("Supplements")).not.toBeNull();
    expect(screen.getByText("Rp 15.000")).not.toBeNull();
    expect(screen.getByText("200 g")).not.toBeNull();
    expect(screen.getByText("products.active.yes")).not.toBeNull();
    expect(screen.getByText("show:default:prod-1")).not.toBeNull();
    expect(screen.getByText("edit:prod-1")).not.toBeNull();
    expect(screen.getByText("delete:prod-1")).not.toBeNull();
  });

  it("renders category list values and action buttons", () => {
    mocks.useTable.mockReturnValue({
      tableProps: {
        dataSource: [
          {
            id: "cat-1",
            logo_url: "https://example.com/logo.png",
            name: "Pain Relief",
            slug: "pain-relief",
          },
        ],
      },
    });

    render(<CategoryList />);

    expect(screen.getByText("Pain Relief")).not.toBeNull();
    expect(screen.getByText("pain-relief")).not.toBeNull();
    expect(screen.getByText("show:default:cat-1")).not.toBeNull();
    expect(screen.getByText("edit:cat-1")).not.toBeNull();
    expect(screen.getByText("delete:cat-1")).not.toBeNull();
  });

  it("renders order rows with filters, tags, and show action", () => {
    mocks.useTable.mockReturnValue({
      tableProps: {
        dataSource: [
          {
            id: "order-1",
            total_amount: 25000,
            status: "pending",
            payment_status: "settlement",
            payment_type: "bank_transfer",
            courier_code: "jne",
            waybill_number: "WB123",
            created_at: "2026-04-01T00:00:00.000Z",
          },
        ],
      },
      filters: [],
    });

    render(<OrderList />);

    expect(screen.getByText("order-1")).not.toBeNull();
    expect(screen.getByText("Rp 25.000")).not.toBeNull();
    expect(screen.getByText("pending")).not.toBeNull();
    expect(screen.getByText("settlement")).not.toBeNull();
    expect(screen.getByText("bank_transfer")).not.toBeNull();
    expect(screen.getByText("jne")).not.toBeNull();
    expect(screen.getByText("WB123")).not.toBeNull();
    expect(screen.getByText("show:orders:order-1")).not.toBeNull();
    expect(screen.getByLabelText("orders.filterStatus")).not.toBeNull();
    expect(screen.getByLabelText("orders.filterPayment")).not.toBeNull();
  });
});
