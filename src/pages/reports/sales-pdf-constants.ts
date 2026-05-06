export const SALES_PDF_SECTION_KEYS = [
  "dailySalesSummary",
  "soldProducts",
  "bestSellingProducts",
  "largestCustomers",
] as const;

export type SalesPdfSectionKey = (typeof SALES_PDF_SECTION_KEYS)[number];
