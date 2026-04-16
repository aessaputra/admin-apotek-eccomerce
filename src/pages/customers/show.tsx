import { useParams } from "react-router";
import { useShow, useTranslation } from "@refinedev/core";
import { Show, DateField } from "@refinedev/antd";
import { Typography, Avatar, Space, Tag, Button } from "antd";
import { useBanToggle } from "../../hooks/useBanToggle";
import { MEDIA_BUCKET, resolveStoragePublicUrl } from "../../utils/storage";

const { Title, Text } = Typography;

const ROLE_COLORS: Record<string, string> = {
  admin: "red",
  customer: "blue",
};

export const CustomerShow: React.FC = () => {
  const { translate } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const { handleBan, handleUnban, isPending } = useBanToggle();
  const {
    result: record,
    query: { isLoading },
  } = useShow({
    resource: "profiles",
    id: id ?? "",
  });
  const avatarUrl = resolveStoragePublicUrl(record?.avatar_url ?? null, MEDIA_BUCKET);

  return (
    <Show isLoading={isLoading}>
      <Title level={5}>{translate("customers.fields.profile")}</Title>
      <Space align="center" size="middle">
        <Avatar src={avatarUrl ?? undefined} size={64}>
          {record?.full_name?.[0]?.toUpperCase() ?? "?"}
        </Avatar>
        <span>{record?.full_name || "-"}</span>
      </Space>

      <Title level={5}>{translate("customers.fields.fullName")}</Title>
      <Text>{record?.full_name || "-"}</Text>

      <Title level={5}>{translate("customers.fields.phone")}</Title>
      <Text>{record?.phone_number || "-"}</Text>

      <Title level={5}>{translate("customers.fields.role")}</Title>
      <Tag color={ROLE_COLORS[record?.role] ?? "default"}>
        {record?.role || "-"}
      </Tag>

      <Title level={5}>{translate("customers.fields.status")}</Title>
      <Space>
        <Tag color={record?.is_banned ? "red" : "green"}>
          {record?.is_banned ? translate("customers.statusBanned") : translate("customers.statusActive")}
        </Tag>
        {record?.role === "customer" && id &&
          (record?.is_banned ? (
            <Button
              type="primary"
              size="small"
              loading={isPending}
              onClick={() => handleUnban({ id, full_name: record?.full_name })}
            >
              {translate("customers.unban")}
            </Button>
          ) : (
            <Button
              danger
              size="small"
              loading={isPending}
              onClick={() => handleBan({ id, full_name: record?.full_name })}
            >
              {translate("customers.ban")}
            </Button>
          ))}
      </Space>

      <Title level={5}>{translate("customers.fields.joined")}</Title>
      <DateField value={record?.created_at} format="LLL" />
    </Show>
  );
};
