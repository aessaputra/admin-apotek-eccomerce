import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "@refinedev/core";
import { Alert, Button, Card, Descriptions, Input, Modal, Space, Typography, message, theme } from "antd";
import { useEffect, useMemo, useState } from "react";
import {
  integrationConfigClient,
  type IntegrationConfigAuditRow,
  type IntegrationConfigSummaryRow,
  type IntegrationConfigValueKind,
  type RuntimeConfigKey,
} from "./integration-config-client";
import { INTEGRATION_CONFIG_OWNERSHIP } from "./integration-config-ownership";
import {
  ConfigDetailsDisclosure,
  OperationalConfigRow,
  SecretReplacementInput,
  createBlankSecretReplacementDraft,
  type SecretReplacementDraft,
} from "./integration-config-primitives";

const TECHNICAL_CONFIG_KEYS: readonly RuntimeConfigKey[] = INTEGRATION_CONFIG_OWNERSHIP.technical;
const TECHNICAL_CONFIG_KEY_SET: ReadonlySet<RuntimeConfigKey> = new Set(TECHNICAL_CONFIG_KEYS);
const TECHNICAL_SAVE_REASON = "settings_technical_save";
const TECHNICAL_SUMMARY_QUERY_KEY = ["integration-config", "summary", "technical"] as const;
const TECHNICAL_AUDIT_QUERY_KEY = ["integration-config", "audit", "technical"] as const;

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
  displayName: string,
  description: string
): IntegrationConfigSummaryRow {
  return { ...row, display_name: displayName, description };
}

function formatDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString("id-ID") : "-";
}

function getAuditDisplayName(
  row: IntegrationConfigAuditRow,
  rowsByKey: Map<RuntimeConfigKey, IntegrationConfigSummaryRow>,
  translate: ReturnType<typeof useTranslation>["translate"]
): string {
  const knownRow = rowsByKey.get(row.key_name as RuntimeConfigKey);
  if (knownRow?.display_name?.trim()) return knownRow.display_name.trim();
  return translate("settings.integration.audit.fallback.technical", {}, "Technical configuration");
}

function formatActionLabel(action: string, translate: ReturnType<typeof useTranslation>["translate"]): string {
  if (action === "runtime_read") {
    return translate("settings.integration.audit.actions.runtimeRead", {}, "Runtime read");
  }

  if (action === "secret_rotated") {
    return translate("settings.integration.audit.actions.secretRotated", {}, "Secret rotated");
  }

  if (action === "value_updated") {
    return translate("settings.integration.audit.actions.valueUpdated", {}, "Value updated");
  }

  return action;
}

async function loadTechnicalAuditRows(): Promise<IntegrationConfigAuditRow[]> {
  const auditRowsByKey = await Promise.all(
    TECHNICAL_CONFIG_KEYS.map((key) => integrationConfigClient.audit(key, 50))
  );

  return auditRowsByKey
    .flat()
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))
    .slice(0, 50);
}

const wrapValueStyle: React.CSSProperties = {
  overflowWrap: "anywhere",
  wordBreak: "break-word",
};

const AuditValue: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Typography.Text style={wrapValueStyle}>{children}</Typography.Text>
);

const TechnicalAuditRow: React.FC<{
  row: IntegrationConfigAuditRow;
  rowsByKey: Map<RuntimeConfigKey, IntegrationConfigSummaryRow>;
}> = ({ row, rowsByKey }) => {
  const { translate } = useTranslation();

  return (
    <Card size="small">
      <Space direction="vertical" size="small" style={{ width: "100%" }}>
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{getAuditDisplayName(row, rowsByKey, translate)}</Typography.Text>
          <Typography.Text type="secondary">{formatActionLabel(row.action, translate)}</Typography.Text>
        </Space>
        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label={translate("settings.integration.audit.fields.key", {}, "Key")}>
            <AuditValue>{row.key_name}</AuditValue>
          </Descriptions.Item>
          {row.version_id ? (
            <Descriptions.Item label={translate("settings.integration.audit.fields.versionId", {}, "Version ID")}>
              <AuditValue>{row.version_id}</AuditValue>
            </Descriptions.Item>
          ) : null}
          {row.new_version_number ? (
            <Descriptions.Item label={translate("settings.integration.audit.fields.version", {}, "Version")}>
              <AuditValue>{row.new_version_number}</AuditValue>
            </Descriptions.Item>
          ) : null}
          <Descriptions.Item label={translate("settings.integration.audit.fields.request", {}, "Request")}>
            <AuditValue>{row.request_id || "-"}</AuditValue>
          </Descriptions.Item>
          <Descriptions.Item label={translate("settings.integration.audit.fields.actorRole", {}, "Actor role")}>
            <AuditValue>{row.actor_role || "-"}</AuditValue>
          </Descriptions.Item>
          <Descriptions.Item label={translate("settings.integration.audit.fields.actorId", {}, "Actor ID")}>
            <AuditValue>{row.actor_id || "-"}</AuditValue>
          </Descriptions.Item>
          <Descriptions.Item label={translate("settings.integration.audit.fields.source", {}, "Source")}>
            <AuditValue>{row.source || "-"}</AuditValue>
          </Descriptions.Item>
          <Descriptions.Item label={translate("settings.integration.audit.fields.reason", {}, "Reason")}>
            <AuditValue>{row.reason || "-"}</AuditValue>
          </Descriptions.Item>
          <Descriptions.Item label={translate("settings.integration.audit.fields.timestamp", {}, "Timestamp")}>
            <AuditValue>{formatDate(row.created_at)}</AuditValue>
          </Descriptions.Item>
          <Descriptions.Item label={translate("settings.integration.audit.fields.oldValue", {}, "Old")}>
            <AuditValue>{row.old_masked_value || "-"}</AuditValue>
          </Descriptions.Item>
          <Descriptions.Item label={translate("settings.integration.audit.fields.newValue", {}, "New")}>
            <AuditValue>{row.new_masked_value || "-"}</AuditValue>
          </Descriptions.Item>
        </Descriptions>
      </Space>
    </Card>
  );
};

export const IntegrationConfigPanel: React.FC = () => {
  const { translate } = useTranslation();
  const { token } = theme.useToken();
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const [pushTokenDraft, setPushTokenDraft] = useState<SecretReplacementDraft>(() => createBlankSecretReplacementDraft());
  const [allowedOriginsDraft, setAllowedOriginsDraft] = useState("");
  const [auditOpen, setAuditOpen] = useState(false);

  const summaryQuery = useQuery({
    queryKey: TECHNICAL_SUMMARY_QUERY_KEY,
    queryFn: () => integrationConfigClient.summary([...TECHNICAL_CONFIG_KEYS]),
  });

  const auditQuery = useQuery({
    queryKey: TECHNICAL_AUDIT_QUERY_KEY,
    queryFn: loadTechnicalAuditRows,
    enabled: auditOpen,
  });

  const rowsByKey = useMemo(
    () => new Map((summaryQuery.data?.rows ?? []).map((row) => [row.key_name, row])),
    [summaryQuery.data]
  );

  const pushTokenRow = rowsByKey.get("push.expo_access_token");
  const allowedOriginsRow = rowsByKey.get("cors.allowed_origins");

  const technicalAuditRows = useMemo(
    () => (auditQuery.data ?? []).filter((row) => TECHNICAL_CONFIG_KEY_SET.has(row.key_name as RuntimeConfigKey)),
    [auditQuery.data]
  );
  const isAuditLoading = auditQuery.isPending || auditQuery.isFetching;

  useEffect(() => {
    if (allowedOriginsRow) {
      setAllowedOriginsDraft(stringifyValue(allowedOriginsRow.non_secret_value, allowedOriginsRow.value_kind));
    }
  }, [allowedOriginsRow]);

  const refreshTechnicalData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: TECHNICAL_SUMMARY_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: TECHNICAL_AUDIT_QUERY_KEY }),
    ]);
  };

  const rotatePushTokenMutation = useMutation({
    mutationFn: (secret: string) =>
      integrationConfigClient.rotateSecret("push.expo_access_token", secret, TECHNICAL_SAVE_REASON),
    onSuccess: async () => {
      setPushTokenDraft(createBlankSecretReplacementDraft());
      messageApi.success(translate("settings.integration.technical.saveSuccess", {}, "Technical settings saved."));
      await refreshTechnicalData();
    },
    onError: () => {
      messageApi.error(translate("settings.integration.technical.saveError", {}, "Technical settings could not be saved."));
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
      messageApi.success(translate("settings.integration.technical.saveSuccess", {}, "Technical settings saved."));
      await refreshTechnicalData();
    },
    onError: () => {
      messageApi.error(translate("settings.integration.technical.saveError", {}, "Technical settings could not be saved."));
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

  const panelLabel = translate("settings.tabs.integrationConfig", {}, "Teknis");
  const pushTokenLabel = translate("settings.integration.technical.pushToken.label", {}, "Expo Push Token");
  const allowedOriginsLabel = translate("settings.integration.technical.allowedOrigins.label", {}, "Allowed Origins");

  return (
    <>
      {contextHolder}
      <section role="region" aria-label={panelLabel}>
        <Card>
          <Space direction="vertical" size={token.marginMD} style={{ width: "100%" }}>
            <Typography.Text type="secondary">
              {translate(
                "settings.integration.technical.description",
                {},
                "Kelola token push, CORS, dan audit teknis. Pembayaran dan pengiriman ada di tab masing-masing."
              )}
            </Typography.Text>
            {summaryQuery.isError ? (
              <Alert type="error" showIcon message={translate("settings.integration.summary.error", {}, "Technical settings could not be loaded.")} />
            ) : null}
            {summaryQuery.isLoading ? (
              <Typography.Text>{translate("settings.integration.summary.loading", {}, "Loading technical settings...")}</Typography.Text>
            ) : null}
            {!summaryQuery.isLoading && !pushTokenRow && !allowedOriginsRow ? (
              <Typography.Text type="secondary">{translate("settings.integration.summary.empty", {}, "No technical settings found.")}</Typography.Text>
            ) : null}
            {pushTokenRow ? (
              <OperationalConfigRow
                row={withTechnicalDisplay(
                  pushTokenRow,
                  pushTokenLabel,
                  translate("settings.integration.technical.pushToken.description", {}, "Ganti token Expo tanpa menampilkan nilai saat ini.")
                )}
                actions={(
                  <ConfigDetailsDisclosure
                    row={pushTokenRow}
                    auditRows={technicalAuditRows.filter((row) => row.key_name === "push.expo_access_token")}
                    buttonLabel={translate("settings.integration.details.action", {}, "Detail")}
                  />
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
                  allowedOriginsLabel,
                  translate("settings.integration.technical.allowedOrigins.description", {}, "Daftar origin admin yang diizinkan mengakses gateway.")
                )}
                actions={(
                  <ConfigDetailsDisclosure
                    row={allowedOriginsRow}
                    auditRows={technicalAuditRows.filter((row) => row.key_name === "cors.allowed_origins")}
                    buttonLabel={translate("settings.integration.details.action", {}, "Detail")}
                  />
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
            <Button onClick={() => setAuditOpen(true)}>
              {translate("settings.integration.audit.open", {}, "Lihat audit teknis")}
            </Button>
          </Space>
        </Card>
      </section>
      <Modal
        open={auditOpen}
        title={translate("settings.integration.sections.auditTrail", {}, "Audit Trail")}
        onCancel={() => setAuditOpen(false)}
        footer={null}
      >
        <Space direction="vertical" size={token.marginSM} style={{ width: "100%" }}>
          {isAuditLoading ? <Typography.Text>{translate("settings.integration.audit.loading", {}, "Loading audit trail...")}</Typography.Text> : null}
          {auditQuery.isError ? <Alert type="error" showIcon message={translate("settings.integration.audit.error", {}, "Audit trail could not be loaded.")} /> : null}
          {!isAuditLoading && auditQuery.isFetched && technicalAuditRows.length === 0 ? (
            <Typography.Text type="secondary">{translate("settings.integration.audit.empty", {}, "No audit events yet.")}</Typography.Text>
          ) : null}
          {technicalAuditRows.map((row) => (
            <TechnicalAuditRow key={row.id} row={row} rowsByKey={rowsByKey} />
          ))}
        </Space>
      </Modal>
    </>
  );
};
