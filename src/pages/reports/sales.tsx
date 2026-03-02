import { useList, useTranslation, type CrudFilters } from "@refinedev/core";
import { useTranslation as useI18nTranslation } from "react-i18next";
import { Card, Col, DatePicker, Row, Table, Typography } from "antd";
import type { Dayjs } from "dayjs";
import { useMemo, useState } from "react";

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

type CustomerSalesRecord = {
  user_id: string;
  full_name: string | null;
  phone_number: string | null;
  orders_count: number;
  total_revenue: string | number;
};

export const SalesReport: React.FC = () => {
  const { translate } = useTranslation();
  const { i18n } = useI18nTranslation();
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);

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
      message: translate("reports.sales.load_error_daily", "Gagal memuat ringkasan harian"),
      description: (error as any)?.message ?? translate("notifications.error"),
      type: "error",
    }),
  });

  const { result: productSalesResult, query: productQuery } = useList<ProductSalesRecord>({
    resource: "report_product_sales",
    pagination: { pageSize: 20 },
    errorNotification: (error) => ({
      message: translate("reports.sales.load_error_products", "Gagal memuat data produk terlaris"),
      description: (error as any)?.message ?? translate("notifications.error"),
      type: "error",
    }),
  });

  const { result: customerSalesResult, query: customerQuery } = useList<CustomerSalesRecord>({
    resource: "report_customer_sales",
    pagination: { pageSize: 20 },
    errorNotification: (error) => ({
      message: translate("reports.sales.load_error_customers", "Gagal memuat data penjualan customer"),
      description: (error as any)?.message ?? translate("notifications.error"),
      type: "error",
    }),
  });

  const dailySales = dailySalesResult?.data ?? [];
  const productSales = productSalesResult?.data ?? [];
  const customerSales = customerSalesResult?.data ?? [];

  return (
    <Row gutter={[16, 16]}>
      <Col span={24}>
        <Row justify="space-between" align="middle" gutter={[16, 16]}>
          <Col>
            <Typography.Title level={3}>
              {translate("reports.sales.title", "Laporan Penjualan")}
            </Typography.Title>
          </Col>
          <Col>
            <DatePicker.RangePicker
              allowClear
              style={{ minWidth: 260 }}
              value={dateRange}
              onChange={(value) => setDateRange(value)}
              placeholder={[
                translate("reports.sales.date_from", "Dari tanggal"),
                translate("reports.sales.date_to", "Sampai tanggal"),
              ]}
            />
          </Col>
        </Row>
      </Col>

      <Col span={24}>
        <Card title={translate("reports.sales.daily", "Ringkasan Penjualan Harian")}>
          <Table<DailySalesRecord>
            rowKey={(record) => record.sale_date}
            dataSource={dailySales}
            loading={dailyQuery.isLoading}
            pagination={{ pageSize: 30 }}
            columns={[
              {
                title: translate("reports.sales.date", "Tanggal"),
                dataIndex: "sale_date",
                render: (value: string) =>
                  new Date(value).toLocaleDateString(locale),
              },
              {
                title: translate("reports.sales.orders_count", "Jumlah Order"),
                dataIndex: "orders_count",
                align: "right",
              },
              {
                title: translate("reports.sales.total_revenue", "Total Omzet"),
                dataIndex: "total_revenue",
                align: "right",
                render: (value: string | number) =>
                  currencyFormatter.format(Number(value)),
              },
              {
                title: translate("reports.sales.aov", "Rata-rata Nilai Order"),
                dataIndex: "average_order_value",
                align: "right",
                render: (value: string | number) =>
                  currencyFormatter.format(Number(value)),
              },
            ]}
            locale={{
              emptyText: translate(
                "reports.sales.empty_daily",
                "Tidak ada data pada rentang tanggal ini",
              ),
            }}
          />
        </Card>
      </Col>

      <Col xs={24} lg={12}>
        <Card title={translate("reports.sales.top_products", "Produk Terlaris")}>
          <Table<ProductSalesRecord>
            rowKey={(record) => record.product_id}
            dataSource={productSales}
            loading={productQuery.isLoading}
            pagination={{ pageSize: 20 }}
            columns={[
              {
                title: translate("reports.sales.product_name", "Produk"),
                dataIndex: "product_name",
              },
              {
                title: translate("reports.sales.category_name", "Kategori"),
                dataIndex: "category_name",
              },
              {
                title: translate("reports.sales.total_qty_sold", "Qty Terjual"),
                dataIndex: "total_qty_sold",
                align: "right",
              },
              {
                title: translate("reports.sales.total_revenue", "Total Omzet"),
                dataIndex: "total_revenue",
                align: "right",
                render: (value: string | number) =>
                  currencyFormatter.format(Number(value)),
              },
            ]}
            locale={{
              emptyText: translate(
                "reports.sales.empty_products",
                "Belum ada data penjualan produk",
              ),
            }}
          />
        </Card>
      </Col>

      <Col xs={24} lg={12}>
        <Card title={translate("reports.sales.top_customers", "Customer Terbesar")}>
          <Table<CustomerSalesRecord>
            rowKey={(record) => record.user_id}
            dataSource={customerSales}
            loading={customerQuery.isLoading}
            pagination={{ pageSize: 20 }}
            columns={[
              {
                title: translate("reports.sales.customer_name", "Nama"),
                dataIndex: "full_name",
              },
              {
                title: translate("reports.sales.phone_number", "No. HP"),
                dataIndex: "phone_number",
              },
              {
                title: translate("reports.sales.orders_count", "Jumlah Order"),
                dataIndex: "orders_count",
                align: "right",
              },
              {
                title: translate("reports.sales.total_revenue", "Total Omzet"),
                dataIndex: "total_revenue",
                align: "right",
                render: (value: string | number) =>
                  currencyFormatter.format(Number(value)),
              },
            ]}
            locale={{
              emptyText: translate(
                "reports.sales.empty_customers",
                "Belum ada data penjualan per customer",
              ),
            }}
          />
        </Card>
      </Col>
    </Row>
  );
};

