import { Edit, useForm } from "@refinedev/antd";
import { useTranslation } from "@refinedev/core";
import { Form, Input, Tabs, Card, Row, Col, Upload, Typography } from "antd";
import type { TabsProps } from "antd";
import { useSupabaseUpload } from "../../hooks/useSupabaseUpload";
import { MEDIA_BUCKET } from "../../utils/storage";
import { BiteshipAreaSearch } from "../../components/biteship-area-search";
import { MapLocationPicker } from "../../components/map-location-picker";

interface SettingsFormValues {
  store_name: string;
  phone_number: string;
  email: string;
  organization: string;
  origin_postal_code: string;
  origin_latitude: string;
  origin_longitude: string;
  origin_area_id: string;
  store_address: string;
  primary_logo_url: string;
  app_icon_url: string;
}

const LOGO_PATH_PREFIX = "settings/";

interface LogoUploadProps {
  value?: string;
  onChange?: (url: string | undefined) => void;
  placeholder?: string;
}

const LogoUpload: React.FC<LogoUploadProps> = ({ value, onChange, placeholder }) => {
  const fileList = value
    ? [{ uid: "-1", name: "logo", url: value, status: "done" as const }]
    : [];

  const { beforeUpload, customRequest, handleRemove } = useSupabaseUpload(
    {
      bucket: MEDIA_BUCKET,
      pathPrefix: LOGO_PATH_PREFIX,
      maxCount: 1,
      replaceOnUpload: true,
    },
    value,
    onChange
  );

  return (
    <Upload
      listType="picture-card"
      maxCount={1}
      accept="image/jpeg,image/png,image/webp,image/gif"
      fileList={fileList}
      beforeUpload={beforeUpload}
      onRemove={() => {
        if (value) handleRemove(value);
        return true;
      }}
      customRequest={customRequest}
    >
      {fileList.length === 0 ? placeholder || "+ Upload" : null}
    </Upload>
  );
};

export const Settings: React.FC = () => {
  const { translate } = useTranslation();
  const { formProps, saveButtonProps, form } = useForm<SettingsFormValues>({
    action: "edit",
    resource: "settings",
    id: 1,
    redirect: false,
    mutationMode: "pessimistic",
    warnWhenUnsavedChanges: true,
    successNotification: {
      message: translate("settings.saveSuccess", {}, "Settings saved successfully"),
      type: "success",
    },
    errorNotification: {
      message: translate("settings.saveError", {}, "Failed to save settings"),
      type: "error",
    },
  });

  const handleAreaSelect = (area: { areaId: string; areaName: string; postalCode: number }) => {
    form.setFieldValue("origin_area_id", area.areaId);
    form.setFieldValue("origin_postal_code", String(area.postalCode));
  };

  const handleLocationChange = (lat: string, lng: string) => {
    form.setFieldValue("origin_latitude", lat);
    form.setFieldValue("origin_longitude", lng);
  };

  const tabItems: TabsProps["items"] = [
    {
      key: "storeProfile",
      label: translate("settings.tabs.storeProfile", {}, "Store Profile"),
      children: (
        <Card>
          <Form.Item
            label={translate("settings.fields.storeName", {}, "Store Name")}
            name="store_name"
            rules={[{ required: true, message: translate("settings.validation.storeNameRequired", {}, "Store name is required") }]}
          >
            <Input placeholder={translate("settings.fields.storeNamePlaceholder", {}, "Enter store name")} />
          </Form.Item>
          <Form.Item
            label={translate("settings.fields.phoneNumber", {}, "Phone Number")}
            name="phone_number"
            rules={[{ required: true, message: translate("settings.validation.phoneRequired", {}, "Phone number is required") }]}
          >
            <Input placeholder={translate("settings.fields.phoneNumberPlaceholder", {}, "Enter phone number")} />
          </Form.Item>
          <Form.Item
            label={translate("settings.fields.email", {}, "Email")}
            name="email"
            rules={[
              { required: true, message: translate("settings.validation.emailRequired", {}, "Email is required") },
              { type: "email", message: translate("settings.validation.emailInvalid", {}, "Invalid email format") },
            ]}
          >
            <Input placeholder={translate("settings.fields.emailPlaceholder", {}, "Enter email")} />
          </Form.Item>
          <Form.Item
            label={translate("settings.fields.organization", {}, "Organization")}
            name="organization"
          >
            <Input placeholder={translate("settings.fields.organizationPlaceholder", {}, "Enter organization name")} />
          </Form.Item>
        </Card>
      ),
    },
    {
      key: "shippingSettings",
      label: translate("settings.tabs.shippingSettings", {}, "Shipping Settings"),
      children: (
        <Card>
          <Form.Item
            label={translate("settings.fields.originAreaId", {}, "Origin Area")}
            name="origin_area_id"
            rules={[{ required: true, message: translate("settings.validation.areaIdRequired", {}, "Origin area is required") }]}
          >
            <BiteshipAreaSearch
              placeholder={translate("settings.fields.originAreaIdPlaceholder", {}, "Search area, district, or city...")}
              onAreaSelect={handleAreaSelect}
            />
          </Form.Item>
          <Form.Item
            label={translate("settings.fields.originPostalCode", {}, "Postal Code")}
            name="origin_postal_code"
            rules={[{ required: true, message: translate("settings.validation.postalCodeRequired", {}, "Postal code is required") }]}
          >
            <Input placeholder={translate("settings.fields.originPostalCodePlaceholder", {}, "Enter postal code")} />
          </Form.Item>
          <Form.Item
            label={translate("settings.fields.storeAddress", {}, "Store Address")}
            name="store_address"
            rules={[{ required: true, message: translate("settings.validation.addressRequired", {}, "Address is required") }]}
          >
            <Input.TextArea
              rows={4}
              placeholder={translate("settings.fields.storeAddressPlaceholder", {}, "Enter full store address")}
            />
          </Form.Item>
          <Form.Item
            label={translate("settings.fields.mapLocationPicker", {}, "Store Location")}
          >
            <MapLocationPicker
              latitude={form.getFieldValue("origin_latitude")}
              longitude={form.getFieldValue("origin_longitude")}
              onLocationChange={handleLocationChange}
              height="300px"
            />
            <Typography.Text type="secondary" style={{ fontSize: "12px", marginTop: "8px", display: "block" }}>
              {translate("settings.fields.mapHelperText", "Or click directly on the map to select location")}
            </Typography.Text>
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                label={translate("settings.fields.originLatitude", {}, "Latitude")}
                name="origin_latitude"
              >
                <Input readOnly placeholder={translate("settings.fields.originLatitudePlaceholder", {}, "Auto-filled from map")} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label={translate("settings.fields.originLongitude", {}, "Longitude")}
                name="origin_longitude"
              >
                <Input readOnly placeholder={translate("settings.fields.originLongitudePlaceholder", {}, "Auto-filled from map")} />
              </Form.Item>
            </Col>
          </Row>
        </Card>
      ),
    },
    {
      key: "branding",
      label: translate("settings.tabs.branding", {}, "Branding & Logos"),
      children: (
        <Card>
          <Form.Item
            label={translate("settings.fields.primaryLogo", {}, "Primary Logo")}
            name="primary_logo_url"
          >
            <LogoUpload
              placeholder={translate("settings.fields.primaryLogoPlaceholder", {}, "+ Upload Logo")}
            />
          </Form.Item>
          <Form.Item
            label={translate("settings.fields.appIcon", {}, "App Icon")}
            name="app_icon_url"
          >
            <LogoUpload
              placeholder={translate("settings.fields.appIconPlaceholder", {}, "+ Upload Icon")}
            />
          </Form.Item>
        </Card>
      ),
    },
  ];

  return (
    <Edit
      saveButtonProps={saveButtonProps}
      title={translate("settings.title", {}, "Settings")}
      breadcrumb={false}
    >
      <Form {...formProps} layout="vertical">
        <Tabs
          defaultActiveKey="storeProfile"
          items={tabItems}
          type="card"
        />
      </Form>
    </Edit>
  );
};

export default Settings;
