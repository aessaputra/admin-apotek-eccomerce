import {
  List,
  useTable,
  EditButton,
  ShowButton,
  DeleteButton,
} from "@refinedev/antd";
import { useTranslation } from "@refinedev/core";
import { Table, Image, Space, Tooltip } from "antd";

export const CategoryList: React.FC = () => {
  const { translate } = useTranslation();
  const { tableProps } = useTable({
    syncWithLocation: true,
  });

  return (
    <List>
      <Table {...tableProps} rowKey="id">
        <Table.Column
          dataIndex="logo_url"
          title={translate("categories.fields.logo")}
          width={80}
          render={(url: string) =>
            url ? (
              <Image src={url} alt="" width={40} height={40} style={{ objectFit: "cover" }} />
            ) : (
              "-"
            )
          }
        />
        <Table.Column dataIndex="name" title={translate("categories.fields.name")} />
        <Table.Column dataIndex="slug" title={translate("categories.fields.slug")} />
        <Table.Column
          title={translate("table.actions")}
          dataIndex="actions"
          key="actions"
          align="center"
          width={100}
          fixed="right"
          render={(_, record: { id: string }) => (
            <Space size="small">
              <Tooltip title={translate("actions.show")}>
                <span>
                  <ShowButton hideText size="small" recordItemId={record.id} />
                </span>
              </Tooltip>
              <Tooltip title={translate("actions.edit")}>
                <span>
                  <EditButton hideText size="small" recordItemId={record.id} />
                </span>
              </Tooltip>
              <Tooltip title={translate("actions.delete")}>
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
