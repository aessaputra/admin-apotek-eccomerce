import {
  List,
  useTable,
  DateField,
  ShowButton,
  getDefaultSortOrder,
  FilterDropdown,
} from "@refinedev/antd";
import { useTranslation, useInvalidate } from "@refinedev/core";
import { useMutation } from "@tanstack/react-query";
import { Table, Space, Avatar, Input, Tooltip, Tag, Button, App } from "antd";
import { supabaseClient } from "../../providers/supabase-client";
import { getFunctionsErrorMessage } from "../../utils/functions-error";

export const CustomerList: React.FC = () => {
  const { translate } = useTranslation();
  const invalidate = useInvalidate();
  const { modal } = App.useApp();
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

  const handleBan = (record: { id: string; full_name?: string }) => {
    modal.confirm({
      title: translate("customers.banConfirm"),
      content: translate("customers.banContent", {
        name: record.full_name || record.id,
      }),
      okText: translate("customers.banOk"),
      cancelText: translate("buttons.cancel"),
      okButtonProps: { danger: true },
      onOk: () =>
        mutate(
          { userId: record.id, action: "ban" },
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

  const handleUnban = (record: { id: string; full_name?: string }) => {
    mutate(
      { userId: record.id, action: "unban" },
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

  const { tableProps, sorters } = useTable({
    syncWithLocation: true,
    filters: {
      initial: [
        { field: "role", operator: "eq" as const, value: "customer" },
        { field: "full_name", operator: "contains" as const, value: "" },
        { field: "phone_number", operator: "contains" as const, value: "" },
      ],
    },
  });

  return (
    <List>
      <Table {...tableProps} rowKey="id">
        <Table.Column
          dataIndex="full_name"
          title={translate("customers.fields.customer")}
          sorter
          defaultSortOrder={getDefaultSortOrder("full_name", sorters)}
          filterDropdown={(props) => (
            <FilterDropdown {...props}>
              <Input placeholder={translate("customers.searchName")} allowClear />
            </FilterDropdown>
          )}
          render={(_, record: { full_name?: string; avatar_url?: string }) => (
            <Space>
              <Avatar src={record.avatar_url} size="small">
                {record.full_name?.[0]?.toUpperCase() ?? "?"}
              </Avatar>
              <span>{record.full_name || "-"}</span>
            </Space>
          )}
        />
        <Table.Column
          dataIndex="phone_number"
          title={translate("customers.fields.phone")}
          render={(v) => v || "-"}
          filterDropdown={(props) => (
            <FilterDropdown {...props}>
              <Input placeholder={translate("customers.searchPhone")} allowClear />
            </FilterDropdown>
          )}
        />
        <Table.Column
          dataIndex="created_at"
          title={translate("customers.fields.joined")}
          sorter
          defaultSortOrder={getDefaultSortOrder("created_at", sorters)}
          render={(value) => <DateField value={value} format="LL" />}
        />
        <Table.Column
          dataIndex="is_banned"
          title={translate("customers.fields.status")}
          render={(v: boolean) => (
            <Tag color={v ? "red" : "green"}>
              {v ? translate("customers.statusBanned") : translate("customers.statusActive")}
            </Tag>
          )}
        />
        <Table.Column
          title={translate("table.actions")}
          dataIndex="actions"
          key="actions"
          align="center"
          width={180}
          fixed="right"
          render={(_, record: { id: string; is_banned?: boolean; full_name?: string }) => (
            <Space size="small">
              <Tooltip title={translate("customers.showDetail")}>
                <span>
                  <ShowButton hideText size="small" recordItemId={record.id} resource="profiles" />
                </span>
              </Tooltip>
              {record.is_banned ? (
                <Tooltip title={translate("customers.unbanTooltip")}>
                  <Button
                    type="primary"
                    size="small"
                    loading={isPending}
                    onClick={() => handleUnban(record)}
                  >
                    {translate("customers.unban")}
                  </Button>
                </Tooltip>
              ) : (
                <Tooltip title={translate("customers.banTooltip")}>
                  <Button
                    danger
                    size="small"
                    loading={isPending}
                    onClick={() => handleBan(record)}
                  >
                    {translate("customers.ban")}
                  </Button>
                </Tooltip>
              )}
            </Space>
          )}
        />
      </Table>
    </List>
  );
};
