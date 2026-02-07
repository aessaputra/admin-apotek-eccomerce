import { List, useTable } from "@refinedev/antd";
import { Table } from "antd";

export const OrderList: React.FC = () => {
  const { tableProps } = useTable({
    syncWithLocation: true,
  });

  return (
    <List>
      <Table {...tableProps} rowKey="id">
        <Table.Column dataIndex="id" title="ID" width={80} />
        <Table.Column dataIndex="total_amount" title="Total" render={(v) => `Rp ${Number(v || 0).toLocaleString("id-ID")}`} />
        <Table.Column dataIndex="status" title="Status" />
        <Table.Column dataIndex="payment_status" title="Payment" />
        <Table.Column dataIndex="created_at" title="Created" render={(v) => v ? new Date(v).toLocaleDateString() : "-"} />
      </Table>
    </List>
  );
};
