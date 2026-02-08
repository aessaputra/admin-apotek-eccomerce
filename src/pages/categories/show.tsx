import { useShow } from "@refinedev/core";
import { Show } from "@refinedev/antd";
import { Typography, Image } from "antd";

const { Title, Text } = Typography;

interface CategoryRecord {
  id: string;
  name: string;
  slug: string;
  logo_url?: string | null;
  created_at?: string;
}

export const CategoryShow: React.FC = () => {
  const {
    result: record,
    query: { isLoading },
  } = useShow<CategoryRecord>();

  return (
    <Show isLoading={isLoading}>
      <Title level={5}>Logo</Title>
      {record?.logo_url ? (
        <Image
          src={record.logo_url}
          alt=""
          width={80}
          height={80}
          style={{ objectFit: "cover", borderRadius: 8 }}
        />
      ) : (
        <Text type="secondary">-</Text>
      )}

      <Title level={5}>Nama</Title>
      <Text>{record?.name ?? "-"}</Text>

      <Title level={5}>Slug</Title>
      <Text>{record?.slug ?? "-"}</Text>

      {record?.created_at && (
        <>
          <Title level={5}>Dibuat</Title>
          <Text>{new Date(record.created_at).toLocaleString("id-ID")}</Text>
        </>
      )}
    </Show>
  );
};
