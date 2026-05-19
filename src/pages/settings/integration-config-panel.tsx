import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "@refinedev/core";
import { Alert, Button, Card, Col, Form, Input, Modal, Row, Space, Tag, Typography, message, theme } from "antd";
import { useEffect, useMemo, useState } from "react";
import {
  integrationConfigClient,
  type IntegrationConfigAuditRow,
  type IntegrationConfigSummaryRow,
  type IntegrationConfigValueKind,
  type RuntimeConfigKey,
} from "./integration-config-client";

const SECRET_KEYS: RuntimeConfigKey[] = ["midtrans.server_key", "biteship.api_key", "push.expo_access_token"];

const SECTION_KEYS: Record<string, RuntimeConfigKey[]> = {
  midtrans: ["midtrans.server_key", "midtrans.is_production"],
  biteship: [
    "biteship.api_key",
    "biteship.origin_postal_code",
    "biteship.origin_area_id",
    "biteship.origin_latitude",
    "biteship.origin_longitude",
    "biteship.enabled_couriers",
  ],
  shopShipper: ["shop.shipper_name", "shop.shipper_phone", "shop.shipper_email", "shop.address", "shop.organization"],
  push: ["push.expo_access_token"],
  cors: ["cors.allowed_origins"],
};

interface EditableConfigState {
  value: string;
  reason: string;
}

interface RotateFormState {
  secret: string;
  confirmation: string;
  reason: string;
}

interface RotateValidationState {
  secret?: string;
  confirmation?: string;
  reason?: string;
}

interface RotateModalState {
  key: RuntimeConfigKey;
  displayName: string;
}

const emptyRotateForm: RotateFormState = { secret: "", confirmation: "", reason: "" };

function isSecretKey(key: RuntimeConfigKey): boolean {
  return SECRET_KEYS.includes(key);
}

function stringifyValue(value: unknown, kind: IntegrationConfigValueKind): string {
  if (value === null || value === undefined) return "";
  if (kind === "string_array" && Array.isArray(value)) return value.join(", ");
  if (kind === "json" || typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function parseValue(value: string, kind: IntegrationConfigValueKind): unknown {
  const trimmed = value.trim();
  if (kind === "boolean") return trimmed === "true";
  if (kind === "number") return Number(trimmed);
  if (kind === "string_array") return trimmed ? trimmed.split(",").map((item) => item.trim()).filter(Boolean) : [];
  if (kind === "json") return trimmed ? JSON.parse(trimmed) : null;
  return value;
}

function getRowDisplayName(row: IntegrationConfigSummaryRow): string {
  return row.display_name?.trim() || row.key_name;
}

function getSafeDisplayValue(row: IntegrationConfigSummaryRow): string {
  if (row.is_secret) return row.masked_value?.trim() || "••••••";
  const renderedValue = stringifyValue(row.non_secret_value, row.value_kind).trim();
  return renderedValue || "-";
}

function formatDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString("id-ID") : "-";
}

function getStatusColor(status: string | null | undefined): string {
  if (status === "active") return "success";
  if (status === "grace") return "warning";
  if (status === "disabled" || status === "retired" || status === "superseded") return "default";
  return "processing";
}

function buildEditableState(rows: IntegrationConfigSummaryRow[]): Record<RuntimeConfigKey, EditableConfigState> {
  return rows.reduce<Record<RuntimeConfigKey, EditableConfigState>>((acc, row) => {
    if (!row.is_secret) {
      acc[row.key_name] = {
        value: stringifyValue(row.non_secret_value, row.value_kind),
        reason: "",
      };
    }
    return acc;
  }, {} as Record<RuntimeConfigKey, EditableConfigState>);
}

export const IntegrationConfigPanel: React.FC = () => {
  const { translate } = useTranslation();
  const { token } = theme.useToken();
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const [editableValues, setEditableValues] = useState<Record<RuntimeConfigKey, EditableConfigState>>({} as Record<RuntimeConfigKey, EditableConfigState>);
  const [rotateModal, setRotateModal] = useState<RotateModalState | null>(null);
  const [rotateForm, setRotateForm] = useState<RotateFormState>(emptyRotateForm);
  const [rotateErrors, setRotateErrors] = useState<RotateValidationState>({});

  const confirmationPhrase = translate("settings.integration.rotate.confirmPhrase", {}, "ROTATE");

  const summaryQuery = useQuery({
    queryKey: ["integration-config", "summary"],
    queryFn: () => integrationConfigClient.summary(),
  });

  const auditQuery = useQuery({
    queryKey: ["integration-config", "audit"],
    queryFn: () => integrationConfigClient.audit(undefined, 50),
  });

  const summaryRows = summaryQuery.data ?? [];

  useEffect(() => {
    if (summaryRows.length > 0) {
      setEditableValues((current) => ({ ...buildEditableState(summaryRows), ...current }));
    }
  }, [summaryRows]);

  const refreshGatewayData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["integration-config", "summary"] }),
      queryClient.invalidateQueries({ queryKey: ["integration-config", "audit"] }),
    ]);
  };

  const rotateMutation = useMutation({
    mutationFn: ({ key, secret, reason }: { key: RuntimeConfigKey; secret: string; reason: string }) =>
      integrationConfigClient.rotateSecret(key, secret, reason),
    onSuccess: async () => {
      messageApi.success(translate("settings.integration.rotate.success", {}, "Secret rotated safely."));
      setRotateModal(null);
      setRotateForm(emptyRotateForm);
      setRotateErrors({});
      await refreshGatewayData();
    },
    onError: () => {
      messageApi.error(translate("settings.integration.rotate.error", {}, "Secret rotation failed."));
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ key, value, reason }: { key: RuntimeConfigKey; value: unknown; reason: string }) =>
      integrationConfigClient.updateValue(key, value, reason),
    onSuccess: async () => {
      messageApi.success(translate("settings.integration.update.success", {}, "Configuration updated."));
      await refreshGatewayData();
    },
    onError: () => {
      messageApi.error(translate("settings.integration.update.error", {}, "Configuration update failed."));
    },
  });

  const rowsByKey = useMemo(
    () => new Map(summaryRows.map((row) => [row.key_name, row])),
    [summaryRows],
  );

  const lastRuntimeReadByKey = useMemo(() => {
    const runtimeReadRows = (auditQuery.data ?? []).filter((row) => row.action === "runtime_read");

    return runtimeReadRows.reduce<Map<string, IntegrationConfigAuditRow>>((latestByKey, row) => {
      const current = latestByKey.get(row.key_name);
      if (!current || new Date(row.created_at).getTime() > new Date(current.created_at).getTime()) {
        latestByKey.set(row.key_name, row);
      }

      return latestByKey;
    }, new Map());
  }, [auditQuery.data]);

  const updateEditableValue = (key: RuntimeConfigKey, patch: Partial<EditableConfigState>) => {
    setEditableValues((current) => ({
      ...current,
      [key]: { value: current[key]?.value ?? "", reason: current[key]?.reason ?? "", ...patch },
    }));
  };

  const openRotateModal = (row: IntegrationConfigSummaryRow) => {
    setRotateModal({ key: row.key_name, displayName: getRowDisplayName(row) });
    setRotateForm(emptyRotateForm);
    setRotateErrors({});
  };

  const validateRotateForm = (): RotateValidationState => {
    return {
      secret: rotateForm.secret.trim()
        ? undefined
        : translate("settings.integration.validation.secretRequired", {}, "Enter the new secret."),
      confirmation: rotateForm.confirmation.trim() === confirmationPhrase
        ? undefined
        : translate("settings.integration.validation.confirmationRequired", { phrase: confirmationPhrase }, `Type ${confirmationPhrase} to confirm.`),
      reason: rotateForm.reason.trim()
        ? undefined
        : translate("settings.integration.validation.reasonRequired", {}, "Enter a reason."),
    };
  };

  const submitRotate = () => {
    if (!rotateModal) return;
    const validation = validateRotateForm();
    setRotateErrors(validation);
    if (validation.secret || validation.confirmation || validation.reason) return;

    rotateMutation.mutate({
      key: rotateModal.key,
      secret: rotateForm.secret,
      reason: rotateForm.reason.trim(),
    });
  };

  const submitUpdate = (row: IntegrationConfigSummaryRow) => {
    const draft = editableValues[row.key_name];
    const reason = draft?.reason.trim() ?? "";
    if (!reason) {
      messageApi.error(translate("settings.integration.validation.reasonRequired", {}, "Enter a reason."));
      return;
    }

    try {
      updateMutation.mutate({ key: row.key_name, value: parseValue(draft?.value ?? "", row.value_kind), reason });
    } catch {
      messageApi.error(translate("settings.integration.validation.jsonInvalid", {}, "Enter valid JSON."));
    }
  };

  const renderSummaryRow = (row: IntegrationConfigSummaryRow) => {
    const currentEditableValue = editableValues[row.key_name] ?? { value: stringifyValue(row.non_secret_value, row.value_kind), reason: "" };
    const rowDescription = row.description?.trim();
    const isSecret = isSecretKey(row.key_name) || row.is_secret;
    const lastRuntimeRead = lastRuntimeReadByKey.get(row.key_name);

    return (
      <Card key={row.key_name} size="small" style={{ marginBottom: token.marginSM }}>
        <Row gutter={[token.marginMD, token.marginSM]} align="middle">
          <Col xs={24} md={8}>
            <Space direction="vertical" size={token.marginXXS}>
              <Typography.Text strong>{getRowDisplayName(row)}</Typography.Text>
              <Typography.Text type="secondary">{row.key_name}</Typography.Text>
              {rowDescription ? <Typography.Text type="secondary">{rowDescription}</Typography.Text> : null}
            </Space>
          </Col>
          <Col xs={24} md={6}>
            <Space direction="vertical" size={token.marginXXS}>
              <Typography.Text type="secondary">{translate("settings.integration.fields.safeValue", {}, "Safe value")}</Typography.Text>
              <Typography.Text code>{getSafeDisplayValue(row)}</Typography.Text>
            </Space>
          </Col>
          <Col xs={24} md={5}>
            <Space direction="vertical" size={token.marginXXS}>
              <Space wrap>
                <Tag color={getStatusColor(row.status)}>{row.status || translate("settings.integration.status.unknown", {}, "Unknown")}</Tag>
                {row.version_number ? <Tag>v{row.version_number}</Tag> : null}
                {row.is_runtime_required ? <Tag color="warning">{translate("settings.integration.status.runtimeRequired", {}, "Runtime required")}</Tag> : null}
              </Space>
              <Typography.Text type="secondary">{formatDate(row.updated_at)}</Typography.Text>
              {row.updated_by ? <Typography.Text type="secondary">{row.updated_by}</Typography.Text> : null}
              <Typography.Text type="secondary">{translate("settings.integration.fields.lastRuntimeRead", {}, "Last runtime read")}: {formatDate(lastRuntimeRead?.created_at)}</Typography.Text>
              {lastRuntimeRead?.request_id ? <Typography.Text type="secondary">{lastRuntimeRead.request_id}</Typography.Text> : null}
            </Space>
          </Col>
          <Col xs={24} md={5}>
            {isSecret ? (
              <Button onClick={() => openRotateModal(row)}>{translate("settings.integration.rotate.action", {}, "Rotate secret")}</Button>
            ) : (
              <Space direction="vertical" style={{ width: "100%" }}>
                <Input.TextArea
                  aria-label={translate("settings.integration.update.valueLabel", { key: row.key_name }, `New value for ${row.key_name}`)}
                  rows={row.value_kind === "json" ? 3 : 1}
                  value={currentEditableValue.value}
                  onChange={(event) => updateEditableValue(row.key_name, { value: event.target.value })}
                />
                <Input
                  aria-label={translate("settings.integration.update.reasonLabel", { key: row.key_name }, `Reason for ${row.key_name}`)}
                  value={currentEditableValue.reason}
                  onChange={(event) => updateEditableValue(row.key_name, { reason: event.target.value })}
                  placeholder={translate("settings.integration.update.reasonPlaceholder", {}, "Reason for this change")}
                />
                <Button loading={updateMutation.isPending} onClick={() => submitUpdate(row)}>
                  {translate("settings.integration.update.action", {}, "Save value")}
                </Button>
              </Space>
            )}
          </Col>
        </Row>
      </Card>
    );
  };

  const renderSection = (sectionKey: keyof typeof SECTION_KEYS) => {
    const rows = SECTION_KEYS[sectionKey].map((key) => rowsByKey.get(key)).filter((row): row is IntegrationConfigSummaryRow => Boolean(row));

    return (
      <Card title={translate(`settings.integration.sections.${sectionKey}`, {}, sectionKey)}>
        {summaryQuery.isError ? (
          <Alert type="error" showIcon message={translate("settings.integration.summary.error", {}, "Integration configuration could not be loaded.")} />
        ) : null}
        {summaryQuery.isLoading ? <Typography.Text>{translate("settings.integration.summary.loading", {}, "Loading integration configuration...")}</Typography.Text> : null}
        {!summaryQuery.isLoading && rows.length === 0 ? (
          <Typography.Text type="secondary">{translate("settings.integration.summary.empty", {}, "No configuration found for this section.")}</Typography.Text>
        ) : rows.map(renderSummaryRow)}
      </Card>
    );
  };

  const renderAuditRow = (row: IntegrationConfigAuditRow) => (
    <Card key={row.id} size="small" style={{ marginBottom: token.marginSM }}>
      <Row gutter={[token.marginMD, token.marginSM]}>
        <Col xs={24} md={6}>
          <Space direction="vertical" size={token.marginXXS}>
            <Typography.Text strong>{row.action}</Typography.Text>
            <Typography.Text type="secondary">{row.key_name}</Typography.Text>
          </Space>
        </Col>
        <Col xs={24} md={7}>
          <Space direction="vertical" size={token.marginXXS}>
            <Typography.Text>{translate("settings.integration.audit.oldValue", {}, "Old")}: {row.old_masked_value || "-"}</Typography.Text>
            <Typography.Text>{translate("settings.integration.audit.newValue", {}, "New")}: {row.new_masked_value || "-"}</Typography.Text>
            <Typography.Text type="secondary">{row.old_version_number ?? "-"} → {row.new_version_number ?? "-"}</Typography.Text>
          </Space>
        </Col>
        <Col xs={24} md={6}>
          <Space direction="vertical" size={token.marginXXS}>
            <Typography.Text>{row.actor_role || "-"}</Typography.Text>
            <Typography.Text type="secondary">{row.actor_id || "-"}</Typography.Text>
            <Typography.Text type="secondary">{row.source || "-"}</Typography.Text>
            <Typography.Text type="secondary">{row.reason || "-"}</Typography.Text>
          </Space>
        </Col>
        <Col xs={24} md={5}>
          <Space direction="vertical" size={token.marginXXS}>
            <Typography.Text>{formatDate(row.created_at)}</Typography.Text>
            <Typography.Text type="secondary">{row.request_id || "-"}</Typography.Text>
          </Space>
        </Col>
      </Row>
    </Card>
  );

  return (
    <>
      {contextHolder}
      <Space direction="vertical" size={token.marginMD} style={{ width: "100%" }}>
        <Alert
          type="info"
          showIcon
          message={translate("settings.integration.safeNotice.title", {}, "Secrets stay masked")}
          description={translate("settings.integration.safeNotice.description", {}, "This page only shows masked secret metadata and non-secret runtime values through the integration gateway.")}
        />
        {renderSection("midtrans")}
        {renderSection("biteship")}
        {renderSection("shopShipper")}
        {renderSection("push")}
        {renderSection("cors")}
        <Card title={translate("settings.integration.sections.auditTrail", {}, "Audit Trail")}>
          {auditQuery.isLoading ? <Typography.Text>{translate("settings.integration.audit.loading", {}, "Loading audit trail...")}</Typography.Text> : null}
          {auditQuery.isError ? <Alert type="error" showIcon message={translate("settings.integration.audit.error", {}, "Audit trail could not be loaded.")} /> : null}
          {!auditQuery.isLoading && (auditQuery.data?.length ?? 0) === 0 ? (
            <Typography.Text type="secondary">{translate("settings.integration.audit.empty", {}, "No audit events yet.")}</Typography.Text>
          ) : (auditQuery.data ?? []).map(renderAuditRow)}
        </Card>
      </Space>
      <Modal
        open={Boolean(rotateModal)}
        title={translate("settings.integration.rotate.title", { name: rotateModal?.displayName ?? "" }, `Rotate ${rotateModal?.displayName ?? "secret"}`)}
        onCancel={() => {
          setRotateModal(null);
          setRotateForm(emptyRotateForm);
          setRotateErrors({});
        }}
        onOk={submitRotate}
        okText={translate("settings.integration.rotate.submit", {}, "Rotate secret")}
        cancelText={translate("buttons.cancel", {}, "Cancel")}
        confirmLoading={rotateMutation.isPending}
        destroyOnHidden
      >
        <div>
          <Alert
            type="warning"
            showIcon
            message={translate("settings.integration.rotate.warningTitle", {}, "Plaintext is never shown")}
            description={translate("settings.integration.rotate.warningDescription", {}, "Paste the new secret, type the confirmation phrase, and record why this rotation is needed.")}
            style={{ marginBottom: token.marginMD }}
          />
          <Form.Item
            label={translate("settings.integration.rotate.secretLabel", {}, "New secret")}
            validateStatus={rotateErrors.secret ? "error" : undefined}
            help={rotateErrors.secret}
          >
            <Input.Password
              aria-label={translate("settings.integration.rotate.secretLabel", {}, "New secret")}
              value={rotateForm.secret}
              onChange={(event) => setRotateForm((current) => ({ ...current, secret: event.target.value }))}
              autoComplete="new-password"
            />
          </Form.Item>
          <Form.Item
            label={translate("settings.integration.rotate.confirmationLabel", { phrase: confirmationPhrase }, `Type ${confirmationPhrase}`)}
            validateStatus={rotateErrors.confirmation ? "error" : undefined}
            help={rotateErrors.confirmation}
          >
            <Input
              aria-label={translate("settings.integration.rotate.confirmationLabel", { phrase: confirmationPhrase }, `Type ${confirmationPhrase}`)}
              value={rotateForm.confirmation}
              onChange={(event) => setRotateForm((current) => ({ ...current, confirmation: event.target.value }))}
            />
          </Form.Item>
          <Form.Item
            label={translate("settings.integration.rotate.reasonLabel", {}, "Rotation reason")}
            validateStatus={rotateErrors.reason ? "error" : undefined}
            help={rotateErrors.reason}
          >
            <Input.TextArea
              aria-label={translate("settings.integration.rotate.reasonLabel", {}, "Rotation reason")}
              rows={3}
              value={rotateForm.reason}
              onChange={(event) => setRotateForm((current) => ({ ...current, reason: event.target.value }))}
              placeholder={translate("settings.integration.rotate.reasonPlaceholder", {}, "Example: scheduled key rotation")}
            />
          </Form.Item>
        </div>
      </Modal>
    </>
  );
};
