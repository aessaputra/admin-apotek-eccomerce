import { useTranslation, useInvalidate } from "@refinedev/core";
import { useMutation } from "@tanstack/react-query";
import { App } from "antd";
import { supabaseClient } from "../providers/supabase-client";
import { getFunctionsErrorMessage } from "../utils/functions-error";

export function useBanToggle() {
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
    modal.confirm({
      title: translate("customers.unbanConfirm"),
      content: translate("customers.unbanContent", {
        name: record.full_name || record.id,
      }),
      okText: translate("customers.unbanOk"),
      cancelText: translate("buttons.cancel"),
      onOk: () =>
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
        ),
    });
  };

  return { handleBan, handleUnban, isPending };
}
