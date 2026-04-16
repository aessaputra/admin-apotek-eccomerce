import {
  List,
  useTable,
  EditButton,
  ShowButton,
  DeleteButton,
} from "@refinedev/antd";
import { useTranslation } from "@refinedev/core";
import { Table, Image, Space, Tooltip } from "antd";
import { MEDIA_BUCKET, resolveStoragePublicUrl } from "../../utils/storage";

interface ProductImage { url: string }
interface ProductRecord {
  id: string;
  product_images?: ProductImage[];
  categories?: { name: string } | null;
}

export const ProductList: React.FC = () => {
  const { translate } = useTranslation();
  const { tableProps } = useTable({
    syncWithLocation: true,
    meta: { select: "*, product_images(*), categories(name)" },
  });

  return (
    <List>
      <Table {...tableProps} rowKey="id">
        <Table.Column
          dataIndex={["product_images", 0, "url"]}
          title={translate("products.fields.image")}
          width={80}
          render={(_, record: ProductRecord) => {
            const previewUrl = resolveStoragePublicUrl(record.product_images?.[0]?.url ?? null, MEDIA_BUCKET);
            return previewUrl ? (
              <Image src={previewUrl} alt="" width={40} height={40} style={{ objectFit: "cover" }} />
            ) : (
              "-"
            );
          }}
        />
        <Table.Column dataIndex="name" title={translate("products.fields.name")} />
        <Table.Column dataIndex="slug" title={translate("products.fields.slug")} />
        <Table.Column
          dataIndex={["categories", "name"]}
          title={translate("products.fields.category")}
          render={(_, record: ProductRecord) => record.categories?.name ?? "-"}
        />
        <Table.Column dataIndex="price" title={translate("products.fields.price")} render={(v) => `Rp ${Number(v || 0).toLocaleString("id-ID")}`} />
        <Table.Column dataIndex="stock" title={translate("products.fields.stock")} />
        <Table.Column dataIndex="weight" title={translate("products.fields.weight")} render={(v) => v != null ? `${v} g` : "-"} />
        <Table.Column dataIndex="is_active" title={translate("products.fields.active")} render={(v) => (v ? translate("products.active.yes") : translate("products.active.no"))} />
        <Table.Column
          title={translate("table.actions")}
          dataIndex="actions"
          key="actions"
          align="center"
          width={100}
          fixed="right"
          render={(_, record: ProductRecord) => (
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
