import { useEffect } from "react";
import { useShow, useUpdate, useTranslation } from "@refinedev/core";
import { Show, DateField, NumberField } from "@refinedev/antd";
import { Typography, Table, Tag, Descriptions, Form, Select, Input, Button, Card, App } from "antd";
import { STATUS_COLORS, PAYMENT_COLORS, getStatusOptions } from "../../constants/orders";

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

export const OrderShow: React.FC = () => {
  const { translate } = useTranslation();
  const {
    result: record,
    query: { isLoading },
  } = useShow<OrderRecord>({
    meta: { select: "*, order_items(*, products(name))" },
  });

  const { mutate, mutation: { isPending: isUpdating } } = useUpdate();
  const { modal } = App.useApp();
  const [form] = Form.useForm<{ status: string; waybill_number?: string }>();

  const items = record?.order_items ?? [];

  const doMutate = (values: { status: string; waybill_number?: string }) => {
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
          message: translate("orders.saveSuccess"),
          type: "success",
        }),
        errorNotification: () => ({
          message: translate("orders.saveError"),
          type: "error",
        }),
      }
    );
  };

  const handleUpdate = (values: { status: string; waybill_number?: string }) => {
    if (values.status === "cancelled") {
      modal.confirm({
        title: translate("orders.cancelConfirm"),
        content: translate("orders.cancelContent"),
        okText: translate("orders.cancelOk"),
        cancelText: translate("orders.cancelButton"),
        okButtonProps: { danger: true },
        onOk: () => doMutate(values),
      });
      return;
    }
    doMutate(values);
  };

  const STATUS_OPTIONS = getStatusOptions(translate);

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
      title: translate("orders.fields.product"),
      dataIndex: ["products", "name"],
      key: "product",
      render: (_: unknown, row: OrderItem) => row.products?.name ?? "-",
    },
    {
      title: translate("orders.fields.quantity"),
      dataIndex: "quantity",
      key: "quantity",
      width: 80,
    },
    {
      title: translate("orders.fields.unitPrice"),
      dataIndex: "price_at_purchase",
      key: "price",
      render: (v: string | number) =>
        `Rp ${Number(v || 0).toLocaleString("id-ID")}`,
    },
    {
      title: translate("orders.fields.subtotal"),
      key: "subtotal",
      render: (_: unknown, row: OrderItem) =>
        `Rp ${(Number(row.price_at_purchase || 0) * (row.quantity || 0)).toLocaleString("id-ID")}`,
    },
  ];

  return (
    <Show isLoading={isLoading}>
      <Title level={5}>{translate("orders.orderInfo")}</Title>
      <Descriptions bordered size="small" column={1}>
        <Descriptions.Item label={translate("orders.fields.id")}>{record?.id ?? "-"}</Descriptions.Item>
        <Descriptions.Item label={translate("orders.fields.status")}>
          <Tag color={STATUS_COLORS[record?.status ?? ""] ?? "default"}>
            {record?.status ?? "-"}
          </Tag>
        </Descriptions.Item>
        <Descriptions.Item label={translate("orders.fields.paymentStatus")}>
          <Tag color={PAYMENT_COLORS[record?.payment_status ?? ""] ?? "default"}>
            {record?.payment_status ?? "-"}
          </Tag>
        </Descriptions.Item>
        <Descriptions.Item label={translate("orders.fields.paymentType")}>
          <Text>{record?.payment_type ?? "-"}</Text>
        </Descriptions.Item>
        <Descriptions.Item label={translate("orders.fields.date")}>
          <DateField value={record?.created_at} format="LLL" />
        </Descriptions.Item>
      </Descriptions>

      <Title level={5} style={{ marginTop: 24 }}>
        {translate("orders.totalAndShipping")}
      </Title>
      <Descriptions bordered size="small" column={1}>
        <Descriptions.Item label={translate("orders.fields.productSubtotal")}>
          <NumberField
            value={record?.total_amount}
            options={{ style: "currency", currency: "IDR" }}
          />
        </Descriptions.Item>
        <Descriptions.Item label={translate("orders.fields.shippingCost")}>
          {record?.shipping_cost != null
            ? `Rp ${Number(record.shipping_cost).toLocaleString("id-ID")}`
            : "-"}
        </Descriptions.Item>
        <Descriptions.Item label={translate("orders.fields.courier")}>
          {record?.courier_code
            ? `${record.courier_code} - ${record.courier_service ?? ""} (${record.shipping_etd ?? ""})`
            : "-"}
        </Descriptions.Item>
        <Descriptions.Item label={translate("orders.fields.waybillNumber")}>
          <Text strong>{record?.waybill_number ?? "-"}</Text>
        </Descriptions.Item>
      </Descriptions>

      <Card title={translate("orders.updateOrder")} style={{ marginTop: 24 }}>
        <Form
          form={form}
          layout="vertical"
          onFinish={handleUpdate}
          initialValues={{
            status: record?.status ?? "pending",
            waybill_number: record?.waybill_number ?? "",
          }}
        >
          <Form.Item
            name="status"
            label={translate("orders.fields.status")}
            rules={[{ required: true }]}
          >
            <Select options={STATUS_OPTIONS} style={{ minWidth: 160 }} />
          </Form.Item>
          <Form.Item
            name="waybill_number"
            label={translate("orders.fields.waybillNumber")}
            dependencies={["status"]}
            rules={[
              ({ getFieldValue }) => ({
                validator(_, value) {
                  const status = getFieldValue("status");
                  if (status === "shipped" && !value?.trim()) {
                    return Promise.reject(
                      new Error(
                        translate("orders.waybillRequired", {
                          status: translate("orderStatus.shipped"),
                        }),
                      ),
                    );
                  }
                  return Promise.resolve();
                },
              }),
            ]}
          >
            <Input placeholder={translate("orders.waybillPlaceholder")} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={isUpdating}>
              {translate("buttons.save")}
            </Button>
          </Form.Item>
        </Form>
      </Card>

      <Title level={5} style={{ marginTop: 24 }}>
        {translate("orders.productList")}
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
