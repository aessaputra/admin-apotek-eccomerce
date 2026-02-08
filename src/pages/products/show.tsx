import { useShow } from "@refinedev/core";
import { Show, NumberField } from "@refinedev/antd";
import { Typography, Image, Tag, Space } from "antd";

const { Title, Text } = Typography;

interface ProductImage {
  id: string;
  url: string;
  sort_order?: number;
}

interface ProductRecord {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  price: string | number;
  stock?: number | null;
  is_active?: boolean | null;
  category_id?: string | null;
  created_at?: string;
  updated_at?: string;
  product_images?: ProductImage[];
  categories?: { name: string } | null;
}

export const ProductShow: React.FC = () => {
  const {
    result: record,
    query: { isLoading },
  } = useShow<ProductRecord>({
    meta: { select: "*, product_images(*), categories(name)" },
  });

  const images = (record?.product_images ?? [])
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  return (
    <Show isLoading={isLoading}>
      <Title level={5}>Gambar</Title>
      {images.length > 0 ? (
        <Space wrap size="middle">
          {images.map((img) => (
            <Image
              key={img.id}
              src={img.url}
              alt=""
              width={120}
              height={120}
              style={{ objectFit: "cover", borderRadius: 8 }}
            />
          ))}
        </Space>
      ) : (
        <Text type="secondary">-</Text>
      )}

      <Title level={5}>Nama</Title>
      <Text>{record?.name ?? "-"}</Text>

      <Title level={5}>Slug</Title>
      <Text>{record?.slug ?? "-"}</Text>

      <Title level={5}>Deskripsi</Title>
      <Text>{record?.description || "-"}</Text>

      <Title level={5}>Harga</Title>
      <NumberField
        value={record?.price}
        options={{ style: "currency", currency: "IDR" }}
      />

      <Title level={5}>Stok</Title>
      <Text>{record?.stock ?? 0}</Text>

      <Title level={5}>Kategori</Title>
      <Text>{record?.categories?.name ?? "-"}</Text>

      <Title level={5}>Status</Title>
      <Tag color={record?.is_active ? "green" : "default"}>
        {record?.is_active ? "Aktif" : "Nonaktif"}
      </Tag>

      {record?.created_at && (
        <>
          <Title level={5}>Dibuat</Title>
          <Text>{new Date(record.created_at).toLocaleString("id-ID")}</Text>
        </>
      )}
    </Show>
  );
};
