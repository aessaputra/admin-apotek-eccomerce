import { List, useTable } from "@refinedev/antd";
import { Table } from "antd";

export const ProductList: React.FC = () => {
  const { tableProps } = useTable({
    syncWithLocation: true,
  });

  return (
    <List>
      <Table {...tableProps} rowKey="id">
        <Table.Column dataIndex="name" title="Name" />
        <Table.Column dataIndex="slug" title="Slug" />
        <Table.Column dataIndex="price" title="Price" render={(v) => `Rp ${Number(v || 0).toLocaleString("id-ID")}`} />
        <Table.Column dataIndex="stock" title="Stock" />
        <Table.Column dataIndex="is_active" title="Active" render={(v) => (v ? "Yes" : "No")} />
      </Table>
    </List>
  );
};
