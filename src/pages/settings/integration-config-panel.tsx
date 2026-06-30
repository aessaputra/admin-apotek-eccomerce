import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "@refinedev/core";
import { Alert, Button, Card, Input, Space, Typography, message, theme } from "antd";
import { useEffect, useMemo, useState } from "react";
import {
  integrationConfigClient,
  type IntegrationConfigSummaryRow,
  type IntegrationConfigValueKind,
  type RuntimeConfigKey,
} from "./integration-config-client";
import { INTEGRATION_CONFIG_OWNERSHIP } from "./integration-config-ownership";
import {
  OperationalConfigRow,
  SecretReplacementInput,
  createBlankSecretReplacementDraft,
  type SecretReplacementDraft,
} from "./integration-config-primitives";

const TECHNICAL_CONFIG_KEYS: readonly RuntimeConfigKey[] = INTEGRATION_CONFIG_OWNERSHIP.technical;
const TECHNICAL_SAVE_REASON = "settings_technical_save";
const TECHNICAL_SUMMARY_QUERY_KEY = ["integration-config", "summary", "technical"] as const;

function isArrayKind(kind: IntegrationConfigValueKind): boolean {
  return kind === "string_array" || kind === "text_array";
}

function stringifyValue(value: unknown, kind: IntegrationConfigValueKind): string {
  if (value === null || value === undefined) return "";
  if (isArrayKind(kind) && Array.isArray(value)) return value.join(", ");
  if (kind === "json" || typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function parseValue(value: string, kind: IntegrationConfigValueKind): unknown {
  const trimmed = value.trim();
  if (kind === "boolean") return trimmed === "true";
  if (kind === "number") return Number(trimmed);
  if (isArrayKind(kind)) return trimmed ? trimmed.split(",").map((item) => item.trim()).filter(Boolean) : [];
  if (kind === "json") return trimmed ? JSON.parse(trimmed) : null;
  return value;
}

function withTechnicalDisplay(
  row: IntegrationConfigSummaryRow,
  displayName: string
): IntegrationConfigSummaryRow {
  return { ...row, display_name: displayName, description: null };
}

export const IntegrationConfigPanel: React.FC = () => {
  const { translate } = useTranslation();
  const { token } = theme.useToken();
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const [pushTokenDraft, setPushTokenDraft] = useState<SecretReplacementDraft>(() => createBlankSecretReplacementDraft());
  const [allowedOriginsDraft, setAllowedOriginsDraft] = useState("");

  const summaryQuery = useQuery({
    queryKey: TECHNICAL_SUMMARY_QUERY_KEY,
    queryFn: () => integrationConfigClient.summary([...TECHNICAL_CONFIG_KEYS]),
  });

  const rowsByKey = useMemo(
    () => new Map((summaryQuery.data?.rows ?? []).map((row) => [row.key_name, row])),
    [summaryQuery.data]
  );

  const pushTokenRow = rowsByKey.get("push.expo_access_token");
  const allowedOriginsRow = rowsByKey.get("cors.allowed_origins");

  useEffect(() => {
    if (allowedOriginsRow) {
      setAllowedOriginsDraft(stringifyValue(allowedOriginsRow.non_secret_value, allowedOriginsRow.value_kind));
    }
  }, [allowedOriginsRow]);

  const refreshTechnicalData = async () => {
    await queryClient.invalidateQueries({ queryKey: TECHNICAL_SUMMARY_QUERY_KEY });
  };

  const rotatePushTokenMutation = useMutation({
    mutationFn: (secret: string) =>
      integrationConfigClient.rotateSecret("push.expo_access_token", secret, TECHNICAL_SAVE_REASON),
    onSuccess: async () => {
      setPushTokenDraft(createBlankSecretReplacementDraft());
      messageApi.success(translate("settings.integration.technical.saveSuccess", {}, "Advanced settings saved."));
      await refreshTechnicalData();
    },
    onError: () => {
      messageApi.error(translate("settings.integration.technical.saveError", {}, "Advanced settings could not be saved."));
    },
  });

  const updateAllowedOriginsMutation = useMutation({
    mutationFn: (row: IntegrationConfigSummaryRow) =>
      integrationConfigClient.updateValue(
        "cors.allowed_origins",
        parseValue(allowedOriginsDraft, row.value_kind),
        TECHNICAL_SAVE_REASON
      ),
    onSuccess: async () => {
      messageApi.success(translate("settings.integration.technical.saveSuccess", {}, "Advanced settings saved."));
      await refreshTechnicalData();
    },
    onError: () => {
      messageApi.error(translate("settings.integration.technical.saveError", {}, "Advanced settings could not be saved."));
    },
  });

  const savePushToken = () => {
    const secret = pushTokenDraft.value.trim();
    if (!secret) return;
    rotatePushTokenMutation.mutate(secret);
  };

  const saveAllowedOrigins = () => {
    if (!allowedOriginsRow) return;
    try {
      updateAllowedOriginsMutation.mutate(allowedOriginsRow);
    } catch {
      messageApi.error(translate("settings.integration.validation.jsonInvalid", {}, "Enter valid JSON."));
    }
  };

  const panelLabel = translate("settings.tabs.integrationConfig", {}, "Lanjutan");
  const pushTokenLabel = translate("settings.integration.technical.pushToken.label", {}, "Expo Push Token");
  const allowedOriginsLabel = translate("settings.integration.technical.allowedOrigins.label", {}, "Allowed Origins");

  return (
    <>
      {contextHolder}
      <section role="region" aria-label={panelLabel}>
        <Card>
          <Space direction="vertical" size={token.marginMD} style={{ width: "100%" }}>

            {summaryQuery.isError ? (
              <Alert type="error" showIcon message={translate("settings.integration.summary.error", {}, "Advanced settings could not be loaded.")} />
            ) : null}
            {summaryQuery.isLoading ? (
              <Typography.Text>{translate("settings.integration.summary.loading", {}, "Loading advanced settings...")}</Typography.Text>
            ) : null}
            {!summaryQuery.isLoading && !pushTokenRow && !allowedOriginsRow ? (
              <Typography.Text type="secondary">{translate("settings.integration.summary.empty", {}, "No advanced settings found.")}</Typography.Text>
            ) : null}
            {pushTokenRow ? (
              <OperationalConfigRow
                row={withTechnicalDisplay(
                  pushTokenRow,
                  pushTokenLabel
                )}
              >
                <SecretReplacementInput
                  label={pushTokenLabel}
                  draft={pushTokenDraft}
                  onChange={setPushTokenDraft}
                  onSave={savePushToken}
                  saving={rotatePushTokenMutation.isPending}
                  placeholder={translate("settings.integration.technical.pushToken.placeholder", {}, "Kosongkan jika tidak diganti")}
                  saveLabel={translate("buttons.save", {}, "Simpan")}
                />
              </OperationalConfigRow>
            ) : null}
            {allowedOriginsRow ? (
              <OperationalConfigRow
                row={withTechnicalDisplay(
                  allowedOriginsRow,
                  allowedOriginsLabel
                )}
              >
                <Space direction="vertical" style={{ width: "100%" }}>
                  <Input.TextArea
                    aria-label={allowedOriginsLabel}
                    rows={3}
                    value={allowedOriginsDraft}
                    onChange={(event) => setAllowedOriginsDraft(event.target.value)}
                  />
                  <Button loading={updateAllowedOriginsMutation.isPending} onClick={saveAllowedOrigins}>
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
