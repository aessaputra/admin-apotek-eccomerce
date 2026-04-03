import { DeleteButton, EditButton, List, ShowButton, useTable } from "@refinedev/antd";
import { useTranslation } from "@refinedev/core";
import { Space, Table, Tag, Tooltip } from "antd";

export const HomeBannerList: React.FC = () => {
  const { translate } = useTranslation();
  const { tableProps } = useTable({
    resource: "home_banners",
    syncWithLocation: true,
  });

  return (
    <List>
      <Table {...tableProps} rowKey="id">
        <Table.Column dataIndex="placement_key" title={translate("homeBanners.fields.placementKey")} render={(value: string | null) => value ? <Tag color={value === "home_banner_top" ? "green" : "orange"}>{translate(`homeBanners.options.placements.${value}`)}</Tag> : "-"} />
        <Table.Column dataIndex="intent" title={translate("homeBanners.fields.intent")} render={(value: string | null) => value ? <Tag color={value === "promotional" ? "blue" : value === "informational" ? "cyan" : "purple"}>{translate(`homeBanners.options.intents.${value}`)}</Tag> : "-"} />
        <Table.Column dataIndex="title" title={translate("homeBanners.fields.title")} render={(value: string | null) => value || "-"} />
        <Table.Column dataIndex="cta_kind" title={translate("homeBanners.fields.ctaStatus")} render={(value: string | null) => value === "route" ? <Tag color="blue">{translate("homeBanners.status.withCta")}</Tag> : <Tag>{translate("homeBanners.status.noCta")}</Tag>} />
        <Table.Column dataIndex="media_path" title={translate("homeBanners.fields.imageStatus")} render={(value: string | null) => value ? <Tag color="gold">{translate("homeBanners.status.withImage")}</Tag> : <Tag>{translate("homeBanners.status.noImage")}</Tag>} />
        <Table.Column dataIndex="is_active" title={translate("homeBanners.fields.isActive")} render={(value: boolean) => value ? <Tag color="green">{translate("homeBanners.status.active")}</Tag> : <Tag>{translate("homeBanners.status.inactive")}</Tag>} />
        <Table.Column dataIndex="updated_at" title={translate("homeBanners.fields.updatedAt")} render={(value: string | null) => value ? new Date(value).toLocaleString() : "-"} />
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
