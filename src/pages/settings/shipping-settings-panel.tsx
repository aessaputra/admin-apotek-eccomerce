import { SettingOutlined } from "@ant-design/icons";
import { useTranslation } from "@refinedev/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Col, Input, Row, Space, Tag, Typography, message, theme } from "antd";
import { useEffect, useMemo, useState } from "react";
import { BiteshipAreaSearch } from "../../components/biteship-area-search";
import { CourierPickerModal } from "../../components/courier-picker-modal";
import { MapLocationPicker } from "../../components/map-location-picker";
import {
  getCourierSelectionCompany,
  getFallbackCourierOption,
  parseCouriers,
} from "../../constants/couriers.ts";
import { useBiteshipCouriers } from "../../hooks/useBiteshipCouriers";
import {
  integrationConfigClient,
  type IntegrationConfigSummaryRow,
  type RuntimeConfigKey,
} from "./integration-config-client";
import { INTEGRATION_CONFIG_OWNERSHIP } from "./integration-config-ownership";
import {
  OperationalConfigRow,
  SecretReplacementInput,
  createBlankSecretReplacementDraft,
  type SecretReplacementDraft,
} from "./integration-config-primitives";

const SHIPPING_CONFIG_KEYS = INTEGRATION_CONFIG_OWNERSHIP.shipping;
const SHIPPING_SAVE_REASON = "settings_shipping_save";
const SHIPPING_SUMMARY_QUERY_KEY = ["integration-config", "summary", "shipping"] as const;

interface CourierPickerTriggerProps {
  value?: string[];
  loading?: boolean;
  disabled?: boolean;
  onOpenModal: () => void;
}

type ShippingUpdate = {
  key: RuntimeConfigKey;
  value: unknown;
};

function getStringValue(row: IntegrationConfigSummaryRow | undefined): string {
  if (row?.non_secret_value === null || row?.non_secret_value === undefined) return "";
  return String(row.non_secret_value);
}

function getStringArrayValue(row: IntegrationConfigSummaryRow | undefined): string[] {
  if (Array.isArray(row?.non_secret_value)) {
    return row.non_secret_value.map(String);
  }

  if (typeof row?.non_secret_value === "string") {
    return parseCouriers(row.non_secret_value);
  }

  return [];
}

function withShippingDisplay(
  row: IntegrationConfigSummaryRow,
  displayName: string
): IntegrationConfigSummaryRow {
  return { ...row, display_name: displayName, description: null };
}

const CourierPickerTrigger: React.FC<CourierPickerTriggerProps> = ({
  value = [],
  loading,
  disabled = false,
  onOpenModal,
}) => {
  const { translate } = useTranslation();
  const selectedServices = value
    .map((selection) => {
      const companyCode = getCourierSelectionCompany(selection);
      if (!companyCode) return null;

      const [, ...serviceParts] = selection.split(":");
      const fallbackCourier = getFallbackCourierOption(companyCode);
      const serviceCode = serviceParts.join(":") || "*";

      return {
        key: selection,
        companyLabel: fallbackCourier.label,
        serviceLabel:
          serviceCode === "*"
            ? translate("settings.courierPicker.allServices", {}, "All services")
            : serviceCode.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()),
      };
    })
    .filter((selection): selection is NonNullable<typeof selection> => selection !== null);
  const displayText = selectedServices.length > 0
    ? selectedServices.length === 1
      ? `${selectedServices[0].companyLabel} • ${selectedServices[0].serviceLabel}`
      : translate(
          "settings.courierPicker.selectedCount",
          { count: selectedServices.length },
          `${selectedServices.length} services selected`
        )
    : translate("settings.fields.couriersPlaceholder", {}, "Select couriers");

  return (
    <Button
      onClick={onOpenModal}
      disabled={loading || disabled}
      style={{ width: "100%", textAlign: "left", height: "auto", padding: "8px 12px" }}
    >
      <Space direction="vertical" size={0} style={{ width: "100%" }}>
        <Space style={{ width: "100%", justifyContent: "space-between" }}>
          <Typography.Text>{displayText}</Typography.Text>
          <SettingOutlined style={{ color: "#999" }} />
        </Space>
        {selectedServices.length > 0 && selectedServices.length <= 5 ? (
          <Space size={[4, 4]} wrap style={{ marginTop: 4 }}>
            {selectedServices.map((selection) => (
              <Tag key={selection.key} style={{ margin: 0 }}>
                {selection.companyLabel} • {selection.serviceLabel}
              </Tag>
            ))}
          </Space>
        ) : null}
      </Space>
    </Button>
  );
};

export const ShippingSettingsPanel: React.FC = () => {
  const { translate } = useTranslation();
  const { token } = theme.useToken();
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const { couriers, loading: couriersLoading, error: couriersError, isFallback: couriersFallback } = useBiteshipCouriers();
  const [courierModalOpen, setCourierModalOpen] = useState(false);
  const [apiKeyDraft, setApiKeyDraft] = useState<SecretReplacementDraft>(() => createBlankSecretReplacementDraft());
  const [enabledCouriersDraft, setEnabledCouriersDraft] = useState<string[]>([]);
  const [originAreaIdDraft, setOriginAreaIdDraft] = useState("");
  const [originPostalCodeDraft, setOriginPostalCodeDraft] = useState("");
  const [originLatitudeDraft, setOriginLatitudeDraft] = useState("");
  const [originLongitudeDraft, setOriginLongitudeDraft] = useState("");
  const [shipperNameDraft, setShipperNameDraft] = useState("");
  const [shipperPhoneDraft, setShipperPhoneDraft] = useState("");
  const [shipperEmailDraft, setShipperEmailDraft] = useState("");
  const [addressDraft, setAddressDraft] = useState("");
  const [organizationDraft, setOrganizationDraft] = useState("");

  const summaryQuery = useQuery({
    queryKey: SHIPPING_SUMMARY_QUERY_KEY,
    queryFn: () => integrationConfigClient.summary([...SHIPPING_CONFIG_KEYS]),
  });

  const rowsByKey = useMemo(
    () => new Map((summaryQuery.data?.rows ?? []).map((row) => [row.key_name, row])),
    [summaryQuery.data]
  );

  const biteshipHealth = summaryQuery.data?.health?.biteship;
  const showBiteshipHealthAlert = !!biteshipHealth && (
    !biteshipHealth.requiredConfigComplete || biteshipHealth.apiKeySource !== "runtime_config"
  );

  const apiKeyRow = rowsByKey.get("biteship.api_key");
  const enabledCouriersRow = rowsByKey.get("biteship.enabled_couriers");
  const originPostalCodeRow = rowsByKey.get("biteship.origin_postal_code");
  const originAreaIdRow = rowsByKey.get("biteship.origin_area_id");
  const originLatitudeRow = rowsByKey.get("biteship.origin_latitude");
  const originLongitudeRow = rowsByKey.get("biteship.origin_longitude");
  const shipperNameRow = rowsByKey.get("shop.shipper_name");
  const shipperPhoneRow = rowsByKey.get("shop.shipper_phone");
  const shipperEmailRow = rowsByKey.get("shop.shipper_email");
  const addressRow = rowsByKey.get("shop.address");
  const organizationRow = rowsByKey.get("shop.organization");

  useEffect(() => {
    setEnabledCouriersDraft(getStringArrayValue(enabledCouriersRow));
    setOriginPostalCodeDraft(getStringValue(originPostalCodeRow));
    setOriginAreaIdDraft(getStringValue(originAreaIdRow));
    setOriginLatitudeDraft(getStringValue(originLatitudeRow));
    setOriginLongitudeDraft(getStringValue(originLongitudeRow));
    setShipperNameDraft(getStringValue(shipperNameRow));
    setShipperPhoneDraft(getStringValue(shipperPhoneRow));
    setShipperEmailDraft(getStringValue(shipperEmailRow));
    setAddressDraft(getStringValue(addressRow));
    setOrganizationDraft(getStringValue(organizationRow));
  }, [
    addressRow,
    enabledCouriersRow,
    organizationRow,
    originAreaIdRow,
    originLatitudeRow,
    originLongitudeRow,
    originPostalCodeRow,
    shipperEmailRow,
    shipperNameRow,
    shipperPhoneRow,
  ]);

  const refreshShippingSummary = async () => {
    await queryClient.invalidateQueries({ queryKey: SHIPPING_SUMMARY_QUERY_KEY });
  };

  const rotateApiKeyMutation = useMutation({
    mutationFn: (secret: string) => integrationConfigClient.rotateSecret("biteship.api_key", secret, SHIPPING_SAVE_REASON),
    onSuccess: async () => {
      setApiKeyDraft(createBlankSecretReplacementDraft());
      messageApi.success(translate("settings.shipping.saveSuccess", {}, "Shipping settings saved."));
      await refreshShippingSummary();
    },
    onError: () => {
      messageApi.error(translate("settings.shipping.saveError", {}, "Shipping settings could not be saved."));
    },
  });

  const updateRuntimeMutation = useMutation({
    mutationFn: (updates: ShippingUpdate[]) =>
      Promise.all(updates.map((update) => integrationConfigClient.updateValue(update.key, update.value, SHIPPING_SAVE_REASON))),
    onSuccess: async () => {
      messageApi.success(translate("settings.shipping.saveSuccess", {}, "Shipping settings saved."));
      await refreshShippingSummary();
    },
    onError: () => {
      messageApi.error(translate("settings.shipping.saveError", {}, "Shipping settings could not be saved."));
    },
  });

  const saveApiKey = () => {
    const secret = apiKeyDraft.value.trim();
    if (!secret) return;
    rotateApiKeyMutation.mutate(secret);
  };

  const saveRuntimeUpdates = (updates: ShippingUpdate[]) => {
    updateRuntimeMutation.mutate(updates);
  };

  const handleAreaSelect = (area: { areaId: string; areaName: string; postalCode: number }) => {
    setOriginAreaIdDraft(area.areaId);
    setOriginPostalCodeDraft(String(area.postalCode));
  };

  const handleLocationChange = (lat: string, lng: string) => {
    setOriginLatitudeDraft(lat);
    setOriginLongitudeDraft(lng);
  };

  const shippingPanelLabel = translate("settings.tabs.shippingSettings", {}, "Pengaturan Pengiriman");

  return (
    <>
      {contextHolder}
      <section role="region" aria-label={shippingPanelLabel}>
        <Card>
          <Space direction="vertical" size={token.marginMD} style={{ width: "100%" }}>

            {summaryQuery.isError ? (
              <Alert type="error" showIcon message={translate("settings.shipping.summary.error", {}, "Pengaturan pengiriman tidak dapat dimuat.")} />
            ) : null}
            {summaryQuery.isLoading ? (
              <Typography.Text>{translate("settings.shipping.summary.loading", {}, "Memuat pengaturan pengiriman...")}</Typography.Text>
            ) : null}
            {showBiteshipHealthAlert ? (
              <Alert
                type="warning"
                showIcon
                message={translate("settings.shipping.health.biteship.title", {}, "Konfigurasi Biteship belum siap")}
                description={translate(
                  "settings.shipping.health.biteship.description",
                  {
                    count: biteshipHealth.missingKeys.length,
                    source: biteshipHealth.apiKeySource,
                  },
                  biteshipHealth.apiKeySource === "runtime_config"
                    ? "Lengkapi konfigurasi runtime Biteship sebelum menghitung ongkir."
                    : "Pindahkan API key Biteship ke runtime_config sebelum menghitung ongkir."
                )}
              />
            ) : null}
            {apiKeyRow ? (
              <OperationalConfigRow
                row={withShippingDisplay(apiKeyRow, translate("settings.shipping.apiKey.label", {}, "Biteship API Key"))}
              >
                <SecretReplacementInput
                  label={translate("settings.shipping.apiKey.label", {}, "Biteship API Key")}
                  draft={apiKeyDraft}
                  onChange={setApiKeyDraft}
                  onSave={saveApiKey}
                  saving={rotateApiKeyMutation.isPending}
                  placeholder={translate("settings.shipping.apiKey.placeholder", {}, "Kosongkan jika tidak diganti")}
                  saveLabel={translate("buttons.save", {}, "Simpan")}
                />
              </OperationalConfigRow>
            ) : null}
            {enabledCouriersRow ? (
              <OperationalConfigRow
                row={withShippingDisplay(enabledCouriersRow, translate("settings.fields.couriers", {}, "Active Couriers"))}
              >
                <Space direction="vertical" style={{ width: "100%" }}>
                  <CourierPickerTrigger
                    value={enabledCouriersDraft}
                    loading={couriersLoading}
                    disabled={couriersFallback}
                    onOpenModal={() => setCourierModalOpen(true)}
                  />
                  {couriersError ? (
                    <Typography.Text type="danger">
                      {couriersFallback
                        ? translate("settings.fields.couriersLoadError", {}, "Failed to load live courier services. Editing is temporarily disabled to avoid saving incomplete data.")
                        : translate("settings.fields.couriersLoadError", {}, "Failed to load courier list.")}
                    </Typography.Text>
                  ) : null}
                  <Button loading={updateRuntimeMutation.isPending} onClick={() => saveRuntimeUpdates([{ key: "biteship.enabled_couriers", value: enabledCouriersDraft }])}>
                    {translate("buttons.save", {}, "Simpan")}
                  </Button>
                </Space>
              </OperationalConfigRow>
            ) : null}
            {originAreaIdRow ? (
              <OperationalConfigRow
                row={withShippingDisplay(originAreaIdRow, translate("settings.fields.originAreaId", {}, "Origin Area"))}
              >
                <Space direction="vertical" style={{ width: "100%" }}>
                  <BiteshipAreaSearch
                    value={originAreaIdDraft}
                    onChange={setOriginAreaIdDraft}
                    onAreaSelect={handleAreaSelect}
                    placeholder={translate("settings.fields.originAreaIdPlaceholder", {}, "Cari kecamatan, kota, atau area Biteship")}
                  />
                  <Input
                    aria-label={translate("settings.fields.originPostalCode", {}, "Postal Code")}
                    readOnly
                    value={originPostalCodeDraft}
                  />
                  <Button loading={updateRuntimeMutation.isPending} onClick={() => saveRuntimeUpdates([
                    { key: "biteship.origin_area_id", value: originAreaIdDraft },
                    { key: "biteship.origin_postal_code", value: originPostalCodeDraft },
                  ])}>
                    {translate("buttons.save", {}, "Simpan")}
                  </Button>
                </Space>
              </OperationalConfigRow>
            ) : null}
            {originLatitudeRow && originLongitudeRow ? (
              <OperationalConfigRow
                row={withShippingDisplay(originLatitudeRow, translate("settings.fields.mapLocationPicker", {}, "Store Location"))}
              >
                <Space direction="vertical" style={{ width: "100%" }}>
                  <MapLocationPicker
                    latitude={originLatitudeDraft}
                    longitude={originLongitudeDraft}
                    onLocationChange={handleLocationChange}
                    height="300px"
                  />
                  <Row gutter={16}>
                    <Col span={12}>
                      <Input aria-label={translate("settings.fields.originLatitude", {}, "Latitude")} readOnly value={originLatitudeDraft} />
                    </Col>
                    <Col span={12}>
                      <Input aria-label={translate("settings.fields.originLongitude", {}, "Longitude")} readOnly value={originLongitudeDraft} />
                    </Col>
                  </Row>
                  <Button loading={updateRuntimeMutation.isPending} onClick={() => saveRuntimeUpdates([
                    { key: "biteship.origin_latitude", value: originLatitudeDraft },
                    { key: "biteship.origin_longitude", value: originLongitudeDraft },
                  ])}>
                    {translate("buttons.save", {}, "Simpan")}
                  </Button>
                </Space>
              </OperationalConfigRow>
            ) : null}
            {shipperNameRow ? (
              <OperationalConfigRow row={withShippingDisplay(shipperNameRow, translate("settings.shipping.shipperName.label", {}, "Shipper Name"))}>
                <Space direction="vertical" style={{ width: "100%" }}>
                  <Input aria-label={translate("settings.shipping.shipperName.label", {}, "Shipper Name")} value={shipperNameDraft} onChange={(event) => setShipperNameDraft(event.target.value)} />
                  <Button loading={updateRuntimeMutation.isPending} onClick={() => saveRuntimeUpdates([{ key: "shop.shipper_name", value: shipperNameDraft }])}>{translate("buttons.save", {}, "Simpan")}</Button>
                </Space>
              </OperationalConfigRow>
            ) : null}
            {shipperPhoneRow ? (
              <OperationalConfigRow row={withShippingDisplay(shipperPhoneRow, translate("settings.shipping.shipperPhone.label", {}, "Shipper Phone"))}>
                <Space direction="vertical" style={{ width: "100%" }}>
                  <Input aria-label={translate("settings.shipping.shipperPhone.label", {}, "Shipper Phone")} value={shipperPhoneDraft} onChange={(event) => setShipperPhoneDraft(event.target.value)} />
                  <Button loading={updateRuntimeMutation.isPending} onClick={() => saveRuntimeUpdates([{ key: "shop.shipper_phone", value: shipperPhoneDraft }])}>{translate("buttons.save", {}, "Simpan")}</Button>
                </Space>
              </OperationalConfigRow>
            ) : null}
            {shipperEmailRow ? (
              <OperationalConfigRow row={withShippingDisplay(shipperEmailRow, translate("settings.shipping.shipperEmail.label", {}, "Shipper Email"))}>
                <Space direction="vertical" style={{ width: "100%" }}>
                  <Input aria-label={translate("settings.shipping.shipperEmail.label", {}, "Shipper Email")} value={shipperEmailDraft} onChange={(event) => setShipperEmailDraft(event.target.value)} />
                  <Button loading={updateRuntimeMutation.isPending} onClick={() => saveRuntimeUpdates([{ key: "shop.shipper_email", value: shipperEmailDraft }])}>{translate("buttons.save", {}, "Simpan")}</Button>
                </Space>
              </OperationalConfigRow>
            ) : null}
            {addressRow ? (
              <OperationalConfigRow row={withShippingDisplay(addressRow, translate("settings.fields.storeAddress", {}, "Store Address"))}>
                <Space direction="vertical" style={{ width: "100%" }}>
                  <Input.TextArea aria-label={translate("settings.fields.storeAddress", {}, "Store Address")} placeholder={translate("settings.fields.storeAddressPlaceholder", {}, "Alamat asal pengiriman")} rows={3} value={addressDraft} onChange={(event) => setAddressDraft(event.target.value)} />
                  <Button loading={updateRuntimeMutation.isPending} onClick={() => saveRuntimeUpdates([{ key: "shop.address", value: addressDraft }])}>{translate("buttons.save", {}, "Simpan")}</Button>
                </Space>
              </OperationalConfigRow>
            ) : null}
            {organizationRow ? (
              <OperationalConfigRow row={withShippingDisplay(organizationRow, translate("settings.fields.organization", {}, "Organization"))}>
                <Space direction="vertical" style={{ width: "100%" }}>
                  <Input aria-label={translate("settings.fields.organization", {}, "Organization")} value={organizationDraft} onChange={(event) => setOrganizationDraft(event.target.value)} />
                  <Button loading={updateRuntimeMutation.isPending} onClick={() => saveRuntimeUpdates([{ key: "shop.organization", value: organizationDraft }])}>{translate("buttons.save", {}, "Simpan")}</Button>
                </Space>
              </OperationalConfigRow>
            ) : null}
          </Space>
        </Card>
        <CourierPickerModal
          open={courierModalOpen}
          value={enabledCouriersDraft}
          couriers={couriers}
          loading={couriersLoading}
          error={couriersFallback ? couriersError : null}
          readOnly={couriersFallback}
          onConfirm={(selectedCouriers) => {
            setEnabledCouriersDraft(selectedCouriers);
            setCourierModalOpen(false);
          }}
          onCancel={() => setCourierModalOpen(false)}
        />
      </section>
    </>
  );
};

export default ShippingSettingsPanel;
