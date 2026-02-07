import {
  List,
  useTable,
  EditButton,
  DeleteButton,
} from "@refinedev/antd";
import { Table, Image, Space, Tooltip } from "antd";

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
        <Table.Column
          title="Aksi"
          dataIndex="actions"
          key="actions"
          align="center"
          width={100}
          fixed="right"
          render={(_, record: { id: string }) => (
            <Space size="small">
              <Tooltip title="Edit">
                <span>
                  <EditButton hideText size="small" recordItemId={record.id} />
                </span>
              </Tooltip>
              <Tooltip title="Hapus">
                <span>
                  <DeleteButton hideText size="small" recordItemId={record.id} />
                </span>
              </Tooltip>
            </Space>
          )}
        />
      </Table>
    </List>
  );
};
