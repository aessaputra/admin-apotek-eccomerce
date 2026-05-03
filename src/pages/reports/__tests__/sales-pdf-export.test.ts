import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SALES_PDF_SECTION_KEYS,
  buildSalesReportPdf,
  generateSalesPdfFilename,
  type SalesPdfExportInput,
} from "../sales-pdf-export";

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

  const autoTableCalls: AutoTableOptions[] = [];

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
    autoTableCalls,
    autoTable: vi.fn((doc: typeof lastDoc, options: AutoTableOptions) => {
      autoTableCalls.push(options);

      if (doc) {
        doc.lastAutoTable = { finalY: (options.startY ?? 0) + 18 };
      }

      options.didDrawPage?.({ pageNumber: 1 });
    }),
    jsPDF: vi.fn(function jsPDF() {
      return createDoc();
    }),
    getLastDoc: () => lastDoc,
    reset: () => {
      lastDoc = null;
      autoTableCalls.length = 0;
      pdfMocks.autoTable.mockClear();
      pdfMocks.jsPDF.mockClear();
    },
  };
});

vi.mock("jspdf", () => ({
  jsPDF: pdfMocks.jsPDF,
}));

vi.mock("jspdf-autotable", () => ({
  autoTable: pdfMocks.autoTable,
}));

describe("generateSalesPdfFilename", () => {
  it("builds a stable filename from report metadata", () => {
    const filename = generateSalesPdfFilename({
      reportTitle: "Laporan Penjualan",
      generatedAt: "2026-05-01T10:00:00.000Z",
      dateRange: {
        startDate: "2026-04-01T00:00:00.000Z",
        endDate: "2026-04-30T23:59:59.999Z",
      },
      locale: "id-ID",
      selectedSectionKeys: ["dailySalesSummary", "soldProducts"],
    });

    expect(filename).toContain("laporan-penjualan");
    expect(filename).toContain("id-id");
    expect(filename).toContain("2026-04-01_to_2026-04-30");
    expect(filename).toContain("dailysalessummary-soldproducts");
    expect(filename).toContain("2026-05-01t10-00-00-000z");
    expect(filename.endsWith(".pdf")).toBe(true);
  });
});

describe("buildSalesReportPdf", () => {
  const baseInput: SalesPdfExportInput = {
    dailySales: [
      {
        sale_date: "2026-04-01T00:00:00.000Z",
        orders_count: 2,
        total_revenue: 15000,
        average_order_value: 7500,
      },
    ],
    productSales: [
      {
        product_id: "p1",
        product_name: "Test Product",
        category_name: "Cat",
        total_qty_sold: 5,
        total_revenue: 50000,
      },
    ],
    soldProducts: [
      {
        id: "sp1",
        order_created_at: "2026-04-01T10:00:00.000Z",
        sale_date: "2026-04-01T00:00:00.000Z",
        product_name: "Sold Product",
        quantity: 1,
        unit_price: 10000,
        subtotal: 10000,
      },
    ],
    customerSales: [
      {
        user_id: "u1",
        full_name: "User",
        phone_number: "0812",
        orders_count: 2,
        total_revenue: 30000,
      },
    ],
    selectedSectionKeys: [...SALES_PDF_SECTION_KEYS],
    dateRange: {
      startDate: "2026-04-01T00:00:00.000Z",
      endDate: "2026-04-30T23:59:59.999Z",
    },
    localeLabels: {
      reportTitle: "Laporan Penjualan",
      generatedAtLabel: "Dibuat pada",
      dateRangeLabel: "Periode",
      sectionLabels: {
        dailySalesSummary: "Ringkasan Harian",
        soldProducts: "Produk Terjual",
        bestSellingProducts: "Produk Terlaris",
        largestCustomers: "Pelanggan Terbesar",
      },
      emptyValueText: "N/A",
      emptyReportText: "Kosong",
      pageLabel: "Hal",
      columnHeaders: {
        dailySalesSummary: ["Tanggal", "Order", "Omzet", "AOV"],
        soldProducts: ["Tgl", "Waktu", "Produk", "Jml", "Harga", "Subtotal"],
        bestSellingProducts: ["Produk", "Kategori", "Qty", "Omzet"],
        largestCustomers: ["Nama", "HP", "Order", "Omzet"],
      },
    },
    locale: "id-ID",
    currency: "IDR",
    generatedAt: "2026-05-01T10:00:00.000Z",
  };

  beforeEach(() => {
    pdfMocks.reset();
  });

  it("builds a landscape A4 PDF and saves with the generated filename", () => {
    buildSalesReportPdf(baseInput);

    expect(pdfMocks.jsPDF).toHaveBeenCalledWith({ orientation: "landscape", unit: "mm", format: "a4" });

    const doc = pdfMocks.getLastDoc();
    expect(doc).not.toBeNull();
    expect(doc?.save).toHaveBeenCalledWith(
      generateSalesPdfFilename({
        reportTitle: baseInput.localeLabels.reportTitle,
        generatedAt: baseInput.generatedAt,
        dateRange: baseInput.dateRange,
        locale: baseInput.locale,
        selectedSectionKeys: baseInput.selectedSectionKeys,
      }),
    );
  });

  it("renders the report title only in the document header, not inside table page hooks", () => {
    buildSalesReportPdf(baseInput);

    const doc = pdfMocks.getLastDoc();
    const titleCalls = doc?.text.mock.calls.filter(([text]) => text === baseInput.localeLabels.reportTitle) ?? [];

    expect(titleCalls).toHaveLength(1);
    expect(titleCalls[0]).toEqual([baseInput.localeLabels.reportTitle, 14, 14]);
  });

  it("uses localeLabels.emptyValueText for formatter fallbacks", () => {
    buildSalesReportPdf({
      ...baseInput,
      dailySales: [
        {
          sale_date: "",
          orders_count: Number.NaN,
          total_revenue: Number.NaN,
          average_order_value: Number.NaN,
        },
      ],
      productSales: [
        {
          product_id: "p1",
          product_name: "",
          category_name: null,
          total_qty_sold: Number.NaN,
          total_revenue: Number.NaN,
        },
      ],
      soldProducts: [
        {
          id: "sp1",
          order_created_at: "",
          sale_date: "",
          product_name: null,
          quantity: Number.NaN,
          unit_price: Number.NaN,
          subtotal: Number.NaN,
        },
      ],
      customerSales: [
        {
          user_id: "u1",
          full_name: null,
          phone_number: null,
          orders_count: Number.NaN,
          total_revenue: Number.NaN,
        },
      ],
    });

    expect(pdfMocks.autoTableCalls[0]?.body).toEqual([["N/A", "N/A", "N/A", "N/A"]]);
    expect(pdfMocks.autoTableCalls[1]?.body).toEqual([["N/A", "N/A", "N/A", "N/A", "N/A", "N/A"]]);
    expect(pdfMocks.autoTableCalls[2]?.body).toEqual([["N/A", "N/A", "N/A", "N/A"]]);
    expect(pdfMocks.autoTableCalls[3]?.body).toEqual([["N/A", "N/A", "N/A", "N/A"]]);
  });

  it("renders empty sections with the empty report text", () => {
    buildSalesReportPdf({
      ...baseInput,
      selectedSectionKeys: ["dailySalesSummary"],
      dailySales: [],
    });

    expect(pdfMocks.autoTableCalls[0]?.body).toEqual([["Kosong", "", "", ""]]);
  });
});
