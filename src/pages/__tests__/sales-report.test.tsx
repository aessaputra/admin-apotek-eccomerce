import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SALES_PDF_SECTION_KEYS } from "../reports/sales-pdf-export";
import type { SalesPdfSectionKey } from "../reports/sales-pdf-export";
import { SalesReport } from "../reports/sales";

const mocks = vi.hoisted(() => {
  const translate = vi.fn((key: string, fallback?: string) => fallback ?? key);
  const useList = vi.fn();
  const dayStart = "2026-04-01T00:00:00.000Z";
  const dayEnd = "2026-04-30T23:59:59.999Z";
  const rpc = vi.fn();
  const buildPdf = vi.fn();
  const messageSuccess = vi.fn();
  const messageError = vi.fn();
  const messageApi = { success: messageSuccess, error: messageError };

  return {
    translate,
    useList,
    dayStart,
    dayEnd,
    rpc,
    buildPdf,
    messageSuccess,
    messageError,
    messageApi,
  };
});

const pdfMocks = vi.hoisted(() => {
  type AutoTableOptions = {
    head: string[][];
    body: string[][];
    didDrawPage?: (data: { pageNumber: number }) => void;
    startY?: number;
  };

  let lastDoc: {
    setProperties: ReturnType<typeof vi.fn>;
    setFont: ReturnType<typeof vi.fn>;
    setFontSize: ReturnType<typeof vi.fn>;
    text: ReturnType<typeof vi.fn>;
    setLineWidth: ReturnType<typeof vi.fn>;
    line: ReturnType<typeof vi.fn>;
    addPage: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    getNumberOfPages: ReturnType<typeof vi.fn>;
    internal: { pageSize: { getWidth: () => number; getHeight: () => number } };
    lastAutoTable?: { finalY?: number };
  } | null = null;

  const createDoc = () => {
    const doc = {
      setProperties: vi.fn(),
      setFont: vi.fn(),
      setFontSize: vi.fn(),
      text: vi.fn(),
      setLineWidth: vi.fn(),
      line: vi.fn(),
      addPage: vi.fn(),
      save: vi.fn(),
      getNumberOfPages: vi.fn(() => 1),
      internal: { pageSize: { getWidth: () => 297, getHeight: () => 210 } },
    };

    lastDoc = doc;
    return doc;
  };

  return {
    autoTable: vi.fn((doc: typeof lastDoc, options: AutoTableOptions) => {
      if (doc) {
        doc.lastAutoTable = { finalY: (options.startY ?? 0) + 18 };
      }

      options.didDrawPage?.({ pageNumber: 1 });
    }),
    jsPDF: vi.fn(function jsPDF() {
      return createDoc();
    }),
    getLastDoc: () => lastDoc,
  };
});

vi.mock("@refinedev/core", () => ({
  useTranslation: () => ({ translate: mocks.translate }),
  useList: mocks.useList,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "id" } }),
}));

vi.mock("jspdf", () => ({
  jsPDF: pdfMocks.jsPDF,
}));

vi.mock("jspdf-autotable", () => ({
  autoTable: pdfMocks.autoTable,
}));

vi.mock("../../providers/supabase-client", () => ({
  supabaseClient: {
    rpc: mocks.rpc,
  },
}));

vi.mock("../reports/sales-pdf-export", () => ({
  buildSalesReportPdf: mocks.buildPdf,
  SALES_PDF_SECTION_KEYS: ["dailySalesSummary", "soldProducts", "bestSellingProducts", "largestCustomers"] as const,
}));

vi.mock("antd", () => {
  let selectedSections: SalesPdfSectionKey[] = [...SALES_PDF_SECTION_KEYS];

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

  const CheckboxGroup = ({ value, onChange }: { value?: SalesPdfSectionKey[]; onChange?: (values: SalesPdfSectionKey[]) => void }) => {
    selectedSections = value ?? [...SALES_PDF_SECTION_KEYS];
    return (
      <div data-testid="section-checkbox-group">
        {SALES_PDF_SECTION_KEYS.map((key) => (
          <label key={key} data-testid={`checkbox-${key}`}>
            <input
              type="checkbox"
              checked={selectedSections.includes(key)}
              onChange={() => {
                const next = selectedSections.includes(key)
                  ? selectedSections.filter((k) => k !== key)
                  : [...selectedSections, key];
                selectedSections = next;
                onChange?.(next);
              }}
            />
            {key}
          </label>
        ))}
      </div>
    );
  };

  const Checkbox = Object.assign(
    ({ value, children }: { value?: string; children?: React.ReactNode }) => (
      <span data-testid={`checkbox-option-${value}`}>{children}</span>
    ),
    { Group: CheckboxGroup },
  );

  const ModalComponent = ({ open, title, centered, onOk, onCancel, okButtonProps, okText, cancelText, children }: { open?: boolean; title?: React.ReactNode; centered?: boolean; onOk?: () => void; onCancel?: () => void; okButtonProps?: { disabled?: boolean; loading?: boolean }; okText?: React.ReactNode; cancelText?: React.ReactNode; children?: React.ReactNode }) => {
    return open ? (
      <div data-testid="export-modal" data-centered={String(Boolean(centered))}>
        <div data-testid="modal-title">{title}</div>
        <div data-testid="modal-description">{children}</div>
        <button
          data-testid="modal-ok"
          disabled={okButtonProps?.disabled}
          onClick={onOk}
        >
          {okText}
        </button>
        <button data-testid="modal-cancel" onClick={onCancel}>
          {cancelText}
        </button>
      </div>
    ) : null;
  };

  const ContextHolder = ({ children }: { children: React.ReactNode }) => <div data-testid="message-context-holder">{children}</div>;

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
    Button: ({ children, onClick, disabled, loading }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; loading?: boolean }) => (
      <button type="button" data-testid="export-pdf-button" disabled={disabled || loading} onClick={onClick} data-loading={String(Boolean(loading))}>
        {children}
      </button>
    ),
    Modal: ModalComponent,
    Checkbox,
    Space: Object.assign(
      ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
      { Compact: ({ children }: { children: React.ReactNode }) => <div data-testid="date-export-toolbar">{children}</div> },
    ),
    theme: {
      useToken: () => ({ token: {} }),
    },
    message: {
      useMessage: () => [mocks.messageApi, <ContextHolder key="holder">{null}</ContextHolder>],
    },
  };
});

describe("SalesReport", () => {
  beforeEach(() => {
    mocks.translate.mockClear();
    mocks.useList.mockReset();
    pdfMocks.autoTable.mockClear();
    pdfMocks.jsPDF.mockClear();
    mocks.rpc.mockReset();
    mocks.buildPdf.mockReset();
    mocks.messageSuccess.mockReset();
    mocks.messageError.mockReset();

    mocks.useList.mockReturnValue({ result: { data: [] }, query: { isLoading: false } });
  });

  const mockQueryResult = (data: Record<string, unknown>[]) => ({
    result: { data },
    query: { isLoading: false },
  });

  const mockLoadingQueryResult = (data: Record<string, unknown>[]) => ({
    result: { data },
    query: { isLoading: true },
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

  const mockSalesReportHooksWithLoading = ({
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
      .mockReturnValueOnce(mockLoadingQueryResult(daily))
      .mockReturnValueOnce(mockLoadingQueryResult(topProducts))
      .mockReturnValueOnce(mockLoadingQueryResult(soldProducts))
      .mockReturnValueOnce(mockLoadingQueryResult(customers));
  };

  const selectDateRange = async () => {
    fireEvent.click(screen.getByRole("button", { name: "Dari tanggal-Sampai tanggal" }));
    await act(async () => {});
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
    expect(screen.getByText("Produk Terjual")).not.toBeNull();
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

    expect(screen.getByText("Produk Terjual")).not.toBeNull();
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

  it("renders the Export PDF button", () => {
    mockSalesReportHooks();

    render(<SalesReport />);

    const toolbar = screen.getByTestId("date-export-toolbar");
    expect(toolbar.textContent).toContain("range");
    expect(toolbar.contains(screen.getByTestId("export-pdf-button"))).toBe(true);
    expect(screen.getByTestId("export-pdf-button")).not.toBeNull();
    expect(screen.getByTestId("export-pdf-button").textContent).toBe("Ekspor PDF");
  });

  it("disables the Export PDF button while data is loading", () => {
    mockSalesReportHooksWithLoading();

    render(<SalesReport />);

    const button = screen.getByTestId("export-pdf-button");
    expect(button.hasAttribute("disabled")).toBe(true);
  });

  it("opens the export modal when the Export PDF button is clicked", async () => {
    mockSalesReportHooks();

    render(<SalesReport />);

    await selectDateRange();

    expect(screen.queryByTestId("export-modal")).toBeNull();

    fireEvent.click(screen.getByTestId("export-pdf-button"));

    expect(screen.getByTestId("export-modal")).not.toBeNull();
    expect(screen.getByTestId("export-modal").dataset.centered).toBe("true");
    expect(screen.getByTestId("modal-title").textContent).toBe("Ekspor Laporan PDF");
  });

  it("renders all four section checkboxes in the correct order with all selected by default", async () => {
    mockSalesReportHooks();

    render(<SalesReport />);

    await selectDateRange();

    fireEvent.click(screen.getByTestId("export-pdf-button"));

    const checkboxGroup = screen.getByTestId("section-checkbox-group");
    expect(checkboxGroup).not.toBeNull();

    const expectedOrder: SalesPdfSectionKey[] = ["dailySalesSummary", "soldProducts", "bestSellingProducts", "largestCustomers"];

    expectedOrder.forEach((key) => {
      const input = screen.getByTestId(`checkbox-${key}`).querySelector("input") as HTMLInputElement;
      expect(input).not.toBeNull();
      expect(input.checked).toBe(true);
    });
  });

  it("disables the confirm button when zero sections are selected", () => {
    mockSalesReportHooks();

    render(<SalesReport />);

    fireEvent.click(screen.getByRole("button", { name: "Dari tanggal-Sampai tanggal" }));

    fireEvent.click(screen.getByTestId("export-pdf-button"));

    const okButton = screen.getByTestId("modal-ok");
    expect(okButton).not.toBeNull();
    expect(okButton.textContent).toBe("Ekspor");

    for (const key of SALES_PDF_SECTION_KEYS) {
      const checkbox = screen.getByTestId(`checkbox-${key}`).querySelector("input") as HTMLInputElement;
      fireEvent.click(checkbox);
    }

    expect(okButton.hasAttribute("disabled")).toBe(true);
  });

  it("closes the modal on cancel without calling RPC or PDF helper", () => {
    mockSalesReportHooks();

    render(<SalesReport />);

    fireEvent.click(screen.getByRole("button", { name: "Dari tanggal-Sampai tanggal" }));
    fireEvent.click(screen.getByTestId("export-pdf-button"));

    expect(screen.getByTestId("export-modal")).not.toBeNull();

    fireEvent.click(screen.getByTestId("modal-cancel"));

    expect(screen.queryByTestId("export-modal")).toBeNull();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.buildPdf).not.toHaveBeenCalled();
  });

  it("resets all sections to selected by default when reopening the modal after cancel", () => {
    mockSalesReportHooks();

    render(<SalesReport />);

    fireEvent.click(screen.getByRole("button", { name: "Dari tanggal-Sampai tanggal" }));
    fireEvent.click(screen.getByTestId("export-pdf-button"));

    const soldCheckbox = screen.getByTestId("checkbox-soldProducts").querySelector("input") as HTMLInputElement;
    fireEvent.click(soldCheckbox);
    expect(soldCheckbox.checked).toBe(false);

    fireEvent.click(screen.getByTestId("modal-cancel"));
    expect(screen.queryByTestId("export-modal")).toBeNull();

    fireEvent.click(screen.getByTestId("export-pdf-button"));

    for (const key of SALES_PDF_SECTION_KEYS) {
      const input = screen.getByTestId(`checkbox-${key}`).querySelector("input") as HTMLInputElement;
      expect(input.checked).toBe(true);
    }
  });

  it("calls RPC with active date range and passes selected sections to buildSalesReportPdf on confirm", async () => {
    mockSalesReportHooks({
      daily: [{ sale_date: "2026-04-01T00:00:00.000Z", orders_count: 2, total_revenue: 15000, average_order_value: 7500 }],
      topProducts: [{ product_id: "p1", product_name: "Test Product", category_name: "Cat", total_qty_sold: 5, total_revenue: 50000 }],
      soldProducts: [{ id: "sp1", order_created_at: "2026-04-01T10:00:00.000Z", sale_date: "2026-04-01T00:00:00.000Z", product_name: "Sold Prod", quantity: 1, unit_price: 10000, subtotal: 10000 }],
      customers: [{ user_id: "u1", full_name: "Test User", phone_number: "0812", orders_count: 2, total_revenue: 30000 }],
    });

    const rpcData = {
      dailySalesSummary: [{ sale_date: "2026-04-01T00:00:00.000Z", orders_count: 3, total_revenue: 20000, average_order_value: 6667 }],
      bestSellingProducts: [{ product_id: "rpc-p1", product_name: "RPC Product", category_name: "RPC Cat", total_qty_sold: 10, total_revenue: 100000 }],
      soldProducts: [{ id: "rpc-sp1", order_created_at: "2026-04-01T12:00:00.000Z", sale_date: "2026-04-01T00:00:00.000Z", product_name: "RPC Sold", quantity: 2, unit_price: 5000, subtotal: 10000 }],
      largestCustomers: [{ user_id: "rpc-u1", full_name: "RPC User", phone_number: "0899", orders_count: 5, total_revenue: 50000 }],
    };

    mocks.rpc.mockResolvedValue({ data: rpcData, error: null });

    render(<SalesReport />);

    await selectDateRange();

    fireEvent.click(screen.getByTestId("export-pdf-button"));

    fireEvent.click(screen.getByTestId("modal-ok"));

    await waitFor(() => {
      expect(mocks.rpc).toHaveBeenCalledWith("admin_sales_report_pdf_export", {
        p_start_date: mocks.dayStart,
        p_end_date: mocks.dayEnd,
      });
    });

    await waitFor(() => {
      expect(mocks.buildPdf).toHaveBeenCalledTimes(1);
    });

    const pdfCall = mocks.buildPdf.mock.calls[0][0];
    expect(pdfCall.selectedSectionKeys).toEqual(["dailySalesSummary", "soldProducts", "bestSellingProducts", "largestCustomers"]);
    expect(pdfCall.dateRange).toEqual({ startDate: mocks.dayStart, endDate: mocks.dayEnd });
    expect(pdfCall.dailySales).toEqual(rpcData.dailySalesSummary);
    expect(pdfCall.productSales).toEqual(rpcData.bestSellingProducts);
    expect(pdfCall.soldProducts).toEqual(rpcData.soldProducts);
    expect(pdfCall.customerSales).toEqual(rpcData.largestCustomers);
    expect(pdfCall.localeLabels.reportTitle).toBe("Laporan Penjualan");
    expect(pdfCall.localeLabels.sectionLabels.dailySalesSummary).toBe("Ringkasan Penjualan Harian");
    expect(pdfCall.localeLabels.sectionLabels.soldProducts).toBe("Produk Terjual");
    expect(pdfCall.localeLabels.sectionLabels.bestSellingProducts).toBe("Produk Terlaris");
    expect(pdfCall.localeLabels.sectionLabels.largestCustomers).toBe("Pelanggan Terbesar");
    expect(pdfCall.localeLabels.columnHeaders.dailySalesSummary).toEqual(["Tanggal", "Jumlah Order", "Total Omzet", "Rata-rata Nilai Order"]);
    expect(pdfCall.localeLabels.columnHeaders.soldProducts).toEqual(["Tanggal Penjualan", "Waktu Order", "Produk", "Jumlah", "Harga Satuan", "Subtotal"]);
    expect(pdfCall.localeLabels.columnHeaders.bestSellingProducts).toEqual(["Produk", "Kategori", "Qty Terjual", "Total Omzet"]);
    expect(pdfCall.localeLabels.columnHeaders.largestCustomers).toEqual(["Nama", "No. HP", "Jumlah Order", "Total Omzet"]);
    expect(pdfCall.locale).toBe("id-ID");
    expect(pdfCall.currency).toBe("IDR");
    expect(pdfCall.generatedAt).toBeTruthy();
  });

  it("passes empty arrays when RPC returns null data", async () => {
    mocks.useList.mockReturnValue(mockQueryResult([]));

    mocks.rpc.mockResolvedValue({ data: null, error: null });

    render(<SalesReport />);

    await selectDateRange();

    fireEvent.click(screen.getByTestId("export-pdf-button"));
    fireEvent.click(screen.getByTestId("modal-ok"));

    await waitFor(() => {
      expect(mocks.buildPdf).toHaveBeenCalledTimes(1);
    });

    const pdfCall = mocks.buildPdf.mock.calls[0][0];
    expect(pdfCall.dailySales).toEqual([]);
    expect(pdfCall.productSales).toEqual([]);
    expect(pdfCall.soldProducts).toEqual([]);
    expect(pdfCall.customerSales).toEqual([]);
  });

  it("shows success message on successful export", async () => {
    mockSalesReportHooks();
    mocks.rpc.mockResolvedValue({ data: { dailySalesSummary: [], bestSellingProducts: [], soldProducts: [], largestCustomers: [] }, error: null });

    render(<SalesReport />);

    await selectDateRange();

    fireEvent.click(screen.getByTestId("export-pdf-button"));
    fireEvent.click(screen.getByTestId("modal-ok"));

    await waitFor(() => {
      expect(mocks.messageSuccess).toHaveBeenCalledWith("Laporan berhasil diekspor");
    });
  });

  it("shows error message on RPC error", async () => {
    mockSalesReportHooks();
    mocks.rpc.mockResolvedValue({ data: null, error: new Error("RPC failed") });

    render(<SalesReport />);

    await selectDateRange();

    fireEvent.click(screen.getByTestId("export-pdf-button"));
    fireEvent.click(screen.getByTestId("modal-ok"));

    await waitFor(() => {
      expect(mocks.messageError).toHaveBeenCalledWith("Gagal mengekspor laporan");
    });
  });

  it("shows error message when RPC throws", async () => {
    mockSalesReportHooks();
    mocks.rpc.mockRejectedValue(new Error("Network error"));

    render(<SalesReport />);

    await selectDateRange();

    fireEvent.click(screen.getByTestId("export-pdf-button"));
    fireEvent.click(screen.getByTestId("modal-ok"));

    await waitFor(() => {
      expect(mocks.messageError).toHaveBeenCalledWith("Gagal mengekspor laporan");
    });
  });

  it("passes only selected sections to buildSalesReportPdf", async () => {
    mockSalesReportHooks();
    mocks.rpc.mockResolvedValue({ data: { dailySalesSummary: [], bestSellingProducts: [], soldProducts: [], largestCustomers: [] }, error: null });

    render(<SalesReport />);

    await selectDateRange();

    fireEvent.click(screen.getByTestId("export-pdf-button"));

    const soldCheckbox = screen.getByTestId("checkbox-soldProducts").querySelector("input") as HTMLInputElement;
    const custCheckbox = screen.getByTestId("checkbox-largestCustomers").querySelector("input") as HTMLInputElement;
    fireEvent.click(soldCheckbox);
    fireEvent.click(custCheckbox);

    fireEvent.click(screen.getByTestId("modal-ok"));

    await waitFor(() => {
      expect(mocks.buildPdf).toHaveBeenCalledTimes(1);
    });

    const pdfCall = mocks.buildPdf.mock.calls[0][0];
    expect(pdfCall.selectedSectionKeys).toEqual(["dailySalesSummary", "bestSellingProducts"]);
  });

  it("disables the Export PDF button when no date range is selected", () => {
    mockSalesReportHooks();

    render(<SalesReport />);

    const button = screen.getByTestId("export-pdf-button");
    expect(button.hasAttribute("disabled")).toBe(true);
  });
});
