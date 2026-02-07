import {
  List,
  useTable,
  EditButton,
  DeleteButton,
} from "@refinedev/antd";
import { Table, Image, Space, Tooltip } from "antd";

interface ProductImage { url: string }
interface ProductRecord {
  id: string;
  product_images?: ProductImage[];
  categories?: { name: string } | null;
}

export const ProductList: React.FC = () => {
  const { tableProps } = useTable({
    syncWithLocation: true,
    meta: { select: "*, product_images(*), categories(name)" },
  });

  return (
    <List>
      <Table {...tableProps} rowKey="id">
        <Table.Column
          dataIndex={["product_images", 0, "url"]}
          title="Gambar"
          width={80}
          render={(_, record: ProductRecord) => {
            const url = record.product_images?.[0]?.url;
            return url ? (
              <Image src={url} alt="" width={40} height={40} style={{ objectFit: "cover" }} />
            ) : (
              "-"
            );
          }}
        />
        <Table.Column dataIndex="name" title="Name" />
        <Table.Column dataIndex="slug" title="Slug" />
        <Table.Column
          dataIndex={["categories", "name"]}
          title="Category"
          render={(_, record: ProductRecord) => record.categories?.name ?? "-"}
        />
        <Table.Column dataIndex="price" title="Price" render={(v) => `Rp ${Number(v || 0).toLocaleString("id-ID")}`} />
        <Table.Column dataIndex="stock" title="Stock" />
        <Table.Column dataIndex="is_active" title="Active" render={(v) => (v ? "Yes" : "No")} />
        <Table.Column
          title="Aksi"
          dataIndex="actions"
          key="actions"
          align="center"
          width={100}
          fixed="right"
          render={(_, record: ProductRecord) => (
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
