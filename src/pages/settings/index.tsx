import { Edit, useForm } from "@refinedev/antd";
import { useTranslation } from "@refinedev/core";
import { useQueryClient } from "@tanstack/react-query";
import { Form, Input, Tabs, Card, Upload } from "antd";
import type { TabsProps } from "antd";
import { useState } from "react";
import { useSupabaseUpload } from "../../hooks/useSupabaseUpload";
import { MEDIA_BUCKET, resolveStoragePublicUrl } from "../../utils/storage";
import { STORE_BRANDING_QUERY_KEY } from "../../hooks/useStoreBranding";
import { IntegrationAuditPanel } from "./integration-audit-panel";
import { IntegrationConfigPanel } from "./integration-config-panel";
import { PaymentSettingsPanel } from "./payment-settings-panel";
import { ShippingSettingsPanel } from "./shipping-settings-panel";
import { AdminSettingsPanel } from "./admin-settings-panel";

interface SettingsFormValues {
  store_name: string;
  phone_number: string;
  email: string;
  primary_logo_url: string;
}

const LOGO_PATH_PREFIX = "settings/";
const STORE_PROFILE_TAB_KEY = "storeProfile";

interface LogoUploadProps {
  value?: string;
  onChange?: (path: string | undefined) => void;
  placeholder?: string;
}

const LogoUpload: React.FC<LogoUploadProps> = ({ value, onChange, placeholder }) => {
  const fileList = value
    ? [{ uid: "-1", name: "logo", url: resolveStoragePublicUrl(value, MEDIA_BUCKET) ?? value, status: "done" as const }]
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
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState(STORE_PROFILE_TAB_KEY);
  const { formProps, saveButtonProps, form } = useForm<SettingsFormValues>({
    action: "edit",
    resource: "settings",
    id: 1,
    redirect: false,
    mutationMode: "pessimistic",
    warnWhenUnsavedChanges: true,
    onMutationSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: STORE_BRANDING_QUERY_KEY });
    },
    successNotification: {
      message: translate("settings.saveSuccess", {}, "Settings saved successfully"),
      type: "success",
    },
    errorNotification: {
      message: translate("settings.saveError", {}, "Failed to save settings"),
      type: "error",
    },
  });
  const storeProfileSaveButtonProps = activeTab === STORE_PROFILE_TAB_KEY
    ? saveButtonProps
    : {
        ...saveButtonProps,
        disabled: true,
        style: {
          ...saveButtonProps.style,
          display: "none",
        },
      };

  const tabItems: TabsProps["items"] = [
    {
      key: "storeProfile",
      label: translate("settings.tabs.storeProfile", {}, "Profil Toko"),
      children: (
        <Form {...formProps} form={form} layout="vertical">
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
              label={translate("settings.fields.primaryLogo", {}, "Primary Logo")}
              name="primary_logo_url"
            >
              <LogoUpload
                placeholder={translate("settings.fields.primaryLogoPlaceholder", {}, "+ Upload Logo")}
              />
            </Form.Item>
          </Card>
        </Form>
      ),
    },
    {
      key: "shippingSettings",
      label: translate("settings.tabs.shippingSettings", {}, "Pengiriman"),
      children: <ShippingSettingsPanel />,
    },
    {
      key: "adminSettings",
      label: translate("settings.tabs.adminSettings", {}, "Tambah Admin"),
      children: <AdminSettingsPanel />,
    },
    {
      key: "paymentSettings",
      label: translate("settings.tabs.paymentSettings", {}, "Pembayaran"),
      children: <PaymentSettingsPanel />,
    },
    {
      key: "integrationConfig",
      label: translate("settings.tabs.integrationConfig", {}, "Lanjutan"),
      children: <IntegrationConfigPanel />,
    },
    {
      key: "integrationAudit",
      label: translate("settings.tabs.integrationAudit", {}, "Riwayat Pengaturan"),
      children: <IntegrationAuditPanel />,
    },
  ];

  return (
    <>
      <Edit
        saveButtonProps={storeProfileSaveButtonProps}
        title={translate("settings.title", {}, "Settings")}
        breadcrumb={false}
      >
        <Tabs
          activeKey={activeTab}
          items={tabItems}
          onChange={setActiveTab}
          type="card"
        />
      </Edit>
    </>
  );
};

export default Settings;
