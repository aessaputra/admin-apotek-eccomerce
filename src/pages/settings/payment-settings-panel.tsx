import { useTranslation } from "@refinedev/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Modal, Space, Switch, Typography, message, theme } from "antd";
import { useEffect, useMemo, useState } from "react";
import {
  integrationConfigClient,
  type IntegrationConfigSummaryRow,
} from "./integration-config-client";
import { INTEGRATION_CONFIG_OWNERSHIP } from "./integration-config-ownership";
import {
  OperationalConfigRow,
  SecretReplacementInput,
  createBlankSecretReplacementDraft,
  type SecretReplacementDraft,
} from "./integration-config-primitives";

const PAYMENT_CONFIG_KEYS = INTEGRATION_CONFIG_OWNERSHIP.payment;
const PAYMENT_SAVE_REASON = "settings_payment_save";
const PAYMENT_SUMMARY_QUERY_KEY = ["integration-config", "summary", "payment"] as const;

function getBooleanValue(row: IntegrationConfigSummaryRow | undefined): boolean {
  return row?.non_secret_value === true;
}

function withPaymentDisplay(
  row: IntegrationConfigSummaryRow,
  displayName: string,
  description: string
): IntegrationConfigSummaryRow {
  return { ...row, display_name: displayName, description };
}

export const PaymentSettingsPanel: React.FC = () => {
  const { translate } = useTranslation();
  const { token } = theme.useToken();
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const [serverKeyDraft, setServerKeyDraft] = useState<SecretReplacementDraft>(() => createBlankSecretReplacementDraft());
  const [modeDraft, setModeDraft] = useState(false);

  const summaryQuery = useQuery({
    queryKey: PAYMENT_SUMMARY_QUERY_KEY,
    queryFn: () => integrationConfigClient.summary([...PAYMENT_CONFIG_KEYS]),
  });

  const rowsByKey = useMemo(
    () => new Map((summaryQuery.data?.rows ?? []).map((row) => [row.key_name, row])),
    [summaryQuery.data]
  );

  const serverKeyRow = rowsByKey.get("midtrans.server_key");
  const modeRow = rowsByKey.get("midtrans.is_production");
  const persistedMode = getBooleanValue(modeRow);
  const modeHasChanged = modeDraft !== persistedMode;

  useEffect(() => {
    setModeDraft(getBooleanValue(modeRow));
  }, [modeRow]);

  const refreshPaymentSummary = async () => {
    await queryClient.invalidateQueries({ queryKey: PAYMENT_SUMMARY_QUERY_KEY });
  };

  const rotateServerKeyMutation = useMutation({
    mutationFn: (secret: string) =>
      integrationConfigClient.rotateSecret("midtrans.server_key", secret, PAYMENT_SAVE_REASON),
    onSuccess: async () => {
      setServerKeyDraft(createBlankSecretReplacementDraft());
      messageApi.success(translate("settings.payment.serverKey.saveSuccess", {}, "Midtrans server key saved."));
      await refreshPaymentSummary();
    },
    onError: () => {
      messageApi.error(translate("settings.payment.serverKey.saveError", {}, "Midtrans server key could not be saved."));
    },
  });

  const updateModeMutation = useMutation({
    mutationFn: (value: boolean) =>
      integrationConfigClient.updateValue("midtrans.is_production", value, PAYMENT_SAVE_REASON),
    onSuccess: async () => {
      messageApi.success(translate("settings.payment.mode.saveSuccess", {}, "Mode pembayaran Midtrans tersimpan."));
      await refreshPaymentSummary();
    },
    onError: () => {
      messageApi.error(translate("settings.payment.mode.saveError", {}, "Mode pembayaran Midtrans gagal disimpan."));
    },
  });

  const saveServerKey = () => {
    const secret = serverKeyDraft.value.trim();
    if (!secret) return;
    rotateServerKeyMutation.mutate(secret);
  };

  const saveMode = () => {
    if (!modeHasChanged) return;

    if (!persistedMode && modeDraft) {
      Modal.confirm({
        title: translate("settings.payment.mode.confirmProduction.title", {}, "Aktifkan Produksi?"),
        content: translate(
          "settings.payment.mode.confirmProduction.content",
          {},
          "Transaksi pelanggan akan memakai Midtrans produksi."
        ),
        okText: translate("settings.payment.mode.confirmProduction.ok", {}, "Aktifkan"),
        cancelText: translate("settings.payment.mode.confirmProduction.cancel", {}, "Batal"),
        onOk: () => updateModeMutation.mutate(true),
      });
      return;
    }

    updateModeMutation.mutate(modeDraft);
  };

  const paymentPanelLabel = translate("settings.tabs.paymentSettings", {}, "Pengaturan Pembayaran");
  const serverKeyLabel = translate("settings.payment.serverKey.label", {}, "Kunci Server Midtrans");
  const modeLabel = translate("settings.payment.mode.label", {}, "Mode Pembayaran Midtrans");
  const serverKeyDraftValue = serverKeyDraft.value.trim();

  return (
    <>
      {contextHolder}
      <section role="region" aria-label={paymentPanelLabel}>
        <Card>
          <Space direction="vertical" size={token.marginMD} style={{ width: "100%" }}>
            <Typography.Text type="secondary">
              {translate(
                "settings.payment.description",
                {},
                "Kelola kunci server dan mode pembayaran Midtrans untuk proses checkout."
              )}
            </Typography.Text>
            {summaryQuery.isError ? (
              <Alert
                type="error"
                showIcon
                message={translate("settings.payment.summary.error", {}, "Pengaturan pembayaran tidak dapat dimuat.")}
              />
            ) : null}
            {summaryQuery.isLoading ? (
              <Typography.Text>{translate("settings.payment.summary.loading", {}, "Memuat pengaturan pembayaran...")}</Typography.Text>
            ) : null}
            {serverKeyRow ? (
              <OperationalConfigRow
                row={withPaymentDisplay(
                  serverKeyRow,
                  serverKeyLabel,
                  translate("settings.payment.serverKey.description", {}, "Ganti kunci server Midtrans tanpa menampilkan nilai yang sedang aktif.")
                )}
              >
                <SecretReplacementInput
                  label={serverKeyLabel}
                  draft={serverKeyDraft}
                  onChange={setServerKeyDraft}
                  onSave={saveServerKey}
                  saving={rotateServerKeyMutation.isPending}
                  saveDisabled={!serverKeyDraftValue}
                  placeholder={translate("settings.payment.serverKey.placeholder", {}, "Kosongkan untuk memakai kunci saat ini")}
                  saveLabel={translate("buttons.save", {}, "Simpan")}
                />
              </OperationalConfigRow>
            ) : null}
            {modeRow ? (
              <OperationalConfigRow
                row={withPaymentDisplay(
                  modeRow,
                  modeLabel,
                  translate("settings.payment.mode.description", {}, "Gunakan Sandbox untuk uji coba. Gunakan Produksi untuk transaksi pelanggan.")
                )}
              >
                <Space direction="vertical" style={{ width: "100%" }}>
                  <Switch
                    aria-label={modeLabel}
                    checked={modeDraft}
                    checkedChildren={translate("settings.payment.mode.production", {}, "Produksi")}
                    unCheckedChildren={translate("settings.payment.mode.sandbox", {}, "Sandbox")}
                    onChange={setModeDraft}
                  />
                  <Button
                    loading={updateModeMutation.isPending}
                    disabled={!modeHasChanged || updateModeMutation.isPending}
                    onClick={saveMode}
                  >
                    {translate("buttons.save", {}, "Simpan")}
                  </Button>
                </Space>
              </OperationalConfigRow>
            ) : null}
          </Space>
        </Card>
      </section>
    </>
  );
};
