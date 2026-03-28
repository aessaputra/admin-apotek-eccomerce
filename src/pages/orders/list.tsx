import { List, useTable, ShowButton, FilterDropdown, getDefaultFilter } from "@refinedev/antd";
import { useTranslation } from "@refinedev/core";
import { Table, Space, Tooltip, Select, Tag } from "antd";
import { STATUS_COLORS, PAYMENT_COLORS, getStatusOptions, getPaymentOptions } from "../../constants/orders";

export const OrderList: React.FC = () => {
  const { translate } = useTranslation();
  const { tableProps, filters } = useTable({
    syncWithLocation: true,
    sorters: {
      initial: [
        {
          field: "created_at",
          order: "desc",
        },
      ],
    },
  });

  const STATUS_OPTIONS = getStatusOptions(translate);
  const PAYMENT_OPTIONS = getPaymentOptions(translate);

  return (
    <List>
      <Table {...tableProps} rowKey="id">
        <Table.Column dataIndex="id" title={translate("orders.fields.id")} width={80} />
        <Table.Column dataIndex="total_amount" title={translate("orders.fields.total")} render={(v) => `Rp ${Number(v || 0).toLocaleString("id-ID")}`} />
        <Table.Column
          dataIndex="status"
          title={translate("orders.fields.status")}
          render={(v: string) => (
            <Tag color={STATUS_COLORS[v] ?? "default"}>{v ?? "-"}</Tag>
          )}
          filterDropdown={(props) => (
            <FilterDropdown
              {...props}
              mapValue={(val, event) =>
                event === "value"
                  ? (Array.isArray(val) ? val[0] : val)
                  : val
                  ? [val]
                  : []
              }
            >
              <Select
                style={{ minWidth: 120 }}
                placeholder={translate("orders.filterStatus")}
                allowClear
                options={STATUS_OPTIONS}
              />
            </FilterDropdown>
          )}
          defaultFilteredValue={getDefaultFilter("status", filters, "eq")}
        />
        <Table.Column
          dataIndex="payment_status"
          title={translate("orders.fields.payment")}
          render={(v: string) => (
            <Tag color={PAYMENT_COLORS[v] ?? "default"}>{v ?? "-"}</Tag>
          )}
          filterDropdown={(props) => (
            <FilterDropdown
              {...props}
              mapValue={(val, event) =>
                event === "value"
                  ? (Array.isArray(val) ? val[0] : val)
                  : val
                  ? [val]
                  : []
              }
            >
              <Select
                style={{ minWidth: 120 }}
                placeholder={translate("orders.filterPayment")}
                allowClear
                options={PAYMENT_OPTIONS}
              />
            </FilterDropdown>
          )}
          defaultFilteredValue={getDefaultFilter("payment_status", filters, "eq")}
        />
        <Table.Column dataIndex="payment_type" title={translate("orders.fields.paymentType")} render={(v) => v || "-"} />
        <Table.Column dataIndex="courier_code" title={translate("orders.fields.courierCode")} render={(v) => v || "-"} />
        <Table.Column dataIndex="waybill_number" title={translate("orders.fields.waybillNumber")} render={(v) => v || "-"} />
        <Table.Column dataIndex="created_at" title={translate("orders.fields.created")} render={(v) => v ? new Date(v).toLocaleDateString() : "-"} />
        <Table.Column
          title={translate("table.actions")}
          key="actions"
          align="center"
          width={80}
          render={(_, record: { id: string }) => (
            <Space size="small">
              <Tooltip title={translate("orders.showDetail")}>
                <ShowButton hideText size="small" recordItemId={record.id} resource="orders" />
              </Tooltip>
            </Space>
          )}
        />
      </Table>
    </List>
  );
};
