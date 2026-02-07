import { useParams } from "react-router";
import { useShow } from "@refinedev/core";
import { Show, DateField } from "@refinedev/antd";
import { Typography, Avatar, Space, Tag } from "antd";

const { Title, Text } = Typography;

const ROLE_COLORS: Record<string, string> = {
  admin: "red",
  customer: "blue",
};

export const CustomerShow: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { query } = useShow({
    resource: "profiles",
    id: id ?? "",
  });
  const { data, isLoading } = query;
  const record = data?.data;

  return (
    <Show isLoading={isLoading}>
      <Title level={5}>Profil</Title>
      <Space align="center" size="middle">
        <Avatar src={record?.avatar_url} size={64}>
          {record?.full_name?.[0]?.toUpperCase() ?? "?"}
        </Avatar>
        <span>{record?.full_name || "-"}</span>
      </Space>

      <Title level={5}>Nama Lengkap</Title>
      <Text>{record?.full_name || "-"}</Text>

      <Title level={5}>Telepon</Title>
      <Text>{record?.phone_number || "-"}</Text>

      <Title level={5}>Role</Title>
      <Tag color={ROLE_COLORS[record?.role] ?? "default"}>
        {record?.role || "-"}
      </Tag>

      <Title level={5}>Bergabung</Title>
      <DateField value={record?.created_at} format="LLL" />
    </Show>
  );
};
