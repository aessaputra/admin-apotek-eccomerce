import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CategoryShow } from "../categories/show";
import { CustomerShow } from "../customers/show";
import { Dashboard } from "../dashboard";
import { ProductShow } from "../products/show";

const mocks = vi.hoisted(() => {
  const translations: Record<string, string> = {};
  const translate = vi.fn((key: string) => translations[key] ?? key);
  const useShow = vi.fn();
  const useList = vi.fn();
  const list = vi.fn();
  const handleBan = vi.fn();
  const handleUnban = vi.fn();
  const useParams = vi.fn(() => ({ id: "cust-1" }));

  return {
    translate,
    translations,
    useShow,
    useList,
    list,
    handleBan,
    handleUnban,
    useParams,
  };
});

vi.mock("react-router", () => ({
  useParams: mocks.useParams,
}));

vi.mock("@refinedev/core", () => ({
  useTranslation: () => ({ translate: mocks.translate }),
  useShow: mocks.useShow,
  useList: mocks.useList,
  useNavigation: () => ({ list: mocks.list }),
}));

vi.mock("../../hooks/useBanToggle", () => ({
  useBanToggle: () => ({
    handleBan: mocks.handleBan,
    handleUnban: mocks.handleUnban,
    isPending: false,
  }),
}));

vi.mock("@refinedev/antd", async () => ({
  Show: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Edit: ({ children, title }: { children: React.ReactNode; title?: React.ReactNode }) => (
    <div>
      <div>{title}</div>
      {children}
    </div>
  ),
  DateField: ({ value }: { value?: string }) => <span>{value ?? "-"}</span>,
  NumberField: ({ value }: { value?: number | string }) => <span>{String(value ?? 0)}</span>,
}));

vi.mock("antd", async () => {
  const ReactModule = await import("react");

  const Column = (props: Record<string, unknown>) =>
    ReactModule.createElement("mock-column", props as never);

  const resolveValue = (record: Record<string, unknown>, dataIndex: unknown): unknown => {
    if (Array.isArray(dataIndex)) {
      return dataIndex.reduce<unknown>((current, key) => {
        if (current == null) return undefined;
        if (typeof key === "number" && Array.isArray(current)) return current[key];
        if (typeof current === "object") return (current as Record<string, unknown>)[String(key)];
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
      <div>
        {columns.map((column, columnIndex) => {
          const props = column.props as Record<string, unknown>;
          const columnKey = String(column.key ?? props.dataIndex ?? props.title ?? `column-${columnIndex}`);

          return (
            <div key={columnKey}>
              <div>{String(props.title ?? "")}</div>
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
    Typography: {
      Title: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
      Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
      Paragraph: ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
        <p style={style}>{children}</p>
      ),
    },
    Avatar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Space: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Tag: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
    Button: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
      <button type="button" onClick={onClick}>{children}</button>
    ),
    Image: ({ src }: { src: string }) => <span>{src}</span>,
    Card: ({ title, extra, children }: { title?: React.ReactNode; extra?: React.ReactNode; children: React.ReactNode }) => (
      <div>
        <div>{title}</div>
        <div>{extra}</div>
        {children}
      </div>
    ),
    Col: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Row: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Statistic: ({ title, value }: { title: React.ReactNode; value: React.ReactNode }) => (
      <div>{title}:{String(value)}</div>
    ),
    Table,
    Empty: ({ description }: { description: React.ReactNode }) => <div>{description}</div>,
  };
});

describe("detail and dashboard pages", () => {
  const mockCustomerShow = (record: Record<string, unknown>) => {
    mocks.useShow.mockReturnValue({
      result: {
        avatar_url: null,
        full_name: "Alice",
        phone_number: "08123",
        role: "customer",
        is_banned: false,
        created_at: "2026-04-01",
        ...record,
      },
      query: { isLoading: false },
    });
  };

  beforeEach(() => {
    Object.keys(mocks.translations).forEach((key) => {
      delete mocks.translations[key];
    });
    mocks.translate.mockClear();
    mocks.useShow.mockReset();
    mocks.useList.mockReset();
    mocks.list.mockReset();
    mocks.handleBan.mockReset();
    mocks.handleUnban.mockReset();
    mocks.useParams.mockReset();
    mocks.useParams.mockReturnValue({ id: "cust-1" });
  });

  it("renders customer details and ban action for active customers", () => {
    mocks.useShow.mockReturnValue({
      result: {
        avatar_url: null,
        full_name: "Alice",
        phone_number: "08123",
        email: "alice@example.com",
        role: "customer",
        is_banned: false,
        created_at: "2026-04-01",
      },
      query: { isLoading: false },
    });

    render(<CustomerShow />);

    expect(screen.getAllByText("Alice").length).toBeGreaterThan(0);
    expect(screen.getByText("08123")).not.toBeNull();
    expect(screen.getByText("alice@example.com")).not.toBeNull();
    expect(screen.getByText("customer")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "customers.ban" }));
    expect(mocks.handleBan).toHaveBeenCalledWith({ id: "cust-1", full_name: "Alice" });
  });

  it.each([
    ["null", null],
    ["missing", undefined],
    ["blank", "   "],
  ])("renders the English missing-email fallback when customer email is %s", (_, email) => {
    mocks.translations["customers.emailFallback"] = "Not provided";
    const record = email === undefined ? {} : { email };
    mockCustomerShow(record);

    render(<CustomerShow />);

    expect(screen.getByText("Not provided")).not.toBeNull();
  });

  it("renders the Indonesian missing-email fallback through the translation mock", () => {
    mocks.translations["customers.emailFallback"] = "Belum tersedia";
    mockCustomerShow({ email: null });

    render(<CustomerShow />);

    expect(screen.getByText("Belum tersedia")).not.toBeNull();
  });

  it("renders product detail content including images and status", () => {
    mocks.useShow.mockReturnValue({
        result: {
          name: "Vitamin C",
          sku: "SUPP-VITAMIN-C-1000-AB12",
          slug: "vitamin-c",
        description: "Immune support",
        price: 15000,
        stock: 5,
        weight: 200,
        is_active: true,
        created_at: "2026-04-01T00:00:00.000Z",
        categories: { name: "Supplements" },
        product_images: [
          { id: "img-1", url: "https://example.com/one.png", sort_order: 2 },
          { id: "img-2", url: "https://example.com/two.png", sort_order: 1 },
        ],
      },
      query: { isLoading: false },
    });

    render(<ProductShow />);

    expect(screen.getByText("Vitamin C")).not.toBeNull();
    expect(screen.getByText("SUPP-VITAMIN-C-1000-AB12")).not.toBeNull();
    expect(screen.getByText("vitamin-c")).not.toBeNull();
    expect(screen.getByText("Immune support")).not.toBeNull();
    expect(screen.getByText("Supplements")).not.toBeNull();
    expect(screen.getByText("products.status.active")).not.toBeNull();
    expect(screen.getByText("https://example.com/two.png")).not.toBeNull();
  });

  it("preserves line breaks for long plain-text product descriptions", () => {
    mocks.useShow.mockReturnValue({
        result: {
          name: "Vitamin C",
          sku: "SUPP-VITAMIN-C-1000-AB12",
          slug: "vitamin-c",
        description: "Line 1\n\nLine 2",
        price: 15000,
        stock: 5,
        weight: 200,
        is_active: true,
        categories: { name: "Supplements" },
        product_images: [],
      },
      query: { isLoading: false },
    });

    render(<ProductShow />);

    const descriptionParagraph = screen.getByText((_, element) => {
      return element?.tagName === "P" && element.textContent === "Line 1\n\nLine 2";
    });
    expect(descriptionParagraph.tagName).toBe("P");
    expect((descriptionParagraph as HTMLElement).style.whiteSpace).toBe("pre-wrap");
    expect((descriptionParagraph as HTMLElement).style.marginBottom).toBe("0px");
  });

  it("renders category details with logo and created date", () => {
    mocks.useShow.mockReturnValue({
      result: {
        name: "Pain Relief",
        slug: "pain-relief",
        logo_url: "https://example.com/logo.png",
        created_at: "2026-04-01T00:00:00.000Z",
      },
      query: { isLoading: false },
    });

    render(<CategoryShow />);

    expect(screen.getByText("Pain Relief")).not.toBeNull();
    expect(screen.getByText("pain-relief")).not.toBeNull();
    expect(screen.getByText("https://example.com/logo.png")).not.toBeNull();
  });

  it("renders dashboard stats, recent orders, low stock products, and navigation actions", () => {
    mocks.useList.mockImplementation((args: { resource: string; filters?: Array<{ field: string; value: unknown }>; meta?: Record<string, unknown>; pagination?: Record<string, unknown> }) => {
      if (args.resource === "orders" && args.meta?.count === "exact") {
        return { result: { total: 10 } };
      }
      if (args.resource === "profiles") {
        return { result: { total: 5 } };
      }
      if (args.resource === "products" && args.meta?.count === "exact") {
        return { result: { total: 8 } };
      }
      if (args.resource === "orders" && args.pagination?.mode === "off") {
        return { result: { data: [{ total_amount: 10000 }, { total_amount: 15000 }] } };
      }
      if (args.resource === "orders") {
        return {
          result: {
            data: [
              { id: "order-1", total_amount: 25000, status: "pending", created_at: "2026-04-01T00:00:00.000Z" },
            ],
          },
          query: { isLoading: false },
        };
      }
      return {
        result: {
          data: [{ id: "prod-1", name: "Vitamin C", stock: 2 }],
        },
        query: { isLoading: false },
      };
    });

    render(<Dashboard />);

    expect(screen.getByText("dashboard.totalOrders:10")).not.toBeNull();
    expect(screen.getByText("dashboard.totalCustomers:5")).not.toBeNull();
    expect(screen.getByText("dashboard.totalProducts:8")).not.toBeNull();
    expect(screen.getByText("dashboard.totalRevenue:25000")).not.toBeNull();
    expect(screen.getByText("order-1")).not.toBeNull();
    expect(screen.getByText("Vitamin C")).not.toBeNull();

    fireEvent.click(screen.getAllByRole("button", { name: "dashboard.viewAll" })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "dashboard.viewAll" })[1]);

    expect(mocks.list).toHaveBeenCalledWith("orders");
    expect(mocks.list).toHaveBeenCalledWith("products");
  });
});
