import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CategoryShow } from "../categories/show";
import { CustomerShow } from "../customers/show";
import { Dashboard } from "../dashboard";
import { ProductShow } from "../products/show";

const mocks = vi.hoisted(() => {
  const translations: Record<string, string> = {};
  const translate = vi.fn((key: string, params?: Record<string, string>) => {
    const message = translations[key] ?? key;

    return params?.name ? message.replace("{{name}}", params.name) : message;
  });
  const useShow = vi.fn();
  const useList = vi.fn();
  const list = vi.fn();
  const navigate = vi.fn();
  const handleBan = vi.fn();
  const handleUnban = vi.fn();
  const useParams = vi.fn<() => { id?: string }>();
  useParams.mockReturnValue({ id: "cust-1" });

  return {
    translate,
    translations,
    useShow,
    useList,
    list,
    navigate,
    handleBan,
    handleUnban,
    useParams,
  };
});

vi.mock("react-router", () => ({
  useParams: mocks.useParams,
  useNavigate: () => mocks.navigate,
}));

vi.mock("@refinedev/core", () => ({
  useGetLocale: () => () => "id",
  useTranslation: () => ({ translate: mocks.translate }),
  useShow: mocks.useShow,
  useList: mocks.useList,
  useNavigation: () => ({ list: mocks.list }),
  useGo: () => vi.fn(),
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

vi.mock("@ant-design/charts", () => ({
  Line: () => <div data-testid="line-chart" />,
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

  type MockSpaceProps = React.HTMLAttributes<HTMLDivElement> & {
    children: React.ReactNode;
    direction?: string;
    size?: unknown;
    wrap?: boolean;
  };

  const Space = (props: MockSpaceProps) => {
    const { children, ...domProps } = props;

    delete domProps.direction;
    delete domProps.size;
    delete domProps.wrap;

    return <div {...domProps}>{children}</div>;
  };

  const Descriptions = Object.assign(
    ({ children, column }: { children: React.ReactNode; column?: number | Record<string, number> }) => (
      <div data-descriptions-column={typeof column === "number" ? String(column) : JSON.stringify(column)}>{children}</div>
    ),
    {
      Item: ({ label, children, span }: { label: React.ReactNode; children: React.ReactNode; span?: number }) => (
        <div data-description-item data-span={span}>
          <div>{label}</div>
          <div>{children}</div>
        </div>
      ),
    }
  );

  const Empty = Object.assign(
    ({ description }: { description: React.ReactNode }) => <div>{description}</div>,
    { PRESENTED_IMAGE_SIMPLE: "simple" }
  );

  return {
    Typography: {
      Title: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
      Text: ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => <span style={style}>{children}</span>,
      Paragraph: ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
        <p style={style}>{children}</p>
      ),
    },
    Avatar: ({ children, alt, src }: { children: React.ReactNode; alt?: string; src?: string }) => (
      src ? <img alt={alt} src={src} /> : <div>{children}</div>
    ),
    Space,
    Tag: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
    Button: ({ children, disabled, onClick, style, ...rest }: { children?: React.ReactNode; disabled?: boolean; onClick?: () => void; style?: React.CSSProperties; [key: string]: unknown }) => (
      <button type="button" disabled={disabled} style={style} onClick={onClick} {...rest}>{children}</button>
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
    Radio: {
      Group: ({ options, value }: { options?: { label: string; value: string }[]; value?: string }) => (
        <div>
          {options?.map((option) => (
            <button aria-pressed={option.value === value} key={option.value} type="button">
              {option.label}
            </button>
          ))}
        </div>
      ),
    },
    Statistic: ({ title, value }: { title: React.ReactNode; value: React.ReactNode }) => (
      <div>{title}:{String(value)}</div>
    ),
    Tooltip: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Alert: ({ message, description }: { message?: React.ReactNode; description?: React.ReactNode }) => <div role="alert">{message}{description}</div>,
    Skeleton: (props: React.HTMLAttributes<HTMLDivElement> & { active?: boolean; paragraph?: unknown; title?: unknown }) => {
      const domProps = { ...props };

      delete domProps.active;
      delete domProps.paragraph;
      delete domProps.title;

      return <div {...domProps} data-testid="skeleton" />;
    },
    Table,
    Descriptions,
    Empty,
    List: Object.assign(
      ({ children, renderItem, dataSource }: { children?: React.ReactNode; renderItem?: (item: any) => React.ReactNode; dataSource?: any[] }) => (
        <div>
          {dataSource && renderItem ? dataSource.map((item, i) => <div key={item.id ?? i}>{renderItem(item)}</div>) : children}
        </div>
      ),
      {
        Item: Object.assign(
          ({ children, extra }: { children?: React.ReactNode; extra?: React.ReactNode }) => (
            <div>
              {children}
              {extra}
            </div>
          ),
          { Meta: ({ title }: { title?: React.ReactNode }) => <div>{title}</div> }
        )
      }
    ),
    Grid: {
      useBreakpoint: () => ({ xs: false, sm: true, md: true, lg: true, xl: true, xxl: true }),
    },
    theme: {
      useToken: () => ({
        token: {
          borderRadiusLG: 8,
          colorBorderSecondary: "#d9d9d9",
          colorFillAlter: "#fafafa",
          colorFillQuaternary: "#f5f5f5",
          colorWarning: "#faad14",
          controlHeightLG: 40,
          fontSizeHeading3: 24,
          fontSizeHeading4: 20,
          fontSizeLG: 16,
          fontSizeSM: 12,
          fontWeightStrong: 600,
          lineWidth: 1,
          marginLG: 24,
          marginMD: 16,
          marginSM: 12,
          marginXS: 8,
          marginXXS: 4,
          paddingLG: 24,
          paddingMD: 16,
          paddingSM: 12,
        },
      }),
    },
  };
});

describe("detail and dashboard pages", () => {
  const customerDetailTranslations: Record<string, string> = {
    "customers.detail.unavailable": "Belum tersedia",
    "customers.detail.unknown": "Pelanggan tidak dikenal",
    "customers.emailFallback": "Belum tersedia",
    "customers.detail.profileInfo": "Profil pelanggan",
    "customers.detail.accountStatus": "Status akun",
    "customers.detail.recentOrders": "Pesanan terbaru",
    "customers.detail.back": "Kembali",
    "customers.detail.active": "Aktif",
    "customers.detail.banned": "Diblokir",
    "customers.detail.blockAccount": "Blokir akun",
    "customers.detail.unblockAccount": "Buka blokir akun",
    "customers.detail.viewAllTransactions": "Lihat Semua Transaksi",
    "customers.detail.avatarAlt": "Foto profil {{name}}",
    "customers.detail.viewOrder": "Lihat Pesanan",
    "customers.detail.orders.error": "Pesanan terbaru belum dapat dimuat",
    "customers.detail.orders.loading": "Memuat pesanan...",
    "customers.detail.orders.empty.title": "Belum ada pesanan",
    "customers.detail.orders.empty.description": "Pelanggan ini belum memiliki pesanan.",
    "customers.detail.email": "Email",
    "customers.detail.phone": "Nomor telepon",
    "customers.detail.joinedDate": "Tanggal bergabung",
    "customers.detail.customerId": "ID pelanggan",
    "customers.fields.fullName": "Nama lengkap",
    "customers.fields.role": "Peran",
    "customers.fields.status": "Status",
  };

  const seedCustomerDetailTranslations = () => {
    Object.assign(mocks.translations, customerDetailTranslations);
  };

  const mockRecentOrders = ({
    data = [],
    isLoading = false,
    isError = false,
  }: {
    data?: Record<string, unknown>[];
    isLoading?: boolean;
    isError?: boolean;
  } = {}) => {
    mocks.useList.mockReturnValue({
      result: { data },
      query: { isLoading, isError },
    });
  };

  const mockCustomerShow = (record: Record<string, unknown> = {}) => {
    mocks.useShow.mockReturnValue({
      result: {
        id: "customer-123",
        avatar_url: null,
        full_name: "Alice",
        phone_number: "08123",
        email: "alice@example.com",
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
    mocks.navigate.mockReset();
    mocks.handleBan.mockReset();
    mocks.handleUnban.mockReset();
    mocks.useParams.mockReset();
    mocks.useParams.mockReturnValue({ id: "customer-123" });
    seedCustomerDetailTranslations();
    mockRecentOrders();
  });

  it("renders customer profile, localized active action, and recent-order query", () => {
    mockCustomerShow();

    const { container } = render(<CustomerShow />);

    expect(screen.getByText("Profil pelanggan")).not.toBeNull();
    expect(screen.getByText("Status akun")).not.toBeNull();
    expect(screen.getByText("Pesanan terbaru")).not.toBeNull();
    expect(screen.getByText("Nama lengkap")).not.toBeNull();
    expect(screen.getAllByText("Alice").length).toBeGreaterThan(0);
    expect(screen.getByText("08123")).not.toBeNull();
    expect(screen.getAllByText("alice@example.com").length).toBeGreaterThan(0);
    expect(screen.getByText("Nama lengkap").closest("[data-descriptions-column]")?.getAttribute("data-descriptions-column")).toBe("1");
    expect(container.querySelectorAll("[data-description-item]")).toHaveLength(6);
    container.querySelectorAll("[data-description-item]").forEach((item) => {
      expect(item.getAttribute("data-span")).toBeNull();
    });
    expect(
      screen.getAllByText("alice@example.com").find((node) => node.style.overflowWrap === "anywhere" && node.style.wordBreak === "break-word")
    ).toBeDefined();
    expect(screen.getByText("customer")).not.toBeNull();
    expect(screen.getByText("Aktif")).not.toBeNull();

    expect(mocks.useList).toHaveBeenCalledWith({
      resource: "orders",
      pagination: { currentPage: 1, pageSize: 5 },
      sorters: [{ field: "created_at", order: "desc" }],
      filters: [{ field: "user_id", operator: "eq", value: "customer-123" }],
      queryOptions: { enabled: true },
    });

    fireEvent.click(screen.getByRole("button", { name: "Blokir akun" }));
    expect(mocks.handleBan).toHaveBeenCalledWith({ id: "customer-123", full_name: "Alice" });
  });

  it("renders customer profile fallbacks for missing fields", () => {
    mockCustomerShow({
      full_name: " ",
      phone_number: " ",
      email: null,
      role: null,
      created_at: null,
    });

    render(<CustomerShow />);

    expect(screen.getAllByText("Pelanggan tidak dikenal").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Belum tersedia").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText("ID pelanggan")).not.toBeNull();
    expect(screen.getByText("customer-123")).not.toBeNull();
  });

  it.each([
    ["null", null],
    ["missing", undefined],
    ["blank", "   "],
  ])("renders the English missing-email fallback when customer email is %s", (_, email) => {
    mocks.translations["customers.emailFallback"] = "Not provided";
    mockCustomerShow({ email });

    render(<CustomerShow />);

    expect(screen.getAllByText("Not provided").length).toBeGreaterThan(0);
  });

  it("renders the Indonesian missing-email fallback through the translation mock", () => {
    mocks.translations["customers.emailFallback"] = "Belum tersedia";
    mockCustomerShow({ email: null });

    render(<CustomerShow />);

    expect(screen.getAllByText("Belum tersedia").length).toBeGreaterThan(0);
  });

  it("keeps the customer profile visible when recent orders fail", () => {
    mockCustomerShow();
    mockRecentOrders({ isError: true });

    render(<CustomerShow />);

    expect(screen.getAllByText("Alice").length).toBeGreaterThan(0);
    expect(screen.getByRole("alert").textContent).toContain("Pesanan terbaru belum dapat dimuat");
  });

  it("announces the recent orders loading state to assistive technology", () => {
    mockCustomerShow();
    mockRecentOrders({ isLoading: true });

    render(<CustomerShow />);

    const loadingStatus = screen.getByRole("status");

    expect(loadingStatus.getAttribute("aria-live")).toBe("polite");
    expect(loadingStatus.getAttribute("aria-busy")).toBe("true");
    expect(loadingStatus.textContent).toContain("Memuat pesanan...");
  });

  it("renders explicit alt text for image-backed customer avatars", () => {
    mockCustomerShow({ avatar_url: "https://cdn.test/alice.png" });

    render(<CustomerShow />);

    const avatarImage = screen.getByRole("img", { name: "Foto profil Alice" }) as HTMLImageElement;

    expect(avatarImage.src).toBe("https://cdn.test/alice.png");
  });

  it("calls unblock handler for banned customer accounts", () => {
    mockCustomerShow({ is_banned: true });

    render(<CustomerShow />);

    expect(screen.getByText("Diblokir")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Buka blokir akun" }));
    expect(mocks.handleUnban).toHaveBeenCalledWith({ id: "customer-123", full_name: "Alice" });
  });

  it("renders recent orders and opens a selected order", () => {
    mockCustomerShow();
    mockRecentOrders({
      data: [
        {
          id: "order-1",
          order_number: "INV-001",
          status: "processing",
          payment_status: "settlement",
          total_amount: 25000,
          created_at: "2026-04-10T00:00:00.000Z",
        },
      ],
    });

    render(<CustomerShow />);

    expect(screen.getByText("INV-001")).not.toBeNull();
    expect(screen.getByText("orderStatus.processing")).not.toBeNull();
    expect(screen.getByText("paymentStatus.settlement")).not.toBeNull();
    expect(screen.getByText(/Rp\s*25\.000/)).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Lihat Pesanan" }));
    expect(mocks.navigate).toHaveBeenCalledWith("/orders/show/order-1");
  });

  it("renders no-orders empty state", () => {
    mockCustomerShow();

    render(<CustomerShow />);

    expect(screen.getByText("Belum ada pesanan")).not.toBeNull();
    expect(screen.getByText("Pelanggan ini belum memiliki pesanan.")).not.toBeNull();
  });

  it("opens all transactions with a Refine indexed customer filter", () => {
    mockCustomerShow();

    render(<CustomerShow />);

    fireEvent.click(screen.getByRole("button", { name: "Lihat Semua Transaksi" }));

    const [navigationTarget] = mocks.navigate.mock.calls.at(-1) ?? [];
    const targetUrl = new URL(String(navigationTarget), "https://admin.test");

    expect(targetUrl.pathname).toBe("/orders");
    expect(targetUrl.searchParams.get("currentPage")).toBe("1");
    expect(targetUrl.searchParams.get("filters[0][field]")).toBe("user_id");
    expect(targetUrl.searchParams.get("filters[0][operator]")).toBe("eq");
    expect(targetUrl.searchParams.get("filters[0][value]")).toBe("customer-123");
  });

  it("keeps recent-order querying and all-transactions navigation disabled without a customer id", () => {
    mocks.useParams.mockReturnValue({});
    mockCustomerShow({ id: undefined });

    render(<CustomerShow />);

    expect(mocks.useList).toHaveBeenCalledWith({
      resource: "orders",
      pagination: { currentPage: 1, pageSize: 5 },
      sorters: [{ field: "created_at", order: "desc" }],
      filters: undefined,
      queryOptions: { enabled: false },
    });

    fireEvent.click(screen.getByRole("button", { name: "Lihat Semua Transaksi" }));

    expect(mocks.navigate).not.toHaveBeenCalledWith(expect.stringContaining("/orders?"));
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
        return {
          result: {
            data: [{ id: "prod-1", name: "Vitamin C", stock: 2 }],
            total: 8,
          },
          query: { isLoading: false },
        };
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
      if (args.resource === "admin_operational_metrics") {
        return {
          result: {
            data: [
              {
                bucket_start: "2026-04-01",
                bucket_end: "2026-04-30",
                order_count: 1,
                paid_order_count: 1,
                completed_order_count: 0,
                revenue: 25000,
              },
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

    expect(screen.getByText("dashboard.overview.title")).not.toBeNull();
    expect(screen.getByText("dashboard.kpis.revenue30d:25000")).not.toBeNull();
    expect(screen.getByText("dashboard.kpis.orders30d:1")).not.toBeNull();
    expect(screen.getByText("dashboard.kpis.paymentSuccessRate:100")).not.toBeNull();
    expect(screen.getByText("dashboard.kpis.averageOrderValue:25000")).not.toBeNull();

    expect(screen.queryByText("dashboard.kpis.lowStockSkus:8")).toBeNull();
    expect(screen.getByText("dashboard.lowStockAlerts")).not.toBeNull();
    expect(screen.getByText("order-1")).not.toBeNull();
    expect(screen.getByText("Vitamin C")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "dashboard.viewAllOrders" }));
    fireEvent.click(screen.getByRole("button", { name: "dashboard.viewAllProducts" }));

    expect(mocks.list).toHaveBeenCalledWith("orders");
    expect(mocks.list).toHaveBeenCalledWith("products");
  });
});
