import { useParams } from "react-router";
import { useShow, useTranslation, useInvalidate } from "@refinedev/core";
import { Show, DateField } from "@refinedev/antd";
import { useMutation } from "@tanstack/react-query";
import { Typography, Avatar, Space, Tag, Button, App } from "antd";
import { supabaseClient } from "../../providers/supabase-client";
import { getFunctionsErrorMessage } from "../../utils/functions-error";

const { Title, Text } = Typography;

const ROLE_COLORS: Record<string, string> = {
  admin: "red",
  customer: "blue",
};

export const CustomerShow: React.FC = () => {
  const { translate } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const invalidate = useInvalidate();
  const { modal } = App.useApp();
  const {
    result: record,
    query: { isLoading },
  } = useShow({
    resource: "profiles",
    id: id ?? "",
  });

  const { mutate, isPending } = useMutation({
    mutationFn: async ({
      userId,
      action,
    }: {
      userId: string;
      action: "ban" | "unban";
    }) => {
      const { data, error } = await supabaseClient.functions.invoke(
        "ban-customer",
        { body: { userId, action } }
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidate({ resource: "profiles", invalidates: ["list", "detail"] });
    },
  });

  const handleBan = () => {
    if (!id) return;
    modal.confirm({
      title: translate("customers.banConfirm"),
      content: translate("customers.banContent", {
        name: record?.full_name || id,
      }),
      okText: translate("customers.banOk"),
      cancelText: translate("buttons.cancel"),
      okButtonProps: { danger: true },
      onOk: () =>
        mutate(
          { userId: id, action: "ban" },
          {
            onSuccess: () =>
              modal.success({ content: translate("customers.banSuccess") }),
            onError: async (e: unknown) => {
              const msg = await getFunctionsErrorMessage(
                e,
                translate("customers.banError")
              );
              modal.error({ content: msg });
            },
          }
        ),
    });
  };

  const handleUnban = () => {
    if (!id) return;
    mutate(
      { userId: id, action: "unban" },
      {
        onSuccess: () =>
          modal.success({ content: translate("customers.unbanSuccess") }),
        onError: async (e: unknown) => {
          const msg = await getFunctionsErrorMessage(
            e,
            translate("customers.unbanError")
          );
          modal.error({ content: msg });
        },
      }
    );
  };

  return (
    <Show isLoading={isLoading}>
      <Title level={5}>{translate("customers.fields.profile")}</Title>
      <Space align="center" size="middle">
        <Avatar src={record?.avatar_url} size={64}>
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
        {record?.role === "customer" &&
          (record?.is_banned ? (
            <Button
              type="primary"
              size="small"
              loading={isPending}
              onClick={handleUnban}
            >
              {translate("customers.unban")}
            </Button>
          ) : (
            <Button
              danger
              size="small"
              loading={isPending}
              onClick={handleBan}
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
