import { useEffect } from "react";
import { useShow, useUpdate } from "@refinedev/core";
import { Show, DateField, NumberField } from "@refinedev/antd";
import { Typography, Table, Tag, Descriptions, Form, Select, Input, Button, Card } from "antd";

const { Title, Text } = Typography;

interface OrderItem {
  id: string;
  product_id: string;
  quantity: number;
  price_at_purchase: string | number;
  products?: { name: string } | null;
}

interface OrderRecord {
  id: string;
  total_amount: string | number;
  status: string;
  payment_status: string;
  shipping_cost?: string | number | null;
  courier_code?: string | null;
  courier_service?: string | null;
  shipping_etd?: string | null;
  waybill_number?: string | null;
  payment_type?: string | null;
  created_at: string;
  order_items?: OrderItem[];
}

const STATUS_COLORS: Record<string, string> = {
  pending: "orange",
  processing: "blue",
  paid: "green",
  shipped: "cyan",
  delivered: "green",
  cancelled: "red",
};

const PAYMENT_COLORS: Record<string, string> = {
  pending: "orange",
  success: "green",
  failed: "red",
};

const STATUS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "processing", label: "Processing" },
  { value: "paid", label: "Paid" },
  { value: "shipped", label: "Shipped" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
];

export const OrderShow: React.FC = () => {
  const {
    result: record,
    query: { isLoading },
  } = useShow<OrderRecord>({
    meta: { select: "*, order_items(*, products(name))" },
  });

  const { mutate, mutation: { isPending: isUpdating } } = useUpdate();

  const [form] = Form.useForm<{ status: string; waybill_number?: string }>();

  const items = record?.order_items ?? [];

  const handleUpdate = (values: { status: string; waybill_number?: string }) => {
    if (!record?.id) return;
    mutate(
      {
        resource: "orders",
        id: record.id,
        values: {
          status: values.status,
          waybill_number: values.waybill_number?.trim() || null,
        },
        successNotification: () => ({
          message: "Pesanan berhasil diperbarui",
          type: "success",
        }),
        errorNotification: () => ({
          message: "Gagal memperbarui pesanan",
          type: "error",
        }),
      }
    );
  };

  useEffect(() => {
    if (record) {
      form.setFieldsValue({
        status: record.status ?? "pending",
        waybill_number: record.waybill_number ?? "",
      });
    }
  }, [record, form]);

  const columns = [
    {
      title: "Produk",
      dataIndex: ["products", "name"],
      key: "product",
      render: (_: unknown, row: OrderItem) => row.products?.name ?? "-",
    },
    {
      title: "Qty",
      dataIndex: "quantity",
      key: "quantity",
      width: 80,
    },
    {
      title: "Harga Satuan",
      dataIndex: "price_at_purchase",
      key: "price",
      render: (v: string | number) =>
        `Rp ${Number(v || 0).toLocaleString("id-ID")}`,
    },
    {
      title: "Subtotal",
      key: "subtotal",
      render: (_: unknown, row: OrderItem) =>
        `Rp ${(Number(row.price_at_purchase || 0) * (row.quantity || 0)).toLocaleString("id-ID")}`,
    },
  ];

  return (
    <Show isLoading={isLoading}>
      <Title level={5}>Informasi Pesanan</Title>
      <Descriptions bordered size="small" column={1}>
        <Descriptions.Item label="ID">{record?.id ?? "-"}</Descriptions.Item>
        <Descriptions.Item label="Status">
          <Tag color={STATUS_COLORS[record?.status ?? ""] ?? "default"}>
            {record?.status ?? "-"}
          </Tag>
        </Descriptions.Item>
        <Descriptions.Item label="Status Pembayaran">
          <Tag color={PAYMENT_COLORS[record?.payment_status ?? ""] ?? "default"}>
            {record?.payment_status ?? "-"}
          </Tag>
        </Descriptions.Item>
        <Descriptions.Item label="Tipe Pembayaran">
          <Text>{record?.payment_type ?? "-"}</Text>
        </Descriptions.Item>
        <Descriptions.Item label="Tanggal">
          <DateField value={record?.created_at} format="LLL" />
        </Descriptions.Item>
      </Descriptions>

      <Title level={5} style={{ marginTop: 24 }}>
        Total & Ongkir
      </Title>
      <Descriptions bordered size="small" column={1}>
        <Descriptions.Item label="Subtotal Produk">
          <NumberField
            value={record?.total_amount}
            options={{ style: "currency", currency: "IDR" }}
          />
        </Descriptions.Item>
        <Descriptions.Item label="Ongkos Kirim">
          {record?.shipping_cost != null
            ? `Rp ${Number(record.shipping_cost).toLocaleString("id-ID")}`
            : "-"}
        </Descriptions.Item>
        <Descriptions.Item label="Kurir">
          {record?.courier_code
            ? `${record.courier_code} - ${record.courier_service ?? ""} (${record.shipping_etd ?? ""})`
            : "-"}
        </Descriptions.Item>
        <Descriptions.Item label="No. Resi">
          <Text strong>{record?.waybill_number ?? "-"}</Text>
        </Descriptions.Item>
      </Descriptions>

      {record && !isLoading && (
        <Card title="Update Pesanan" style={{ marginTop: 24 }}>
          <Form
            form={form}
            layout="vertical"
            onFinish={handleUpdate}
            initialValues={{
              status: record.status ?? "pending",
              waybill_number: record.waybill_number ?? "",
            }}
          >
            <Form.Item
              name="status"
              label="Status"
              rules={[{ required: true }]}
            >
              <Select options={STATUS_OPTIONS} style={{ minWidth: 160 }} />
            </Form.Item>
            <Form.Item name="waybill_number" label="No. Resi">
              <Input placeholder="Masukkan nomor resi setelah pengiriman" />
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit" loading={isUpdating}>
                Simpan
              </Button>
            </Form.Item>
          </Form>
        </Card>
      )}

      <Title level={5} style={{ marginTop: 24 }}>
        Daftar Produk
      </Title>
      <Table
        dataSource={items}
        columns={columns}
        rowKey="id"
        pagination={false}
        size="small"
      />
    </Show>
  );
};
