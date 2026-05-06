import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CategoryList } from "../categories/list";
import { CustomerList } from "../customers/list";
import { OrderList } from "../orders/list";
import { ProductList } from "../products/list";

const mocks = vi.hoisted(() => {
  const translations: Record<string, string> = {
    "customers.search.placeholder": "Search by name, email, or phone",
    "customers.search.loading": "Loading customers...",
    "customers.search.noResults": "No matching customers found",
    "customers.search.error": "Unable to load customers",
    "customers.search.clear": "Clear customer search",
    "customers.emailFallback": "Not provided",
  };
  const translate = vi.fn((key: string, paramsOrFallback?: Record<string, unknown> | string, fallback?: string) => {
    if (translations[key]) {
      return translations[key];
    }

    if (key.startsWith("orderStatus.") || key.startsWith("paymentStatus.")) {
      return key;
    }

    if (typeof paramsOrFallback === "string") {
      return paramsOrFallback;
    }

    return fallback ?? key;
  });
  const useTable = vi.fn();
  const navigate = vi.fn();
  const handleBan = vi.fn();
  const handleUnban = vi.fn();

  return {
    translate,
    useTable,
    navigate,
    handleBan,
    handleUnban,
  };
});

vi.mock("@refinedev/core", () => ({
  useTranslation: () => ({ translate: mocks.translate }),
}));

vi.mock("react-router", () => ({
  useNavigate: () => mocks.navigate,
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

  const Table = ({
    dataSource = [],
    children,
    loading,
    locale,
    scroll,
    onRow,
  }: {
    dataSource?: Record<string, unknown>[];
    children: React.ReactNode;
    loading?: boolean | { spinning?: boolean; tip?: React.ReactNode };
    locale?: { emptyText?: React.ReactNode };
    scroll?: { x?: string | number | boolean };
    onRow?: (record: Record<string, unknown>) => React.HTMLAttributes<HTMLDivElement>;
  }) => {
    const columns = ReactModule.Children.toArray(children).filter(ReactModule.isValidElement);
    const loadingTip = typeof loading === "object" && loading.spinning ? loading.tip : null;

    return (
      <div data-testid="table" data-scroll-x={String(scroll?.x ?? "")}> 
        {loadingTip ? <div>{loadingTip}</div> : null}
        {dataSource.length === 0 && locale?.emptyText ? <div>{locale.emptyText}</div> : null}
        {onRow ? dataSource.map((record) => {
          const rowProps = onRow(record);
          const rowKey = String(record.id ?? JSON.stringify(record));

          return (
            <div key={`row-${rowKey}`} {...rowProps}>
              row:{rowKey}
            </div>
          );
        }) : null}
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
  theme: {
    useToken: () => ({
      token: {
        marginXS: 8,
        colorTextTertiary: "#999",
        colorWarning: "#faad14",
      },
    }),
  },
  Space: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Avatar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Input: ({
    allowClear,
    placeholder,
    value = "",
    onChange,
    "aria-label": ariaLabel,
  }: {
    allowClear?: { clearIcon?: React.ReactNode };
    placeholder?: string;
    value?: string;
    onChange?: React.ChangeEventHandler<HTMLInputElement>;
    "aria-label"?: string;
  }) => {
    const clearIcon = allowClear?.clearIcon;
    const clearLabel = ReactModule.isValidElement(clearIcon)
      ? String((clearIcon.props as { "aria-label"?: string })["aria-label"] ?? "clear")
      : "clear";

    return (
      <div>
        <input
          aria-label={ariaLabel}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
        />
        {allowClear ? (
          <button
            type="button"
            aria-label={clearLabel}
            onClick={() =>
              onChange?.({ target: { value: "" } } as React.ChangeEvent<HTMLInputElement>)
            }
          >
            clear
          </button>
        ) : null}
      </div>
    );
  },
  Tooltip: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Tag: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Alert: ({ message, description }: { message: React.ReactNode; description?: React.ReactNode }) => <div><div>{message}</div><div>{description}</div></div>,
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
  const customerPermanentFilter = {
    field: "role",
    operator: "eq",
    value: "customer",
  };

  const customerSearchFields = ["full_name", "phone_number", "email"];

  const createCustomerSearchFilter = (value: string) => ({
    operator: "or",
    value: customerSearchFields.map((field) => ({
      field,
      operator: "contains",
      value,
    })),
  });

  const customerTableDefaults = ({
    dataSource = [],
    loading = false,
    isError = false,
    setFilters = vi.fn(),
    setCurrentPage = vi.fn(),
  }: {
    dataSource?: Record<string, unknown>[];
    loading?: boolean;
    isError?: boolean;
    setFilters?: ReturnType<typeof vi.fn>;
    setCurrentPage?: ReturnType<typeof vi.fn>;
  } = {}) => ({
    tableProps: {
      dataSource,
      loading,
    },
    tableQuery: { isError },
    sorters: [],
    setFilters,
    setCurrentPage,
  });

  const renderCustomerList = (tableConfig: ReturnType<typeof customerTableDefaults> = customerTableDefaults()) => {
    mocks.useTable.mockReturnValue(tableConfig);

    render(<CustomerList />);

    return tableConfig;
  };

  const typeCustomerSearch = (searchText: string) => {
    const input = screen.getByLabelText("Search by name, email, or phone");

    fireEvent.change(input, { target: { value: searchText } });

    return input;
  };

  const advanceCustomerSearchDebounce = (milliseconds = 400) => {
    act(() => {
      vi.advanceTimersByTime(milliseconds);
    });
  };

  beforeEach(() => {
    mocks.translate.mockClear();
    mocks.useTable.mockReset();
    mocks.navigate.mockReset();
    mocks.handleBan.mockReset();
    mocks.handleUnban.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
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
            email: "alice@example.com",
            created_at: "2026-04-01",
            is_banned: false,
          },
          {
            id: "cust-2",
            full_name: "Bob",
            avatar_url: null,
            phone_number: "08234",
            email: null,
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
    expect(screen.getByText("alice@example.com")).not.toBeNull();
    expect(screen.getByText("Not provided")).not.toBeNull();
    expect(screen.getByText("customers.statusActive")).not.toBeNull();
    expect(screen.getByText("customers.statusBanned")).not.toBeNull();
    expect(screen.getByText("show:profiles:cust-1")).not.toBeNull();
    expect(screen.getByText("show:profiles:cust-2")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "customers.ban" }));
    fireEvent.click(screen.getByRole("button", { name: "customers.unban" }));

    expect(mocks.handleBan).toHaveBeenCalledWith(
      expect.objectContaining({ id: "cust-1", full_name: "Alice" })
    );
    expect(mocks.handleUnban).toHaveBeenCalledWith(
      expect.objectContaining({ id: "cust-2", full_name: "Bob" })
    );
  });

  it("renders customer search input and keeps the permanent customer-only role filter", () => {
    renderCustomerList();

    expect(screen.getByPlaceholderText("Search by name, email, or phone")).not.toBeNull();
    expect(screen.getByLabelText("Search by name, email, or phone")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Clear customer search" })).not.toBeNull();
    expect(mocks.useTable).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: {
          permanent: [customerPermanentFilter],
        },
      })
    );
  });

  it("does not rewrite customer URL-synced pagination or filters before search input changes", () => {
    const setFilters = vi.fn();
    const setCurrentPage = vi.fn();

    renderCustomerList(customerTableDefaults({ setFilters, setCurrentPage }));

    expect(setFilters).not.toHaveBeenCalled();
    expect(setCurrentPage).not.toHaveBeenCalled();
  });

  it("debounces customer search for 400ms before replacing search filters", () => {
    vi.useFakeTimers();
    const setFilters = vi.fn();
    const setCurrentPage = vi.fn();
    renderCustomerList(customerTableDefaults({ setFilters, setCurrentPage }));
    setFilters.mockClear();
    setCurrentPage.mockClear();

    typeCustomerSearch("Alice");
    advanceCustomerSearchDebounce(399);

    expect(setFilters).not.toHaveBeenCalled();
    expect(setCurrentPage).not.toHaveBeenCalled();

    advanceCustomerSearchDebounce(1);

    expect(setCurrentPage).toHaveBeenCalledWith(1);
    expect(setFilters).toHaveBeenCalledWith([createCustomerSearchFilter("Alice")], "replace");
    expect(mocks.useTable).toHaveBeenCalledWith(
      expect.objectContaining({ filters: { permanent: [customerPermanentFilter] } })
    );
  });

  it.each([
    ["name", "Alice"],
    ["email", "alice@example.com"],
    ["phone", "08123"],
  ])("builds customer OR search filters for %s fragments", (_, searchText) => {
    vi.useFakeTimers();
    const setFilters = vi.fn();
    const setCurrentPage = vi.fn();
    renderCustomerList(customerTableDefaults({ setFilters, setCurrentPage }));
    setFilters.mockClear();
    setCurrentPage.mockClear();

    typeCustomerSearch(searchText);
    advanceCustomerSearchDebounce();

    expect(setCurrentPage).toHaveBeenCalledWith(1);
    expect(setFilters).toHaveBeenLastCalledWith([createCustomerSearchFilter(searchText)], "replace");
  });

  it("escapes special customer search characters before building the OR filter", () => {
    vi.useFakeTimers();
    const setFilters = vi.fn();
    renderCustomerList(customerTableDefaults({ setFilters }));
    setFilters.mockClear();

    typeCustomerSearch("%_,()'\\\"");
    advanceCustomerSearchDebounce();

    expect(setFilters).toHaveBeenLastCalledWith(
      [createCustomerSearchFilter("\\%\\_\\,\\(\\)\\'\\\\\\\"")],
      "replace"
    );
  });

  it("clears customer search by removing only the replaceable OR filter and resetting to page 1", () => {
    vi.useFakeTimers();
    const setFilters = vi.fn();
    const setCurrentPage = vi.fn();
    renderCustomerList(customerTableDefaults({ setFilters, setCurrentPage }));
    setFilters.mockClear();
    setCurrentPage.mockClear();

    typeCustomerSearch("Alice");
    advanceCustomerSearchDebounce();
    setFilters.mockClear();
    setCurrentPage.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Clear customer search" }));
    advanceCustomerSearchDebounce();

    expect(setCurrentPage).toHaveBeenCalledWith(1);
    expect(setFilters).toHaveBeenLastCalledWith([], "replace");
    expect(mocks.useTable).toHaveBeenCalledWith(
      expect.objectContaining({ filters: { permanent: [customerPermanentFilter] } })
    );
  });

  it("renders customer loading, empty, and error states with localized text", () => {
    renderCustomerList(customerTableDefaults({ loading: true }));
    expect(screen.getByText("Loading customers...")).not.toBeNull();
    expect(screen.getByText("No matching customers found")).not.toBeNull();

    mocks.useTable.mockReset();
    renderCustomerList(customerTableDefaults({ isError: true }));
    expect(screen.getByText("Unable to load customers")).not.toBeNull();
  });

  it("renders product list values and row action buttons", () => {
    mocks.useTable.mockReturnValue({
      tableProps: {
        dataSource: [
          {
            id: "prod-1",
            product_images: [{ url: "https://example.com/image.png" }],
            name: "Vitamin C",
            sku: "SUPP-VITAMIN-C-1000-AB12",
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
    expect(screen.getByText("SUPP-VITAMIN-C-1000-AB12")).not.toBeNull();
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
    expect(screen.getByText("orderStatus.pending")).not.toBeNull();
    expect(screen.getByText("paymentStatus.settlement")).not.toBeNull();
    expect(screen.getByText("Bank Transfer")).not.toBeNull();
    expect(screen.getByText("JNE")).not.toBeNull();
    expect(screen.getByText("WB123")).not.toBeNull();
    expect(screen.getByText("show:orders:order-1")).not.toBeNull();
    expect(screen.getByLabelText("orders.filterStatus")).not.toBeNull();
    expect(screen.getByLabelText("orders.filterPayment")).not.toBeNull();
    expect(screen.getByTestId("table").getAttribute("data-scroll-x")).toBe("max-content");
  });

  it("opens order detail when clicking or pressing keyboard on an order row", () => {
    mocks.useTable.mockReturnValue({
      tableProps: {
        dataSource: [
          {
            id: "order-1",
            total_amount: 25000,
            status: "pending",
            payment_status: "settlement",
          },
        ],
      },
      filters: [],
    });

    render(<OrderList />);

    const row = screen.getByRole("button", { name: "orders.actions.openRowAriaLabel" });
    fireEvent.click(row);
    expect(mocks.navigate).toHaveBeenLastCalledWith("/orders/show/order-1");

    fireEvent.keyDown(row, { key: "Enter" });
    expect(mocks.navigate).toHaveBeenLastCalledWith("/orders/show/order-1");

    fireEvent.keyDown(row, { key: " " });
    expect(mocks.navigate).toHaveBeenLastCalledWith("/orders/show/order-1");
  });

  it("renders localized order empty and error states", () => {
    mocks.useTable.mockReturnValue({
      tableProps: {
        dataSource: [],
      },
      tableQuery: { isError: false },
      filters: [],
    });

    render(<OrderList />);

    expect(screen.getByText("orders.empty.list")).not.toBeNull();

    mocks.useTable.mockReset();
    mocks.useTable.mockReturnValue({
      tableProps: {
        dataSource: [],
      },
      tableQuery: { isError: true },
      filters: [],
    });

    render(<OrderList />);

    expect(screen.getByText("orders.empty.listErrorTitle")).not.toBeNull();
    expect(screen.getByText("orders.empty.listErrorDescription")).not.toBeNull();
  });
});
