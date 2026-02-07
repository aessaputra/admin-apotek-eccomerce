import {
  List,
  useTable,
  DateField,
  ShowButton,
  getDefaultSortOrder,
  FilterDropdown,
} from "@refinedev/antd";
import { Table, Space, Avatar, Input, Tooltip } from "antd";

export const CustomerList: React.FC = () => {
  const { tableProps, sorters } = useTable({
    syncWithLocation: true,
    filters: {
      initial: [
        { field: "role", operator: "eq" as const, value: "customer" },
        { field: "full_name", operator: "contains" as const, value: "" },
        { field: "phone_number", operator: "contains" as const, value: "" },
      ],
    },
  });

  return (
    <List>
      <Table {...tableProps} rowKey="id">
        <Table.Column
          dataIndex="full_name"
          title="Customer"
          sorter
          defaultSortOrder={getDefaultSortOrder("full_name", sorters)}
          filterDropdown={(props) => (
            <FilterDropdown {...props}>
              <Input placeholder="Cari nama" allowClear />
            </FilterDropdown>
          )}
          render={(_, record: { full_name?: string; avatar_url?: string }) => (
            <Space>
              <Avatar src={record.avatar_url} size="small">
                {record.full_name?.[0]?.toUpperCase() ?? "?"}
              </Avatar>
              <span>{record.full_name || "-"}</span>
            </Space>
          )}
        />
        <Table.Column
          dataIndex="phone_number"
          title="Telepon"
          render={(v) => v || "-"}
          filterDropdown={(props) => (
            <FilterDropdown {...props}>
              <Input placeholder="Cari nomor" allowClear />
            </FilterDropdown>
          )}
        />
        <Table.Column
          dataIndex="created_at"
          title="Bergabung"
          sorter
          defaultSortOrder={getDefaultSortOrder("created_at", sorters)}
          render={(value) => <DateField value={value} format="LL" />}
        />
        <Table.Column
          title="Aksi"
          dataIndex="actions"
          key="actions"
          align="center"
          width={80}
          fixed="right"
          render={(_, record: { id: string }) => (
            <Space size="small">
              <Tooltip title="Lihat detail">
                <span>
                  <ShowButton hideText size="small" recordItemId={record.id} />
                </span>
              </Tooltip>
            </Space>
          )}
        />
      </Table>
    </List>
  );
};
