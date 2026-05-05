export const SALES_PDF_SECTION_KEYS = [
  "dailySalesSummary",
  "soldProducts",
  "bestSellingProducts",
  "largestCustomers",
] as const;

export type SalesPdfSectionKey = (typeof SALES_PDF_SECTION_KEYS)[number];

export type SalesPdfDailySalesRow = {
  sale_date: string;
  orders_count: number;
  total_revenue: string | number;
  average_order_value: string | number;
};

export type SalesPdfProductSalesRow = {
  product_id: string;
  product_name: string;
  category_name: string | null;
  total_qty_sold: number;
  total_revenue: string | number;
};

export type SalesPdfSoldProductRow = {
  id: string;
  order_created_at: string;
  sale_date: string;
  product_name: string | null;
  quantity: number;
  unit_price: string | number;
  subtotal: string | number;
};

export type SalesPdfCustomerSalesRow = {
  user_id: string;
  full_name: string | null;
  phone_number: string | null;
  orders_count: number;
  total_revenue: string | number;
};

export type SalesPdfDateRangeMetadata = {
  startDate: string | null;
  endDate: string | null;
};

export type SalesPdfLocaleLabels = {
  reportTitle: string;
  generatedAtLabel: string;
  dateRangeLabel: string;
  sectionLabels: Record<SalesPdfSectionKey, string>;
  emptyValueText: string;
  emptyReportText: string;
  pageLabel: string;
  columnHeaders: Record<SalesPdfSectionKey, readonly string[]>;
};

export type SalesPdfGeneratedTimestamp = string;

export type SalesPdfFilenameInput = {
  reportTitle: string;
  generatedAt: SalesPdfGeneratedTimestamp;
  dateRange: SalesPdfDateRangeMetadata;
  locale: string;
  selectedSectionKeys: readonly SalesPdfSectionKey[];
  separator?: string;
};

export type SalesPdfExportInput = {
  dailySales: readonly SalesPdfDailySalesRow[];
  productSales: readonly SalesPdfProductSalesRow[];
  soldProducts: readonly SalesPdfSoldProductRow[];
  customerSales: readonly SalesPdfCustomerSalesRow[];
  selectedSectionKeys: readonly SalesPdfSectionKey[];
  dateRange: SalesPdfDateRangeMetadata;
  localeLabels: SalesPdfLocaleLabels;
  locale: string;
  currency: string;
  generatedAt: SalesPdfGeneratedTimestamp;
};

const normalizeFilenamePart = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const sanitizeText = (value: unknown, fallback = "-") => {
  if (value === null || value === undefined) {
    return fallback;
  }

  const text = String(value)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return text.length > 0 ? text : fallback;
};

const pad2 = (value: number) => String(value).padStart(2, "0");

const formatDateText = (value: string | null | undefined, emptyValueText = "-") => {
  if (!value) {
    return emptyValueText;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return sanitizeText(value, emptyValueText);
  }

  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
};

const formatDateTimeText = (value: string | null | undefined, emptyValueText = "-") => {
  if (!value) {
    return emptyValueText;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return sanitizeText(value, emptyValueText);
  }

  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())} ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`;
};

const formatIntegerText = (value: unknown, locale = "id-ID", emptyValueText = "-") => {
  const numberValue = Number(value);

  return Number.isFinite(numberValue) ? new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(numberValue) : emptyValueText;
};

const formatCurrencyText = (value: unknown, locale = "id-ID", currency = "IDR", emptyValueText = "-") => {
  const numberValue = Number(value);

  return Number.isFinite(numberValue)
    ? new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }).format(numberValue)
    : emptyValueText;
};

const formatDateRangeText = (dateRange: SalesPdfDateRangeMetadata, emptyValueText = "-") => {
  const start = formatDateText(dateRange.startDate, emptyValueText);
  const end = formatDateText(dateRange.endDate, emptyValueText);

  if (start === emptyValueText && end === emptyValueText) {
    return emptyValueText;
  }

  return `${start} - ${end}`;
};

type PdfTableColumn = {
  title: string;
  value: (row: unknown) => string;
  align?: "left" | "right" | "center";
};

type PdfSectionDefinition = {
  key: SalesPdfSectionKey;
  title: (labels: SalesPdfLocaleLabels) => string;
  headers: readonly string[];
  rows: (input: SalesPdfExportInput) => readonly unknown[];
  columns: readonly PdfTableColumn[];
};

const formatDateRangePart = (dateRange: SalesPdfDateRangeMetadata) => {
  const { startDate, endDate } = dateRange;

  if (!startDate && !endDate) {
    return "all-time";
  }

  const start = startDate ? startDate.slice(0, 10) : "open";
  const end = endDate ? endDate.slice(0, 10) : "open";

  return `${start}_to_${end}`;
};

export const generateSalesPdfFilename = ({
  reportTitle,
  generatedAt,
  dateRange,
  locale,
  selectedSectionKeys,
  separator = "_",
}: SalesPdfFilenameInput) => {
  const sectionPart = selectedSectionKeys.length > 0 ? selectedSectionKeys.join("-") : "all-sections";

  return [
    normalizeFilenamePart(reportTitle),
    normalizeFilenamePart(locale),
    formatDateRangePart(dateRange),
    normalizeFilenamePart(sectionPart),
    normalizeFilenamePart(generatedAt),
  ]
    .filter(Boolean)
    .join(separator)
    .concat(".pdf");
};

export const buildSalesReportPdf = async (input: SalesPdfExportInput) => {
  const [{ jsPDF }, { autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 14;
  const emptyValueText = input.localeLabels.emptyValueText;
  const reportTitle = sanitizeText(input.localeLabels.reportTitle);
  const periodText = formatDateRangeText(input.dateRange, emptyValueText);
  const generatedAtText = formatDateTimeText(input.generatedAt, emptyValueText);
  const selectedSectionKeys = new Set(input.selectedSectionKeys);
  const filename = generateSalesPdfFilename({
    reportTitle: input.localeLabels.reportTitle,
    generatedAt: input.generatedAt,
    dateRange: input.dateRange,
    locale: input.locale,
    selectedSectionKeys: input.selectedSectionKeys,
  });

  const SALES_PDF_SECTIONS: readonly PdfSectionDefinition[] = [
    {
      key: "dailySalesSummary",
      title: (labels) => labels.sectionLabels.dailySalesSummary,
      headers: input.localeLabels.columnHeaders.dailySalesSummary,
      rows: (sectionInput) => sectionInput.dailySales,
      columns: [
        { title: "Tanggal", value: (row) => formatDateText((row as SalesPdfDailySalesRow).sale_date, emptyValueText) },
        { title: "Jumlah Order", value: (row) => formatIntegerText((row as SalesPdfDailySalesRow).orders_count, input.locale, emptyValueText), align: "right" },
        { title: "Total Omzet", value: (row) => formatCurrencyText((row as SalesPdfDailySalesRow).total_revenue, input.locale, input.currency, emptyValueText), align: "right" },
        { title: "Rata-rata Nilai Order", value: (row) => formatCurrencyText((row as SalesPdfDailySalesRow).average_order_value, input.locale, input.currency, emptyValueText), align: "right" },
      ],
    },
    {
      key: "soldProducts",
      title: (labels) => labels.sectionLabels.soldProducts,
      headers: input.localeLabels.columnHeaders.soldProducts,
      rows: (sectionInput) => sectionInput.soldProducts,
      columns: [
        { title: "Tanggal Penjualan", value: (row) => formatDateText((row as SalesPdfSoldProductRow).sale_date, emptyValueText) },
        { title: "Waktu Order", value: (row) => formatDateTimeText((row as SalesPdfSoldProductRow).order_created_at, emptyValueText) },
        { title: "Produk", value: (row) => sanitizeText((row as SalesPdfSoldProductRow).product_name, emptyValueText) },
        { title: "Jumlah", value: (row) => formatIntegerText((row as SalesPdfSoldProductRow).quantity, input.locale, emptyValueText), align: "right" },
        { title: "Harga Satuan", value: (row) => formatCurrencyText((row as SalesPdfSoldProductRow).unit_price, input.locale, input.currency, emptyValueText), align: "right" },
        { title: "Subtotal", value: (row) => formatCurrencyText((row as SalesPdfSoldProductRow).subtotal, input.locale, input.currency, emptyValueText), align: "right" },
      ],
    },
    {
      key: "bestSellingProducts",
      title: (labels) => labels.sectionLabels.bestSellingProducts,
      headers: input.localeLabels.columnHeaders.bestSellingProducts,
      rows: (sectionInput) => sectionInput.productSales,
      columns: [
        { title: "Produk", value: (row) => sanitizeText((row as SalesPdfProductSalesRow).product_name, emptyValueText) },
        { title: "Kategori", value: (row) => sanitizeText((row as SalesPdfProductSalesRow).category_name, emptyValueText) },
        { title: "Qty Terjual", value: (row) => formatIntegerText((row as SalesPdfProductSalesRow).total_qty_sold, input.locale, emptyValueText), align: "right" },
        { title: "Total Omzet", value: (row) => formatCurrencyText((row as SalesPdfProductSalesRow).total_revenue, input.locale, input.currency, emptyValueText), align: "right" },
      ],
    },
    {
      key: "largestCustomers",
      title: (labels) => labels.sectionLabels.largestCustomers,
      headers: input.localeLabels.columnHeaders.largestCustomers,
      rows: (sectionInput) => sectionInput.customerSales,
      columns: [
        { title: "Nama", value: (row) => sanitizeText((row as SalesPdfCustomerSalesRow).full_name, emptyValueText) },
        { title: "No. HP", value: (row) => sanitizeText((row as SalesPdfCustomerSalesRow).phone_number, emptyValueText) },
        { title: "Jumlah Order", value: (row) => formatIntegerText((row as SalesPdfCustomerSalesRow).orders_count, input.locale, emptyValueText), align: "right" },
        { title: "Total Omzet", value: (row) => formatCurrencyText((row as SalesPdfCustomerSalesRow).total_revenue, input.locale, input.currency, emptyValueText), align: "right" },
      ],
    },
  ];

  doc.setProperties({
    title: reportTitle,
    subject: reportTitle,
    author: "Pharmacy Admin Panel",
    creator: "Pharmacy Admin Panel",
  });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(reportTitle, marginX, 14);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(`${sanitizeText(input.localeLabels.dateRangeLabel)}: ${sanitizeText(periodText)}`, marginX, 20);
  doc.text(`${sanitizeText(input.localeLabels.generatedAtLabel)}: ${generatedAtText}`, marginX, 24);
  doc.setLineWidth(0.2);
  doc.line(marginX, 27, pageWidth - marginX, 27);

  let currentY = 34;

  for (const section of SALES_PDF_SECTIONS) {
    if (!selectedSectionKeys.has(section.key)) {
      continue;
    }

    const rows = section.rows(input);
    const body = rows.map((row) => section.columns.map((column) => column.value(row)));
    const sectionTitle = sanitizeText(section.title(input.localeLabels));
    const tableBody =
      body.length > 0
        ? body
        : [section.columns.map((_, index) => (index === 0 ? input.localeLabels.emptyReportText : ""))];

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(sectionTitle, marginX, currentY);

    autoTable(doc, {
      head: [
        [...section.headers],
      ],
      body: tableBody,
      startY: currentY + 4,
      margin: { left: marginX, right: marginX, top: 28, bottom: 16 },
      theme: "grid",
      styles: {
        fontSize: 8,
        cellPadding: 1.5,
        overflow: "linebreak",
        valign: "middle",
      },
      columnStyles: Object.fromEntries(
        section.columns.map((column, index) => [index, column.align ? { halign: column.align } : {}]),
      ),
      headStyles: {
        fillColor: [245, 245, 245],
        textColor: 20,
        fontStyle: "bold",
      },
      showHead: "everyPage",
      pageBreak: "auto",
      rowPageBreak: "avoid",
      horizontalPageBreak: true,
      didDrawPage: (data) => {
        const pageNumber = data.pageNumber;
        const footerY = pageHeight - 8;

        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setLineWidth(0.2);
        doc.line(marginX, footerY - 4, pageWidth - marginX, footerY - 4);
        doc.text(`${sectionTitle} • ${sanitizeText(periodText)}`, marginX, footerY);
        doc.text(`${sanitizeText(input.localeLabels.pageLabel)} ${pageNumber}`, pageWidth - marginX, footerY, { align: "right" });
      },
    });

    currentY = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? currentY + 12;
    currentY += 10;
    if (currentY > pageHeight - 30) {
      doc.addPage();
      currentY = 20;
    }
  }

  doc.save(filename);
  return doc;
};
