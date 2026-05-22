import { useTranslation } from "@refinedev/core";
import { Button, Card, Input, Modal, Space, Tag, Typography, theme } from "antd";
import { useState } from "react";
import type { IntegrationConfigAuditRow, IntegrationConfigSummaryRow } from "./integration-config-client";

export interface SecretReplacementDraft {
  value: string;
}

export function createBlankSecretReplacementDraft(_source?: Partial<IntegrationConfigSummaryRow>): SecretReplacementDraft {
  return { value: "" };
}

export interface SecretReplacementInputProps {
  label: string;
  draft: SecretReplacementDraft;
  onChange: (draft: SecretReplacementDraft) => void;
  onSave: () => void;
  saving?: boolean;
  placeholder?: string;
  saveLabel?: string;
}

export const SecretReplacementInput: React.FC<SecretReplacementInputProps> = ({
  label,
  draft,
  onChange,
  onSave,
  saving = false,
  placeholder = "Leave blank to keep current value",
  saveLabel = "Save",
}) => (
  <Space direction="vertical" style={{ width: "100%" }}>
    <Input.Password
      aria-label={label}
      value={draft.value}
      placeholder={placeholder}
      autoComplete="new-password"
      visibilityToggle={false}
      onChange={(event) => onChange({ value: event.target.value })}
    />
    <Button loading={saving} onClick={onSave}>
      {saveLabel}
    </Button>
  </Space>
);

export interface OperationalConfigRowProps {
  row: IntegrationConfigSummaryRow;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}

function formatStatusLabel(status: string): string {
  return status
    .replace(/[-_]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export const OperationalConfigRow: React.FC<OperationalConfigRowProps> = ({ row, actions, children }) => {
  const { token } = theme.useToken();
  const { translate } = useTranslation();
  const displayName = row.display_name?.trim() || "Configuration";
  const description = row.description?.trim();
  const status = row.status?.trim();
  const statusLabel = status === "active" ? translate("settings.integration.status.active", {}, "Active") : status ? formatStatusLabel(status) : null;

  return (
    <Card size="small" style={{ marginBottom: token.marginSM }}>
      <Space direction="vertical" size={token.marginXS} style={{ width: "100%" }}>
        <Space direction="vertical" size={token.marginXXS}>
          <Space size={token.marginXS} wrap>
            <Typography.Text strong>{displayName}</Typography.Text>
            {statusLabel ? <Tag>{statusLabel}</Tag> : null}
          </Space>
          {description ? <Typography.Text type="secondary">{description}</Typography.Text> : null}
        </Space>
        {children}
        {actions ? <Space wrap>{actions}</Space> : null}
      </Space>
    </Card>
  );
};

export interface ConfigDetailsDisclosureProps {
  row: IntegrationConfigSummaryRow;
  auditRows?: IntegrationConfigAuditRow[];
  lastRuntimeRead?: IntegrationConfigAuditRow;
  buttonLabel?: string;
}

function formatAuditDate(value: string): string {
  return new Date(value).toLocaleString("id-ID");
}

export const ConfigDetailsDisclosure: React.FC<ConfigDetailsDisclosureProps> = ({
  row,
  auditRows = [],
  lastRuntimeRead,
  buttonLabel = "Details",
}) => {
  const [open, setOpen] = useState(false);
  const displayName = row.display_name?.trim() || "Configuration";

  return (
    <>
      <Button onClick={() => setOpen(true)}>{buttonLabel}</Button>
      <Modal open={open} title={displayName} onCancel={() => setOpen(false)} footer={null}>
        <Space direction="vertical" style={{ width: "100%" }}>
          <Typography.Text>Key: {row.key_name}</Typography.Text>
          {row.version_id ? <Typography.Text>Version ID: {row.version_id}</Typography.Text> : null}
          {row.version_number ? <Typography.Text>Version: {row.version_number}</Typography.Text> : null}
          {row.updated_by ? <Typography.Text>Updated by: {row.updated_by}</Typography.Text> : null}
          {row.updated_at ? <Typography.Text>Updated at: {formatAuditDate(row.updated_at)}</Typography.Text> : null}
          {lastRuntimeRead ? (
            <Typography.Text>Last runtime read request: {lastRuntimeRead.request_id || "-"}</Typography.Text>
          ) : null}
          {auditRows.map((auditRow) => (
            <Card key={auditRow.id} size="small">
              <Space direction="vertical">
                <Typography.Text>{auditRow.action}</Typography.Text>
                <Typography.Text>Key: {auditRow.key_name}</Typography.Text>
                {auditRow.version_id ? <Typography.Text>Version ID: {auditRow.version_id}</Typography.Text> : null}
                {auditRow.new_version_number ? <Typography.Text>Version: {auditRow.new_version_number}</Typography.Text> : null}
                <Typography.Text>Request: {auditRow.request_id || "-"}</Typography.Text>
                <Typography.Text>Actor role: {auditRow.actor_role || "-"}</Typography.Text>
                <Typography.Text>Actor ID: {auditRow.actor_id || "-"}</Typography.Text>
                <Typography.Text>Source: {auditRow.source || "-"}</Typography.Text>
                <Typography.Text>Reason: {auditRow.reason || "-"}</Typography.Text>
                <Typography.Text>{formatAuditDate(auditRow.created_at)}</Typography.Text>
                <Typography.Text>Old: {auditRow.old_masked_value || "-"}</Typography.Text>
                <Typography.Text>New: {auditRow.new_masked_value || "-"}</Typography.Text>
              </Space>
            </Card>
          ))}
        </Space>
      </Modal>
    </>
  );
};
