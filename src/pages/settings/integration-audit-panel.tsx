import { useTranslation } from "@refinedev/core";
import { Alert, Button, Card, Collapse, Descriptions, Empty, Modal, Select, Space, Spin, Tag, Typography, theme } from "antd";
import { useMemo, useState } from "react";
import {
  integrationConfigClient,
  type IntegrationConfigAuditRow,
  type RuntimeConfigKey,
} from "./integration-config-client";
import {
  INTEGRATION_CONFIG_OWNERSHIP,
  type IntegrationConfigOwner,
} from "./integration-config-ownership";

type AuditOwnerFilter = "all" | IntegrationConfigOwner;
type AuditActionFilter = "all" | "runtime_read" | "secret_rotated" | "value_updated";
type TranslateFunction = ReturnType<typeof useTranslation>["translate"];

const OWNER_FILTER_VALUES = ["all", "payment", "shipping", "technical"] as const satisfies readonly AuditOwnerFilter[];
const ACTION_FILTER_VALUES = ["all", "runtime_read", "secret_rotated", "value_updated"] as const satisfies readonly AuditActionFilter[];
const LIMIT_OPTIONS = [50, 100, 250, 500] as const;
const ALL_RUNTIME_CONFIG_KEYS = Object.values(INTEGRATION_CONFIG_OWNERSHIP).flat() as RuntimeConfigKey[];
const ALL_RUNTIME_CONFIG_KEY_SET: ReadonlySet<RuntimeConfigKey> = new Set(ALL_RUNTIME_CONFIG_KEYS);

function getOwnerKeys(owner: AuditOwnerFilter): readonly RuntimeConfigKey[] {
  return owner === "all" ? ALL_RUNTIME_CONFIG_KEYS : INTEGRATION_CONFIG_OWNERSHIP[owner];
}

function isRuntimeConfigKey(value: string): value is RuntimeConfigKey {
  return ALL_RUNTIME_CONFIG_KEY_SET.has(value as RuntimeConfigKey);
}

function getOwnerLabel(owner: AuditOwnerFilter, translate: TranslateFunction): string {
  if (owner === "all") return translate("settings.integration.auditPanel.owners.all", {}, "Semua");
  if (owner === "payment") return translate("settings.integration.auditPanel.owners.payment", {}, "Pembayaran");
  if (owner === "shipping") return translate("settings.integration.auditPanel.owners.shipping", {}, "Pengiriman");
  return translate("settings.integration.auditPanel.owners.technical", {}, "Lanjutan");
}

function getActionLabel(action: AuditActionFilter | string, translate: TranslateFunction): string {
  if (action === "all") return translate("settings.integration.auditPanel.actions.all", {}, "Semua");
  if (action === "runtime_read") return translate("settings.integration.audit.actions.runtimeRead", {}, "Runtime read");
  if (action === "secret_rotated") return translate("settings.integration.audit.actions.secretRotated", {}, "Secret rotated");
  if (action === "value_updated") return translate("settings.integration.audit.actions.valueUpdated", {}, "Value updated");
  return action;
}

function getRuntimeConfigAuditLabel(key: RuntimeConfigKey | string, translate: TranslateFunction): string {
  if (key === "midtrans.server_key") return translate("settings.payment.serverKey.label", {}, "Kunci Server Midtrans");
  if (key === "midtrans.is_production") return translate("settings.payment.mode.label", {}, "Mode Pembayaran Midtrans");
  if (key === "biteship.api_key") return translate("settings.shipping.apiKey.label", {}, "Biteship API Key");
  if (key === "biteship.enabled_couriers") return translate("settings.fields.couriers", {}, "Active Couriers");
  if (key === "biteship.origin_postal_code") return translate("settings.fields.originPostalCode", {}, "Postal Code");
  if (key === "biteship.origin_area_id") return translate("settings.fields.originAreaId", {}, "Origin Area");
  if (key === "biteship.origin_latitude") return translate("settings.fields.originLatitude", {}, "Latitude");
  if (key === "biteship.origin_longitude") return translate("settings.fields.originLongitude", {}, "Longitude");
  if (key === "shop.shipper_name") return translate("settings.shipping.shipperName.label", {}, "Shipper Name");
  if (key === "shop.shipper_phone") return translate("settings.shipping.shipperPhone.label", {}, "Shipper Phone");
  if (key === "shop.shipper_email") return translate("settings.shipping.shipperEmail.label", {}, "Shipper Email");
  if (key === "shop.address") return translate("settings.fields.storeAddress", {}, "Store Address");
  if (key === "shop.organization") return translate("settings.fields.organization", {}, "Organization");
  if (key === "push.expo_access_token") return translate("settings.integration.technical.pushToken.label", {}, "Expo Push Token");
  if (key === "cors.allowed_origins") return translate("settings.integration.technical.allowedOrigins.label", {}, "Allowed Origins");
  return key;
}

function formatAuditDate(value: string): string {
  return new Date(value).toLocaleString("id-ID");
}

function formatAuditValue(masked: string | null, metadataValue: unknown): string {
  if (masked) return masked;
  if (metadataValue === null || metadataValue === undefined || metadataValue === "") return "-";
  if (typeof metadataValue === "string") return metadataValue;
  if (Array.isArray(metadataValue)) return metadataValue.join(", ");
  return JSON.stringify(metadataValue);
}

function sortNewestFirst(left: IntegrationConfigAuditRow, right: IntegrationConfigAuditRow): number {
  return Date.parse(right.created_at) - Date.parse(left.created_at);
}

const wrapValueStyle: React.CSSProperties = {
  overflowWrap: "anywhere",
  wordBreak: "break-word",
};

const AuditValue: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Typography.Text style={wrapValueStyle}>{children}</Typography.Text>
);



export const IntegrationAuditPanel: React.FC = () => {
  const { translate } = useTranslation();
  const { token } = theme.useToken();
  const [selectedOwner, setSelectedOwner] = useState<AuditOwnerFilter>("all");
  const [selectedKey, setSelectedKey] = useState<RuntimeConfigKey | "all">("all");
  const [selectedAction, setSelectedAction] = useState<AuditActionFilter>("all");
  const [selectedLimit, setSelectedLimit] = useState<(typeof LIMIT_OPTIONS)[number]>(50);
  const [auditRows, setAuditRows] = useState<IntegrationConfigAuditRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [hasLoadError, setHasLoadError] = useState(false);

  const ownerKeys = useMemo(() => getOwnerKeys(selectedOwner), [selectedOwner]);
  const keysToLoad = selectedKey === "all" ? ownerKeys : [selectedKey];

  const ownerOptions = OWNER_FILTER_VALUES.map((owner) => ({
    value: owner,
    label: getOwnerLabel(owner, translate),
  }));
  const keyOptions = [
    { value: "all", label: translate("settings.integration.auditPanel.keys.all", {}, "Semua") },
    ...ownerKeys.map((key) => ({ value: key, label: getRuntimeConfigAuditLabel(key, translate) })),
  ];
  const actionOptions = ACTION_FILTER_VALUES.map((action) => ({
    value: action,
    label: getActionLabel(action, translate),
  }));
  const limitOptions = LIMIT_OPTIONS.map((limit) => ({ value: limit, label: String(limit) }));

  const changeOwner = (nextOwner: AuditOwnerFilter) => {
    const nextOwnerKeys = getOwnerKeys(nextOwner);
    setSelectedOwner(nextOwner);
    setSelectedKey((currentKey) => {
      if (currentKey === "all") return "all";
      return nextOwnerKeys.includes(currentKey) ? currentKey : "all";
    });
  };

  const changeKey = (nextKey: string) => {
    setSelectedKey(nextKey !== "all" && isRuntimeConfigKey(nextKey) ? nextKey : "all");
  };

  const loadAuditRows = async () => {
    setIsModalOpen(true);
    setIsLoading(true);
    setAuditRows([]);
    setHasLoadError(false);

    const auditResults = await Promise.allSettled(
      keysToLoad.map((key) => integrationConfigClient.audit(key, selectedLimit))
    );

    if (auditResults.some((result) => result.status === "rejected")) {
      setAuditRows([]);
      setHasLoadError(true);
      setIsLoading(false);
      return;
    }

    const nextRows = auditResults
      .flatMap((result) => result.status === "fulfilled" ? result.value : [])
      .filter((row) => selectedAction === "all" || row.action === selectedAction)
      .sort(sortNewestFirst)
      .slice(0, selectedLimit);

    setAuditRows(nextRows);
    setIsLoading(false);
  };

  const auditCollapseItems = useMemo(() => {
    return auditRows.map((row) => {
      let color = "default";
      if (row.action === "secret_rotated") color = "volcano";
      else if (row.action === "value_updated") color = "blue";
      else if (row.action === "runtime_read") color = "green";

      const label = getRuntimeConfigAuditLabel(row.key_name, translate);
      const actionLabel = getActionLabel(row.action, translate);
      const date = formatAuditDate(row.created_at);

      const header = (
        <Space>
          <Tag color={color}>{actionLabel}</Tag>
          <Typography.Text strong>{label}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: "0.85em" }}>{date}</Typography.Text>
        </Space>
      );

      return {
        key: row.id,
        label: header,
        children: (
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label={translate("settings.integration.audit.fields.key", {}, "Key")}>
              <AuditValue>{row.key_name}</AuditValue>
            </Descriptions.Item>
            <Descriptions.Item label={translate("settings.integration.audit.fields.timestamp", {}, "Timestamp")}>
              <AuditValue>{date}</AuditValue>
            </Descriptions.Item>
            <Descriptions.Item label={translate("settings.integration.audit.fields.actorRole", {}, "Actor role")}>
              <AuditValue>{row.actor_role || "-"}</AuditValue>
            </Descriptions.Item>
            <Descriptions.Item label={translate("settings.integration.audit.fields.actorId", {}, "Actor ID")}>
              <AuditValue>{row.actor_id || "-"}</AuditValue>
            </Descriptions.Item>
            <Descriptions.Item label={translate("settings.integration.audit.fields.request", {}, "Request")}>
              <AuditValue>{row.request_id || "-"}</AuditValue>
            </Descriptions.Item>
            <Descriptions.Item label={translate("settings.integration.audit.fields.source", {}, "Source")}>
              <AuditValue>{row.source || "-"}</AuditValue>
            </Descriptions.Item>
            <Descriptions.Item label={translate("settings.integration.audit.fields.reason", {}, "Reason")}>
              <AuditValue>{row.reason || "-"}</AuditValue>
            </Descriptions.Item>
            <Descriptions.Item label={translate("settings.integration.audit.fields.oldValue", {}, "Old")}>
              <AuditValue>{formatAuditValue(row.old_masked_value, row.metadata?.old_value)}</AuditValue>
            </Descriptions.Item>
            <Descriptions.Item label={translate("settings.integration.audit.fields.newValue", {}, "New")}>
              <AuditValue>{formatAuditValue(row.new_masked_value, row.metadata?.new_value)}</AuditValue>
            </Descriptions.Item>
          </Descriptions>
        ),
      };
    });
  }, [auditRows, translate]);

  return (
    <section role="region" aria-label={translate("settings.tabs.integrationAudit", {}, "Riwayat Pengaturan")}>
      <Card>
        <Space direction="vertical" size={token.marginMD} style={{ width: "100%" }}>
          <Space wrap style={{ width: "100%" }}>
            <Space direction="vertical" size={token.marginXXS}>
              <Typography.Text>{translate("settings.integration.auditPanel.ownerLabel", {}, "Area")}</Typography.Text>
              <Select
                aria-label={translate("settings.integration.auditPanel.ownerLabel", {}, "Area")}
                style={{ minWidth: 180 }}
                value={selectedOwner}
                options={ownerOptions}
                onChange={(value) => changeOwner(value as AuditOwnerFilter)}
              />
            </Space>
            <Space direction="vertical" size={token.marginXXS}>
              <Typography.Text>{translate("settings.integration.auditPanel.keyLabel", {}, "Konfigurasi")}</Typography.Text>
              <Select
                aria-label={translate("settings.integration.auditPanel.keyLabel", {}, "Konfigurasi")}
                style={{ minWidth: 240 }}
                value={selectedKey}
                options={keyOptions}
                onChange={(value) => changeKey(String(value))}
              />
            </Space>
            <Space direction="vertical" size={token.marginXXS}>
              <Typography.Text>{translate("settings.integration.auditPanel.actionLabel", {}, "Aksi")}</Typography.Text>
              <Select
                aria-label={translate("settings.integration.auditPanel.actionLabel", {}, "Aksi")}
                style={{ minWidth: 180 }}
                value={selectedAction}
                options={actionOptions}
                onChange={(value) => setSelectedAction(value as AuditActionFilter)}
              />
            </Space>
            <Space direction="vertical" size={token.marginXXS}>
              <Typography.Text>{translate("settings.integration.auditPanel.limitLabel", {}, "Limit")}</Typography.Text>
              <Select
                aria-label={translate("settings.integration.auditPanel.limitLabel", {}, "Limit")}
                style={{ minWidth: 120 }}
                value={selectedLimit}
                options={limitOptions}
                onChange={(value) => setSelectedLimit(Number(value) as (typeof LIMIT_OPTIONS)[number])}
              />
            </Space>
          </Space>
          <Button loading={isLoading} onClick={() => void loadAuditRows()}>
            {translate("settings.integration.auditPanel.load", {}, "Muat audit")}
          </Button>
        </Space>
      </Card>

      <Modal
        title={translate("settings.integration.auditPanel.modalTitle", {}, "Riwayat Pengaturan")}
        open={isModalOpen}
        onCancel={() => setIsModalOpen(false)}
        footer={null}
        width={800}
        styles={{ body: { maxHeight: "70vh", overflowY: "auto", marginTop: token.marginMD } }}
      >
        <Space direction="vertical" size={token.marginMD} style={{ width: "100%" }}>
          {isLoading ? (
            <div style={{ textAlign: "center", padding: token.marginLG }}>
              <Spin tip={translate("settings.integration.auditPanel.loading", {}, "Memuat riwayat pengaturan...")} />
            </div>
          ) : null}
          {hasLoadError ? (
            <Alert
              type="error"
              showIcon
              message={translate("settings.integration.auditPanel.error", {}, "Riwayat pengaturan tidak dapat dimuat.")}
            />
          ) : null}
          {!isLoading && !hasLoadError && auditRows.length === 0 ? (
            <Empty description={translate("settings.integration.auditPanel.empty", {}, "Belum ada audit untuk filter ini.")} />
          ) : null}
          {!isLoading && !hasLoadError && auditRows.length > 0 ? (
            <Collapse bordered={false} items={auditCollapseItems} />
          ) : null}
        </Space>
      </Modal>
    </section>
  );
};

export default IntegrationAuditPanel;
