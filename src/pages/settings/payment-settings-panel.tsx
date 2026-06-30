import { useTranslation } from "@refinedev/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Card, Modal, Space, Switch, Typography, message, theme } from "antd";
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
  displayName: string
): IntegrationConfigSummaryRow {
  return { ...row, display_name: displayName, description: null };
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

  const handleModeChange = (checked: boolean) => {
    setModeDraft(checked);

    if (!persistedMode && checked) {
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
        onCancel: () => setModeDraft(false),
      });
      return;
    }

    updateModeMutation.mutate(checked);
  };

  const paymentPanelLabel = translate("settings.tabs.paymentSettings", {}, "Pengaturan Pembayaran");
  const serverKeyLabel = translate("settings.payment.serverKey.label", {}, "Kunci Server Midtrans");
  const modeLabel = translate("settings.payment.mode.label", {}, "Mode Pembayaran Midtrans");
  const serverKeyDraftValue = serverKeyDraft.value.trim();
  const paymentRowsEmpty = !summaryQuery.isLoading && !summaryQuery.isError && !serverKeyRow && !modeRow;

  return (
    <>
      {contextHolder}
      <section role="region" aria-label={paymentPanelLabel}>
        <Card>
          <Space direction="vertical" size={token.marginMD} style={{ width: "100%" }}>

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
            {paymentRowsEmpty ? (
              <Typography.Text type="secondary">{translate("settings.payment.summary.empty", {}, "Pengaturan pembayaran belum tersedia.")}</Typography.Text>
            ) : null}
            {serverKeyRow ? (
              <OperationalConfigRow
                row={withPaymentDisplay(
                  serverKeyRow,
                  serverKeyLabel
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
                  modeLabel
                )}
              >
                  <Switch
                    aria-label={modeLabel}
                    checked={modeDraft}
                    loading={updateModeMutation.isPending}
                    checkedChildren={translate("settings.payment.mode.production", {}, "Produksi")}
                    unCheckedChildren={translate("settings.payment.mode.sandbox", {}, "Sandbox")}
                    onChange={handleModeChange}
                  />
              </OperationalConfigRow>
            ) : null}
          </Space>
        </Card>
      </section>
    </>
  );
};
