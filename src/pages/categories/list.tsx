import { List, useTable } from "@refinedev/antd";
import { Table, Image } from "antd";

export const CategoryList: React.FC = () => {
  const { tableProps } = useTable({
    syncWithLocation: true,
  });

  return (
    <List>
      <Table {...tableProps} rowKey="id">
        <Table.Column
          dataIndex="logo_url"
          title="Logo"
          width={80}
          render={(url: string) =>
            url ? (
              <Image src={url} alt="" width={40} height={40} style={{ objectFit: "cover" }} />
            ) : (
              "-"
            )
          }
        />
        <Table.Column dataIndex="name" title="Name" />
        <Table.Column dataIndex="slug" title="Slug" />
      </Table>
    </List>
  );
};
