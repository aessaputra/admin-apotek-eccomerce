import { useList, useTranslation, type CrudFilters } from "@refinedev/core";
import { useTranslation as useI18nTranslation } from "react-i18next";
import { Button, Card, Checkbox, Col, DatePicker, Modal, Row, Space, Table, Typography, message } from "antd";
import type { Dayjs } from "dayjs";
import { useCallback, useMemo, useState } from "react";
import { supabaseClient } from "../../providers/supabase-client";
import { buildSalesReportPdf, SALES_PDF_SECTION_KEYS, type SalesPdfSectionKey } from "./sales-pdf-export";

type DailySalesRecord = {
  sale_date: string;
  orders_count: number;
  total_revenue: string | number;
  average_order_value: string | number;
};

type ProductSalesRecord = {
  product_id: string;
  product_name: string;
  category_name: string | null;
  total_qty_sold: number;
  total_revenue: string | number;
};

type SoldProductsRecord = {
  id: string;
  order_created_at: string;
  sale_date: string;
  product_name: string | null;
  quantity: number;
  unit_price: string | number;
  subtotal: string | number;
};

type CustomerSalesRecord = {
  user_id: string;
  full_name: string | null;
  phone_number: string | null;
  orders_count: number;
  total_revenue: string | number;
};

const SECTION_OPTIONS: { key: SalesPdfSectionKey; labelKey: string }[] = [
  { key: "dailySalesSummary", labelKey: "salesReports.sectionTitleDailySummary" },
  { key: "soldProducts", labelKey: "salesReports.sectionTitleSoldProducts" },
  { key: "bestSellingProducts", labelKey: "salesReports.sectionTitleTopProducts" },
  { key: "largestCustomers", labelKey: "salesReports.sectionTitleTopCustomers" },
];

export const SalesReport: React.FC = () => {
  const { translate: t } = useTranslation();
  const { i18n } = useI18nTranslation();
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [selectedSections, setSelectedSections] = useState<SalesPdfSectionKey[]>([...SALES_PDF_SECTION_KEYS]);
  const [exportLoading, setExportLoading] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  const locale = i18n.language.startsWith("en") ? "en-US" : "id-ID";

  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency: "IDR",
        maximumFractionDigits: 0,
      }),
    [locale],
  );

  const dailyFilters: CrudFilters = [];

  if (dateRange?.[0]) {
    dailyFilters.push({
      field: "sale_date",
      operator: "gte",
      value: dateRange[0].startOf("day").toISOString(),
    });
  }

  if (dateRange?.[1]) {
    dailyFilters.push({
      field: "sale_date",
      operator: "lte",
      value: dateRange[1].endOf("day").toISOString(),
    });
  }

  const { result: dailySalesResult, query: dailyQuery } = useList<DailySalesRecord>({
    resource: "report_daily_sales",
    filters: dailyFilters,
    pagination: { pageSize: 30 },
    errorNotification: (error) => ({
      message: t("reports.sales.load_error_daily", "Gagal memuat ringkasan harian"),
      description: (error instanceof Error ? error.message : undefined) ?? t("notifications.error"),
      type: "error",
    }),
  });

  const { result: productSalesResult, query: productQuery } = useList<ProductSalesRecord>({
    resource: "report_product_sales",
    pagination: { pageSize: 20 },
    errorNotification: (error) => ({
      message: t("reports.sales.load_error_products", "Gagal memuat data produk terlaris"),
      description: (error instanceof Error ? error.message : undefined) ?? t("notifications.error"),
      type: "error",
    }),
  });

  const { result: soldProductsResult, query: soldProductsQuery } = useList<SoldProductsRecord>({
    resource: "report_sold_products",
    filters: dailyFilters,
    pagination: { pageSize: 10 },
    errorNotification: (error) => ({
      message: t("reports.sales.load_error_sold_products", "Gagal memuat data produk terjual"),
      description: (error instanceof Error ? error.message : undefined) ?? t("notifications.error"),
      type: "error",
    }),
  });

  const { result: customerSalesResult, query: customerQuery } = useList<CustomerSalesRecord>({
    resource: "report_customer_sales",
    pagination: { pageSize: 20 },
    errorNotification: (error) => ({
      message: t("reports.sales.load_error_customers", "Gagal memuat data penjualan customer"),
      description: (error instanceof Error ? error.message : undefined) ?? t("notifications.error"),
      type: "error",
    }),
  });

  const dailySales = dailySalesResult?.data ?? [];
  const productSales = productSalesResult?.data ?? [];
  const soldProducts = soldProductsResult?.data ?? [];
  const customerSales = customerSalesResult?.data ?? [];

  const isDataLoading = dailyQuery.isLoading || productQuery.isLoading || soldProductsQuery.isLoading || customerQuery.isLoading;

  const handleExportPdf = useCallback(async () => {
    const startDate = dateRange?.[0]?.startOf("day").toISOString() ?? null;
    const endDate = dateRange?.[1]?.endOf("day").toISOString() ?? null;

    setExportLoading(true);

    try {
      const { data: rpcData, error: rpcError } = await supabaseClient.rpc("admin_sales_report_pdf_export", {
        p_start_date: startDate,
        p_end_date: endDate,
      });

      if (rpcError) {
        throw rpcError;
      }

      const generatedAt = new Date().toISOString();

      buildSalesReportPdf({
        dailySales: rpcData?.dailySalesSummary ?? [],
        productSales: rpcData?.bestSellingProducts ?? [],
        soldProducts: rpcData?.soldProducts ?? [],
        customerSales: rpcData?.largestCustomers ?? [],
        selectedSectionKeys: selectedSections,
        dateRange: { startDate, endDate },
        localeLabels: {
          reportTitle: t("salesReports.pdfTitle", "Laporan Penjualan"),
          generatedAtLabel: t("salesReports.generatedAtLabel", "Dibuat pada"),
          dateRangeLabel: t("salesReports.periodLabel", "Periode"),
          sectionLabels: {
            dailySalesSummary: t("salesReports.sectionTitleDailySummary", "Ringkasan Penjualan Harian"),
            soldProducts: t("salesReports.sectionTitleSoldProducts", "Produk Terjual"),
            bestSellingProducts: t("salesReports.sectionTitleTopProducts", "Produk Terlaris"),
            largestCustomers: t("salesReports.sectionTitleTopCustomers", "Pelanggan Terbesar"),
          },
          emptyValueText: t("salesReports.emptyValueText", "-"),
          emptyReportText: t("salesReports.emptyReportText", "Tidak ada data"),
          pageLabel: t("salesReports.pageLabel", "Halaman"),
          columnHeaders: {
            dailySalesSummary: [
              t("reports.sales.date", "Tanggal"),
              t("reports.sales.orders_count", "Jumlah Order"),
              t("reports.sales.total_revenue", "Total Omzet"),
              t("reports.sales.aov", "Rata-rata Nilai Order"),
            ],
            soldProducts: [
              t("salesReports.headerSaleDate", "Tanggal Penjualan"),
              t("salesReports.headerOrderTime", "Waktu Order"),
              t("reports.sales.product_name", "Produk"),
              t("reports.sales.quantity", "Jumlah"),
              t("reports.sales.unit_price", "Harga Satuan"),
              t("reports.sales.subtotal", "Subtotal"),
            ],
            bestSellingProducts: [
              t("reports.sales.product_name", "Produk"),
              t("reports.sales.category_name", "Kategori"),
              t("salesReports.headerQtySold", "Qty Terjual"),
              t("reports.sales.total_revenue", "Total Omzet"),
            ],
            largestCustomers: [
              t("reports.sales.customer_name", "Nama"),
              t("reports.sales.phone_number", "No. HP"),
              t("reports.sales.orders_count", "Jumlah Order"),
              t("reports.sales.total_revenue", "Total Omzet"),
            ],
          },
        },
        locale,
        currency: "IDR",
        generatedAt,
      });

      messageApi.success(t("salesReports.exportPdfSuccess", "Laporan berhasil diekspor"));
      setExportModalOpen(false);
    } catch {
      messageApi.error(t("salesReports.exportPdfError", "Gagal mengekspor laporan"));
    } finally {
      setExportLoading(false);
    }
  }, [dateRange, selectedSections, t, messageApi]);

  return (
    <>
      {contextHolder}
      <Row justify="space-between" align="middle" gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} lg={14}>
          <Typography.Title level={2} style={{ margin: 0 }}>
            {t("reports.sales.title", "Laporan Penjualan")}
          </Typography.Title>
        </Col>
        <Col xs={24} lg={10}>
          <Space.Compact block style={{ width: "100%" }}>
            <DatePicker.RangePicker
              allowClear
              style={{ flex: 1, minWidth: 0 }}
              value={dateRange}
              onChange={(value) => setDateRange(value)}
              placeholder={[
                t("reports.sales.date_from", "Dari tanggal"),
                t("reports.sales.date_to", "Sampai tanggal"),
              ]}
            />
            <Button
              type="primary"
              disabled={isDataLoading || exportLoading || !dateRange?.[0] || !dateRange?.[1]}
              loading={exportLoading}
              onClick={() => {
                setSelectedSections([...SALES_PDF_SECTION_KEYS]);
                setExportModalOpen(true);
              }}
            >
              {t("salesReports.exportButtonText", "Ekspor PDF")}
            </Button>
          </Space.Compact>
        </Col>
      </Row>

      <Modal
        centered
        open={exportModalOpen}
        title={t("salesReports.exportDialogTitle", "Ekspor Laporan PDF")}
        onCancel={() => setExportModalOpen(false)}
        onOk={handleExportPdf}
        okText={t("salesReports.confirmExportText", "Ekspor")}
        cancelText={t("salesReports.cancelText", "Batal")}
        okButtonProps={{ disabled: selectedSections.length === 0, loading: exportLoading }}
        confirmLoading={exportLoading}
      >
        <p>{t("salesReports.exportDialogDescription", "Ekspor laporan penjualan untuk periode yang dipilih.")}</p>
        <Checkbox.Group
          value={selectedSections}
          onChange={(values) => setSelectedSections(values as SalesPdfSectionKey[])}
          style={{ display: "flex", flexDirection: "column", gap: 8 }}
        >
          {SECTION_OPTIONS.map((option) => (
            <Checkbox key={option.key} value={option.key}>
              {t(option.labelKey)}
            </Checkbox>
          ))}
        </Checkbox.Group>
      </Modal>

      <Row gutter={[20, 20]}>
        <Col span={24}>
        <Card title={t("reports.sales.daily", "Ringkasan Penjualan Harian")}>
          <Table<DailySalesRecord>
            rowKey={(record) => record.sale_date}
            dataSource={dailySales}
            loading={dailyQuery.isLoading}
            pagination={{ pageSize: 30 }}
            scroll={{ x: 760 }}
            columns={[
              {
                title: t("reports.sales.date", "Tanggal"),
                dataIndex: "sale_date",
                render: (value: string) =>
                  new Date(value).toLocaleDateString(locale),
              },
              {
                title: t("reports.sales.orders_count", "Jumlah Order"),
                dataIndex: "orders_count",
                align: "right",
              },
              {
                title: t("reports.sales.total_revenue", "Total Omzet"),
                dataIndex: "total_revenue",
                align: "right",
                render: (value: string | number) =>
                  currencyFormatter.format(Number(value)),
              },
              {
                title: t("reports.sales.aov", "Rata-rata Nilai Order"),
                dataIndex: "average_order_value",
                align: "right",
                render: (value: string | number) =>
                  currencyFormatter.format(Number(value)),
              },
            ]}
            locale={{
              emptyText: t(
                "reports.sales.empty_daily",
                "Tidak ada data pada rentang tanggal ini",
              ),
            }}
          />
        </Card>
      </Col>

      <Col span={24}>
        <Card title={t("reports.sales.sold_products", "Product Terjual")}>
          <Table<SoldProductsRecord>
            rowKey={(record) => record.id}
            dataSource={soldProducts}
            loading={soldProductsQuery.isLoading}
            pagination={{ pageSize: 10 }}
            size="middle"
            scroll={{ x: 860 }}
            columns={[
              {
                title: t("reports.sales.product_name", "Produk"),
                dataIndex: "product_name",
                render: (value: string | null) =>
                  value?.trim() || t("reports.sales.product_unavailable", "Produk tidak tersedia"),
              },
              {
                title: t("reports.sales.quantity", "Jumlah"),
                dataIndex: "quantity",
                align: "right",
                render: (value: number) => Number(value ?? 0).toLocaleString(locale),
              },
              {
                title: t("reports.sales.unit_price", "Harga Satuan"),
                dataIndex: "unit_price",
                align: "right",
                render: (value: string | number) =>
                  currencyFormatter.format(Number(value ?? 0)),
              },
              {
                title: t("reports.sales.subtotal", "Subtotal"),
                dataIndex: "subtotal",
                align: "right",
                render: (value: string | number) => (
                  <Typography.Text strong>
                    {currencyFormatter.format(Number(value ?? 0))}
                  </Typography.Text>
                ),
              },
            ]}
            locale={{
              emptyText: t(
                "reports.sales.empty_sold_products",
                "Belum ada data produk terjual",
              ),
            }}
          />
        </Card>
      </Col>

      <Col xs={24} lg={12}>
        <Card title={t("reports.sales.top_products", "Produk Terlaris")}>
          <Table<ProductSalesRecord>
            rowKey={(record) => record.product_id}
            dataSource={productSales}
            loading={productQuery.isLoading}
            pagination={{ pageSize: 20 }}
            size="small"
            scroll={{ x: 640 }}
            columns={[
              {
                title: t("reports.sales.product_name", "Produk"),
                dataIndex: "product_name",
              },
              {
                title: t("reports.sales.category_name", "Kategori"),
                dataIndex: "category_name",
              },
              {
                title: t("reports.sales.total_qty_sold", "Qty Terjual"),
                dataIndex: "total_qty_sold",
                align: "right",
              },
              {
                title: t("reports.sales.total_revenue", "Total Omzet"),
                dataIndex: "total_revenue",
                align: "right",
                render: (value: string | number) =>
                  currencyFormatter.format(Number(value)),
              },
            ]}
            locale={{
              emptyText: t(
                "reports.sales.empty_products",
                "Belum ada data penjualan produk",
              ),
            }}
          />
        </Card>
      </Col>

      <Col xs={24} lg={12}>
        <Card title={t("reports.sales.top_customers", "Customer Terbesar")}>
          <Table<CustomerSalesRecord>
            rowKey={(record) => record.user_id}
            dataSource={customerSales}
            loading={customerQuery.isLoading}
            pagination={{ pageSize: 20 }}
            size="small"
            scroll={{ x: 640 }}
            columns={[
              {
                title: t("reports.sales.customer_name", "Nama"),
                dataIndex: "full_name",
              },
              {
                title: t("reports.sales.phone_number", "No. HP"),
                dataIndex: "phone_number",
              },
              {
                title: t("reports.sales.orders_count", "Jumlah Order"),
                dataIndex: "orders_count",
                align: "right",
              },
              {
                title: t("reports.sales.total_revenue", "Total Omzet"),
                dataIndex: "total_revenue",
                align: "right",
                render: (value: string | number) =>
                  currencyFormatter.format(Number(value)),
              },
            ]}
            locale={{
              emptyText: t(
                "reports.sales.empty_customers",
                "Belum ada data penjualan per customer",
              ),
            }}
          />
        </Card>
      </Col>
      </Row>
    </>
  );
};
