import { List, useTable, ShowButton, FilterDropdown, getDefaultFilter } from "@refinedev/antd";
import { Table, Space, Tooltip, Select, Tag } from "antd";

const STATUS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "processing", label: "Processing" },
  { value: "paid", label: "Paid" },
  { value: "shipped", label: "Shipped" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
];

const PAYMENT_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "success", label: "Success" },
  { value: "failed", label: "Failed" },
];

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

export const OrderList: React.FC = () => {
  const { tableProps, filters } = useTable({
    syncWithLocation: true,
  });

  return (
    <List>
      <Table {...tableProps} rowKey="id">
        <Table.Column dataIndex="id" title="ID" width={80} />
        <Table.Column dataIndex="total_amount" title="Total" render={(v) => `Rp ${Number(v || 0).toLocaleString("id-ID")}`} />
        <Table.Column
          dataIndex="status"
          title="Status"
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
                placeholder="Pilih Status"
                allowClear
                options={STATUS_OPTIONS}
              />
            </FilterDropdown>
          )}
          defaultFilteredValue={getDefaultFilter("status", filters, "eq")}
        />
        <Table.Column
          dataIndex="payment_status"
          title="Payment"
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
                placeholder="Pilih Payment"
                allowClear
                options={PAYMENT_OPTIONS}
              />
            </FilterDropdown>
          )}
          defaultFilteredValue={getDefaultFilter("payment_status", filters, "eq")}
        />
        <Table.Column dataIndex="created_at" title="Created" render={(v) => v ? new Date(v).toLocaleDateString() : "-"} />
        <Table.Column
          title="Aksi"
          key="actions"
          align="center"
          width={80}
          render={(_, record: { id: string }) => (
            <Space size="small">
              <Tooltip title="Lihat Detail">
                <ShowButton hideText size="small" recordItemId={record.id} resource="orders" />
              </Tooltip>
            </Space>
          )}
        />
      </Table>
    </List>
  );
};
