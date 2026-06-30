import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Modal } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Settings from "../settings";
import shippingPanelSource from "../settings/shipping-settings-panel.tsx?raw";
import { RUNTIME_CONFIG_KEYS, integrationConfigClient, type IntegrationConfigAuditRow } from "../settings/integration-config-client";
import { IntegrationAuditPanel } from "../settings/integration-audit-panel";
import { INTEGRATION_CONFIG_OWNERSHIP, getPrimaryOwnerForIntegrationConfigKey } from "../settings/integration-config-ownership";
import {
  ConfigDetailsDisclosure,
  OperationalConfigRow,
  SecretReplacementInput,
  createBlankSecretReplacementDraft,
} from "../settings/integration-config-primitives";
import { Profile } from "../profile";
import { CategoryCreate } from "../categories/create";
import { CategoryEdit } from "../categories/edit";
import { ProductCreate } from "../products/create";
import { ProductEdit } from "../products/edit";

const mocks = vi.hoisted(() => {
  type Locale = "en" | "id";

  let locale: Locale = "id";
  const translations: Record<Locale, Record<string, string>> = {
    en: {
      "settings.integration.status.active": "Active",
      "settings.integration.audit.actions.runtimeRead": "Runtime read",
      "settings.integration.audit.actions.secretRotated": "Secret rotated",
      "settings.integration.audit.actions.valueUpdated": "Value updated",
      "settings.integration.audit.fields.key": "Key",
      "settings.integration.audit.fields.versionId": "Version ID",
      "settings.integration.audit.fields.version": "Version",
      "settings.integration.audit.fields.request": "Request",
      "settings.integration.audit.fields.actorRole": "Actor role",
      "settings.integration.audit.fields.actorId": "Actor ID",
      "settings.integration.audit.fields.source": "Source",
      "settings.integration.audit.fields.reason": "Reason",
      "settings.integration.audit.fields.timestamp": "Timestamp",
      "settings.integration.audit.fields.oldValue": "Old",
      "settings.integration.audit.fields.newValue": "New",
      "settings.shipping.shipperName.label": "Shipper Name",
      "settings.shipping.shipperPhone.label": "Shipper Phone",
      "settings.shipping.shipperEmail.label": "Shipper Email",
    },
    id: {
      "settings.integration.status.active": "Aktif",
      "settings.integration.audit.actions.runtimeRead": "Runtime dibaca",
      "settings.integration.audit.actions.secretRotated": "Secret dirotasi",
      "settings.integration.audit.actions.valueUpdated": "Nilai diperbarui",
      "settings.integration.audit.fields.key": "Key",
      "settings.integration.audit.fields.versionId": "Version ID",
      "settings.integration.audit.fields.version": "Version",
      "settings.integration.audit.fields.request": "Request",
      "settings.integration.audit.fields.actorRole": "Actor role",
      "settings.integration.audit.fields.actorId": "Actor ID",
      "settings.integration.audit.fields.source": "Source",
      "settings.integration.audit.fields.reason": "Alasan",
      "settings.integration.audit.fields.timestamp": "Timestamp",
      "settings.integration.audit.fields.oldValue": "Lama",
      "settings.integration.audit.fields.newValue": "Baru",
      "settings.shipping.shipperName.label": "Nama Pengirim",
      "settings.shipping.shipperPhone.label": "Nomor Telepon Pengirim",
      "settings.shipping.shipperEmail.label": "Email Pengirim",
    },
  };

  const translate = vi.fn((key: string, paramsOrFallback?: Record<string, unknown> | string, fallback?: string) => {
    if (typeof paramsOrFallback === "string") {
      return paramsOrFallback;
    }

    return translations[locale][key] ?? fallback ?? key;
  });
  const useForm = vi.fn();
  const useSelect = vi.fn(() => ({ selectProps: { options: [{ label: "Category", value: "cat-1" }] } }));
  const useGetIdentity = vi.fn();
  const invalidate = vi.fn();
  const updatePassword = vi.fn();
  const messageError = vi.fn();
  const messageSuccess = vi.fn();
  const setFieldValue = vi.fn();
  const setFieldsValue = vi.fn();
  const setFields = vi.fn();
  const resetFields = vi.fn();
  const getFieldValue = vi.fn((field: string) => (field === "enabled_couriers" ? "jne:reg,grab:instant" : undefined));
  const courierModalConfirm = vi.fn();
  const duplicateSkuRows = { current: [] as Array<{ id: string }> };
  const nextSubmitValues = { current: undefined as Record<string, unknown> | undefined };
  const lastOnValuesChange = {
    current: undefined as
      | ((changed: Record<string, unknown>, all: Record<string, unknown>) => void)
      | undefined,
  };
  const productQueries: Array<{
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    neq: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
  }> = [];
  const productImagesInsert = vi.fn(() => Promise.resolve({ error: null }));
  const mfaListFactors = vi.fn(() => Promise.resolve({ data: { all: [] }, error: null }));
  const functionsInvoke = vi.fn();
  const supabaseFrom = vi.fn((table: string) => {
    if (table === "admin_products") {
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        neq: vi.fn(() => query),
        limit: vi.fn(() => Promise.resolve({ data: duplicateSkuRows.current, error: null })),
      };
      productQueries.push(query);
      return query;
    }

    if (table === "product_images") {
      return { insert: productImagesInsert };
    }

    return {};
  });

  return {
    setLocale: (nextLocale: Locale) => {
      locale = nextLocale;
    },
    translate,
    useForm,
    useSelect,
    useGetIdentity,
    invalidate,
    updatePassword,
    messageError,
    messageSuccess,
    setFieldValue,
    setFieldsValue,
    setFields,
    resetFields,
    getFieldValue,
    courierModalConfirm,
    duplicateSkuRows,
    nextSubmitValues,
    lastOnValuesChange,
    productQueries,
    productImagesInsert,
    mfaListFactors,
    functionsInvoke,
    supabaseFrom,
  };
});

vi.mock("@refinedev/core", () => ({
  useTranslation: () => ({ translate: mocks.translate }),
  useGetIdentity: mocks.useGetIdentity,
  useInvalidate: () => mocks.invalidate,
  useUpdatePassword: () => ({ mutate: mocks.updatePassword, isPending: false }),
  useNotification: () => ({ open: vi.fn() }),
}));

vi.mock("@refinedev/antd", () => ({
  Create: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Edit: ({
    children,
    saveButtonProps,
    title,
  }: {
    children: React.ReactNode;
    saveButtonProps?: { disabled?: boolean; style?: React.CSSProperties };
    title?: React.ReactNode;
  }) => (
    <div>
      <div>{title}</div>
      <button
        aria-label="Store Profile Save"
        disabled={saveButtonProps?.disabled}
        style={saveButtonProps?.style}
        type="submit"
      >
        Store Profile Save
      </button>
      {children}
    </div>
  ),
  useForm: mocks.useForm,
  useSelect: mocks.useSelect,
}));

vi.mock("../../components/product-image-upload", () => ({
  ProductImageUpload: () => <div>ProductImageUpload</div>,
}));

vi.mock("../../components/category-logo-upload", () => ({
  CategoryLogoUpload: () => <div>CategoryLogoUpload</div>,
}));

vi.mock("../../components/avatar-upload", () => ({
  AvatarUpload: () => <div>AvatarUpload</div>,
}));

vi.mock("../../components/biteship-area-search", () => ({
  BiteshipAreaSearch: ({
    onAreaSelect,
    onChange,
    placeholder,
  }: {
    onAreaSelect?: (area: { areaId: string; areaName: string; postalCode: number }) => void;
    onChange?: (areaId: string) => void;
    placeholder?: string;
  }) => (
    <>
      <input aria-label="Biteship area search" placeholder={placeholder} readOnly />
      <button
        type="button"
        onClick={() => {
          onChange?.("area-runtime-1");
          onAreaSelect?.({ areaId: "area-runtime-1", areaName: "Kebayoran Baru", postalCode: 12110 });
        }}
      >
        BiteshipAreaSearch
      </button>
    </>
  ),
}));

vi.mock("../../components/map-location-picker", () => ({
  MapLocationPicker: ({ onLocationChange }: { onLocationChange?: (lat: string, lng: string) => void }) => (
    <button type="button" onClick={() => onLocationChange?.("-6.244100", "106.799500")}>
      MapLocationPicker
    </button>
  ),
}));

vi.mock("../../components/courier-picker-modal", () => ({
  CourierPickerModal: ({ onConfirm }: { onConfirm: (value: string[]) => void }) => (
    <button type="button" onClick={() => { mocks.courierModalConfirm(); onConfirm(["jne:reg"]); }}>
      CourierPickerModal
    </button>
  ),
}));

vi.mock("../../hooks/useBiteshipCouriers", () => ({
  useBiteshipCouriers: () => ({
    couriers: [{ key: "jne:reg", companyCode: "jne", companyLabel: "JNE", serviceCode: "reg", serviceLabel: "Regular", description: "Regular service" }],
    loading: false,
    error: null,
    isFallback: false,
  }),
}));

vi.mock("antd", () => {
  const FormComponent = ({
    children,
    onFinish,
    onValuesChange,
  }: {
    children: React.ReactNode;
    onFinish?: (values: Record<string, unknown>) => void | Promise<unknown>;
    onValuesChange?: (changed: Record<string, unknown>, all: Record<string, unknown>) => void;
  }) => {
    mocks.lastOnValuesChange.current = onValuesChange;

    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const values = mocks.nextSubmitValues.current ?? { password: "secret123", confirmPassword: "different" };
          void Promise.resolve(onFinish?.(values)).catch(() => undefined);
        }}
      >
        {children}
      </form>
    );
  };

  const Form = Object.assign(FormComponent, {
    Item: ({ children, label, help }: { children: React.ReactNode; label?: React.ReactNode; help?: React.ReactNode }) => <div><div>{label}</div>{children}{help ? <div>{help}</div> : null}</div>,
    useForm: () => [
      {
        resetFields: mocks.resetFields,
        setFieldValue: mocks.setFieldValue,
        setFieldsValue: mocks.setFieldsValue,
        setFields: mocks.setFields,
        getFieldValue: mocks.getFieldValue,
      },
    ],
  });

  const Input = Object.assign(
    ({
      "aria-label": ariaLabel,
      onBlur,
      onChange,
      placeholder,
      readOnly,
      value,
      type,
    }: {
      "aria-label"?: string;
      onBlur?: (event: React.FocusEvent<HTMLInputElement>) => void;
      onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
      placeholder?: string;
      readOnly?: boolean;
      value?: string;
      type?: string;
    }) => (
      <input
        aria-label={ariaLabel ?? placeholder ?? "input"}
        onBlur={onBlur}
        onChange={onChange}
        placeholder={placeholder}
        readOnly={readOnly}
        value={value}
        type={type}
      />
    ),
    {
      TextArea: ({
        "aria-label": ariaLabel,
        placeholder,
        rows,
        maxLength,
        showCount,
        disabled,
        value,
        onChange,
        style,
      }: {
        "aria-label"?: string;
        placeholder?: string;
        rows?: number;
        maxLength?: number;
        showCount?: boolean;
        disabled?: boolean;
        value?: string;
        onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
        style?: React.CSSProperties;
      }) => (
        <textarea
          aria-label={ariaLabel ?? placeholder ?? "textarea"}
          data-maxlength={maxLength}
          data-rows={rows}
          data-showcount={showCount ? "true" : "false"}
          data-disabled={disabled ? "true" : "false"}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          style={style}
        />
      ),
      Password: ({
        "aria-label": ariaLabel,
        placeholder,
        value,
        onChange,
        visibilityToggle,
      }: {
        "aria-label"?: string;
        placeholder?: string;
        value?: string;
        onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
        visibilityToggle?: boolean;
      }) => (
        <span>
          <input aria-label={ariaLabel ?? placeholder ?? "password"} placeholder={placeholder} value={value} onChange={onChange} type="password" />
          {visibilityToggle === false ? null : <button type="button" aria-label="password visibility toggle">show</button>}
        </span>
      ),
    }
  );

  const Typography = {
    Title: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
    Text: ({ children, type }: { children: React.ReactNode; type?: string }) => <span data-type={type}>{children}</span>,
    Paragraph: ({ children, ellipsis, style }: { children: React.ReactNode; ellipsis?: { rows: number; expandable: boolean }; style?: React.CSSProperties }) => <p data-ellipsis={ellipsis ? "true" : "false"} style={style}>{children}</p>,
  };

  const theme = {
    useToken: () => ({
      token: {
        colorBgContainer: "#ffffff",
        colorFillAlter: "#fafafa",
        colorBorder: "#d9d9d9",
        colorBorderSecondary: "#d9d9d9",
        borderRadius: 6,
        colorTextTertiary: "#8c8c8c",
        colorTextSecondary: "#595959",
        colorText: "#000000",
        colorPrimary: "#1890ff",
        colorPrimaryBg: "#e6f7ff",
      },
    }),
  };

  const SpaceBase = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;
  const Space = Object.assign(SpaceBase, {
    Compact: ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => <div style={style}>{children}</div>,
  });

  return {
    Form,
    Input,
    InputNumber: ({ value, onChange }: { value?: number | null; onChange?: (value: number | null) => void }) => (
      <input
        aria-label="InputNumber"
        value={value ?? ""}
        onChange={(event) => onChange?.(event.currentTarget.value === "" ? null : Number(event.currentTarget.value))}
      />
    ),
    Select: ({
      "aria-label": ariaLabel,
      disabled,
      onChange,
      options = [],
      placeholder,
      value,
    }: {
      "aria-label"?: string;
      disabled?: boolean;
      onChange?: (value: string | number | boolean) => void;
      options?: Array<{ label: React.ReactNode; value: string | number | boolean }>;
      placeholder?: string;
      value?: string | number | boolean;
    }) => (
      <select
        aria-label={ariaLabel ?? placeholder ?? "select"}
        disabled={disabled}
        value={value === undefined || value === null ? "" : String(value)}
        onChange={(event) => {
          const selectedOption = options.find((option) => String(option.value) === event.currentTarget.value);
          onChange?.(selectedOption?.value ?? event.currentTarget.value);
        }}
      >
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((option) => (
          <option key={String(option.value)} value={String(option.value)}>
            {option.label}
          </option>
        ))}
      </select>
    ),
    Switch: ({ checked, onChange, checkedChildren, unCheckedChildren, "aria-label": ariaLabel }: { checked?: boolean; onChange?: (checked: boolean) => void; checkedChildren?: React.ReactNode; unCheckedChildren?: React.ReactNode; "aria-label"?: string }) => (
      <button type="button" role="switch" aria-checked={checked ? "true" : "false"} aria-label={ariaLabel ?? "switch"} onClick={() => onChange?.(!checked)}>
        {checked ? checkedChildren : unCheckedChildren}
      </button>
    ),
    Tabs: ({
      activeKey,
      defaultActiveKey,
      items,
      onChange,
    }: {
      activeKey?: string;
      defaultActiveKey?: string;
      items?: Array<{ key?: string; label: React.ReactNode; children: React.ReactNode }>;
      onChange?: (activeKey: string) => void;
    }) => {
      const selectedKey = activeKey ?? defaultActiveKey ?? items?.[0]?.key;

      return (
        <div>
          <div role="tablist">
            {items?.map((item) => {
              const itemKey = item.key ?? String(item.label);

              return (
                <button
                  key={itemKey}
                  role="tab"
                  aria-selected={itemKey === selectedKey ? "true" : "false"}
                  type="button"
                  onClick={() => onChange?.(itemKey)}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
          {items?.map((item) => <div key={item.key ?? String(item.label)}>{item.children}</div>)}
        </div>
      );
    },
    Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Empty: ({ description }: { description?: React.ReactNode }) => <div>{description}</div>,
    Spin: ({ tip }: { tip?: React.ReactNode }) => <div>{tip}</div>,

    Collapse: Object.assign(
      ({ items }: { items?: Array<{ key: string; label: React.ReactNode; children: React.ReactNode }> }) => (
        <div>{items?.map((item) => <div key={item.key}><div>{item.label}</div><div>{item.children}</div></div>)}</div>
      ),
      {
        Panel: ({ children, header }: { children: React.ReactNode; header?: React.ReactNode }) => (
          <div><div>{header}</div><div>{children}</div></div>
        )
      }
    ),
    Alert: ({ message, description }: { message: React.ReactNode; description?: React.ReactNode }) => <div role="alert">{message}{description}</div>,
    Descriptions: Object.assign(
      ({ children }: { children: React.ReactNode }) => <dl>{children}</dl>,
      {
        Item: ({ children, label }: { children: React.ReactNode; label?: React.ReactNode }) => (
          <div>
            <dt>{label}</dt>
            <dd>{children}</dd>
          </div>
        ),
      }
    ),
    List: Object.assign(
      ({ dataSource = [], renderItem, locale }: { dataSource?: Array<{ id: string }>; renderItem?: (item: { id: string }, index: number) => React.ReactNode; locale?: { emptyText?: React.ReactNode } }) => (
        <div>{dataSource.length > 0 ? dataSource.map((item, index) => <div key={item.id}>{renderItem?.(item, index)}</div>) : locale?.emptyText}</div>
      ),
      {
        Item: Object.assign(
          ({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode[] }) => <div>{children}{actions}</div>,
          { Meta: ({ title, description }: { title: React.ReactNode; description?: React.ReactNode }) => <div>{title}{description}</div> }
        ),
      }
    ),
    Row: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Col: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Upload: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Typography,
    theme,
    Button: ({ children, onClick, htmlType, type, size, icon, disabled }: { children?: React.ReactNode; onClick?: () => void; htmlType?: "submit" | "button"; type?: string; size?: string; icon?: React.ReactNode; disabled?: boolean }) => <button type={htmlType ?? "button"} data-type={type} data-size={size} disabled={disabled} onClick={onClick}>{icon}{children}</button>,
    Space,
    Tag: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
    Divider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Modal: Object.assign(
      ({ children, open, title, footer, onOk, onCancel, okText = "OK", cancelText = "Cancel" }: { children: React.ReactNode; open?: boolean; title?: React.ReactNode; footer?: React.ReactNode; onOk?: () => void; onCancel?: () => void; okText?: React.ReactNode; cancelText?: React.ReactNode }) => open ? (
        <div role="dialog">
          <div>{title}</div>
          {children}
          {footer ?? (
            <div>
              <button type="button" onClick={onCancel}>{cancelText}</button>
              <button type="button" onClick={onOk}>{okText}</button>
            </div>
          )}
        </div>
      ) : null,
      { confirm: vi.fn() }
    ),
    message: {
      error: mocks.messageError,
      success: mocks.messageSuccess,
      useMessage: () => [{ error: mocks.messageError, success: mocks.messageSuccess }, null],
    },
  };
});

vi.mock("@ant-design/icons", () => ({
  LockOutlined: () => <span>lock</span>,
  SettingOutlined: () => <span>setting</span>,
  ExpandOutlined: () => <span>expand</span>,
  EditOutlined: () => <span>edit</span>,
  FileTextOutlined: () => <span>file-text</span>,
  InfoCircleOutlined: () => <span>info</span>,
  MailOutlined: () => <span>mail</span>,
  UserAddOutlined: () => <span>user-add</span>,
  SecurityScanOutlined: () => <span>security-scan</span>,
}));

vi.mock("../../providers/supabase-client", () => ({
  supabaseClient: {
    auth: {
      refreshSession: vi.fn(() => Promise.resolve({ data: {}, error: null })),
      mfa: {
        enroll: vi.fn(() => Promise.resolve({ data: null, error: null })),
        challenge: vi.fn(() => Promise.resolve({ data: null, error: null })),
        verify: vi.fn(() => Promise.resolve({ data: null, error: null })),
        listFactors: mocks.mfaListFactors,
        unenroll: vi.fn(() => Promise.resolve({ data: null, error: null })),
        getAuthenticatorAssuranceLevel: vi.fn(() => Promise.resolve({ data: { currentLevel: "aal2", nextLevel: "aal2" }, error: null })),
      },
    },
    from: mocks.supabaseFrom,
    functions: {
      invoke: mocks.functionsInvoke,
    },
    storage: {
      from: () => ({ remove: vi.fn(() => Promise.resolve({ error: null })) }),
    },
  },
}));

describe("form pages", () => {
  function renderWithQueryClient(ui: React.ReactElement) {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    return render(ui, {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    });
  }

  beforeEach(() => {
    mocks.setLocale("id");
    mocks.translate.mockClear();
    mocks.useForm.mockReset();
    mocks.useSelect.mockClear();
    mocks.useGetIdentity.mockReset();
    mocks.invalidate.mockReset();
    mocks.updatePassword.mockReset();
    mocks.messageError.mockReset();
    mocks.messageSuccess.mockReset();
    mocks.setFieldValue.mockReset();
    mocks.setFieldsValue.mockReset();
    mocks.setFields.mockReset();
    mocks.resetFields.mockReset();
    mocks.getFieldValue.mockReset();
    mocks.getFieldValue.mockImplementation((field: string) => (field === "enabled_couriers" ? "jne:reg,grab:instant" : undefined));
    mocks.courierModalConfirm.mockReset();
    mocks.duplicateSkuRows.current = [];
    mocks.nextSubmitValues.current = undefined;
    mocks.lastOnValuesChange.current = undefined;
    mocks.productQueries.length = 0;
    mocks.productImagesInsert.mockClear();
    mocks.mfaListFactors.mockClear();
    mocks.functionsInvoke.mockReset();
    vi.mocked(Modal.confirm).mockReset();
    mocks.functionsInvoke.mockImplementation((_name: string, { body }: { body: Record<string, unknown> }) => {
      if (body.action === "summary") {
        const summaryRows = [
          {
            key_name: "midtrans.server_key",
            display_name: "Midtrans Server Key",
            description: "Server credential",
            value_kind: "secret",
            is_secret: true,
            is_required: true,
            is_runtime_required: true,
            version_id: "version-secret",
            version_number: 2,
            status: "active",
            masked_value: "SB-Mid-****7890",
            value_fingerprint: "fingerprint-secret",
            non_secret_value: "PLAINTEXT_SENTINEL_DO_NOT_RENDER",
            updated_by: "admin-1",
            updated_at: "2026-05-19T09:00:00Z",
          },
          {
            key_name: "midtrans.is_production",
            display_name: "Midtrans Production Mode",
            description: "Payment mode",
            value_kind: "boolean",
            is_secret: false,
            is_required: true,
            is_runtime_required: true,
            version_id: "version-mode",
            version_number: 1,
            status: "active",
            masked_value: null,
            value_fingerprint: null,
            non_secret_value: false,
            updated_by: "admin-1",
            updated_at: "2026-05-19T09:00:00Z",
          },
          {
            key_name: "biteship.api_key",
            display_name: "Biteship API Key",
            description: "Biteship credential",
            value_kind: "secret",
            is_secret: true,
            is_required: true,
            is_runtime_required: true,
            version_id: "version-biteship-secret",
            version_number: 4,
            status: "active",
            masked_value: "BS-****9999",
            value_fingerprint: "fingerprint-biteship",
            non_secret_value: "PLAINTEXT_SENTINEL_DO_NOT_RENDER",
            updated_by: "admin-1",
            updated_at: "2026-05-19T09:00:00Z",
          },
          { key_name: "biteship.enabled_couriers", display_name: "Active Couriers", description: "Courier services", value_kind: "text_array", is_secret: false, is_required: true, is_runtime_required: true, version_id: "version-couriers", version_number: 1, status: "active", masked_value: null, value_fingerprint: null, non_secret_value: ["jne:reg", "grab:instant"], updated_by: "admin-1", updated_at: "2026-05-19T09:00:00Z" },
          { key_name: "biteship.origin_postal_code", display_name: "Postal Code", description: "Origin postal code", value_kind: "string", is_secret: false, is_required: true, is_runtime_required: true, version_id: "version-postal", version_number: 1, status: "active", masked_value: null, value_fingerprint: null, non_secret_value: "12110", updated_by: "admin-1", updated_at: "2026-05-19T09:00:00Z" },
          { key_name: "biteship.origin_area_id", display_name: "Origin Area", description: "Biteship area", value_kind: "string", is_secret: false, is_required: true, is_runtime_required: true, version_id: "version-area", version_number: 1, status: "active", masked_value: null, value_fingerprint: null, non_secret_value: "area-existing", updated_by: "admin-1", updated_at: "2026-05-19T09:00:00Z" },
          { key_name: "biteship.origin_latitude", display_name: "Latitude", description: "Origin latitude", value_kind: "number", is_secret: false, is_required: true, is_runtime_required: true, version_id: "version-lat", version_number: 1, status: "active", masked_value: null, value_fingerprint: null, non_secret_value: -6.2, updated_by: "admin-1", updated_at: "2026-05-19T09:00:00Z" },
          { key_name: "biteship.origin_longitude", display_name: "Longitude", description: "Origin longitude", value_kind: "number", is_secret: false, is_required: true, is_runtime_required: true, version_id: "version-lng", version_number: 1, status: "active", masked_value: null, value_fingerprint: null, non_secret_value: 106.8, updated_by: "admin-1", updated_at: "2026-05-19T09:00:00Z" },
          { key_name: "shop.shipper_name", display_name: "Shipper Name", description: "Sender name", value_kind: "string", is_secret: false, is_required: true, is_runtime_required: true, version_id: "version-shipper-name", version_number: 1, status: "active", masked_value: null, value_fingerprint: null, non_secret_value: "Apotek Sehat", updated_by: "admin-1", updated_at: "2026-05-19T09:00:00Z" },
          { key_name: "shop.shipper_phone", display_name: "Shipper Phone", description: "Sender phone", value_kind: "string", is_secret: false, is_required: true, is_runtime_required: true, version_id: "version-shipper-phone", version_number: 1, status: "active", masked_value: null, value_fingerprint: null, non_secret_value: "08123456789", updated_by: "admin-1", updated_at: "2026-05-19T09:00:00Z" },
          { key_name: "shop.shipper_email", display_name: "Shipper Email", description: "Sender email", value_kind: "string", is_secret: false, is_required: true, is_runtime_required: true, version_id: "version-shipper-email", version_number: 1, status: "active", masked_value: null, value_fingerprint: null, non_secret_value: "shipper@example.test", updated_by: "admin-1", updated_at: "2026-05-19T09:00:00Z" },
          { key_name: "shop.address", display_name: "Store Address", description: "Sender address", value_kind: "string", is_secret: false, is_required: true, is_runtime_required: true, version_id: "version-address", version_number: 1, status: "active", masked_value: null, value_fingerprint: null, non_secret_value: "Jl. Sehat 1", updated_by: "admin-1", updated_at: "2026-05-19T09:00:00Z" },
          { key_name: "shop.organization", display_name: "Organization", description: "Sender organization", value_kind: "string", is_secret: false, is_required: true, is_runtime_required: true, version_id: "version-organization", version_number: 1, status: "active", masked_value: null, value_fingerprint: null, non_secret_value: "PT Apotek Sehat", updated_by: "admin-1", updated_at: "2026-05-19T09:00:00Z" },
          { key_name: "push.expo_access_token", display_name: "Expo Push Token", description: "Push credential", value_kind: "secret", is_secret: true, is_required: false, is_runtime_required: false, version_id: "version-push", version_number: 1, status: "active", masked_value: "Expo****", value_fingerprint: "fingerprint-push", non_secret_value: null, updated_by: "admin-1", updated_at: "2026-05-19T09:00:00Z" },
          { key_name: "cors.allowed_origins", display_name: "Allowed Origins", description: "CORS origins", value_kind: "text_array", is_secret: false, is_required: false, is_runtime_required: false, version_id: "version-cors", version_number: 1, status: "active", masked_value: null, value_fingerprint: null, non_secret_value: ["https://admin.example.test"], updated_by: "admin-1", updated_at: "2026-05-19T09:00:00Z" },
        ];
        const requestedKeys = Array.isArray(body.keys) ? body.keys : undefined;
        const rows = requestedKeys ? summaryRows.filter((row) => requestedKeys.includes(row.key_name)) : summaryRows;
        const isShippingSummary = requestedKeys?.some((key) => typeof key === "string" && key.startsWith("biteship."));
        return Promise.resolve({
          data: {
            data: {
              rows,
              ...(isShippingSummary
                ? {
                    health: {
                      biteship: {
                        provider: "biteship",
                        apiKeyConfigured: true,
                        apiKeySource: "runtime_config",
                        requiredConfigComplete: true,
                        missingKeys: [],
                        legacyDrift: {
                          enabledCouriers: false,
                          originArea: false,
                          originPostalCode: false,
                          originCoordinates: false,
                        },
                        diagnostics: [],
                      },
                    },
                  }
                : {}),
            },
          },
          error: null,
        });
      }

      if (body.action === "audit") {
        const auditRows = [
          {
            id: "audit-1",
            key_name: "midtrans.server_key",
            version_id: "version-secret",
            action: "secret_rotated",
            actor_id: "admin-1",
            actor_role: "admin",
            source: "admin_gateway",
            request_id: "request-1",
            reason: "scheduled rotation",
            old_version_number: 1,
            new_version_number: 2,
            old_masked_value: "SB-Mid-****1234",
            new_masked_value: "SB-Mid-****7890",
            value_fingerprint: "fingerprint-secret",
            metadata: { note: "PLAINTEXT_SENTINEL_DO_NOT_RENDER" },
            created_at: "2026-05-19T10:00:00Z",
          },
          {
            id: "audit-runtime-read",
            key_name: "midtrans.server_key",
            version_id: "version-secret",
            action: "runtime_read",
            actor_id: null,
            actor_role: "service_role",
            source: "edge_function",
            request_id: "request-runtime-read",
            reason: null,
            old_version_number: null,
            new_version_number: 2,
            old_masked_value: null,
            new_masked_value: "SB-Mid-****7890",
            value_fingerprint: "fingerprint-secret",
            metadata: { note: "PLAINTEXT_SENTINEL_DO_NOT_RENDER" },
            created_at: "2026-05-19T11:00:00Z",
          },
          {
            id: "audit-push-token",
            key_name: "push.expo_access_token",
            version_id: "version-push",
            action: "secret_rotated",
            actor_id: "admin-technical",
            actor_role: "admin",
            source: "admin_gateway",
            request_id: "request-push-token",
            reason: "technical rotation",
            old_version_number: 1,
            new_version_number: 2,
            old_masked_value: "Expo****1111",
            new_masked_value: "Expo****2222",
            value_fingerprint: "fingerprint-push",
            metadata: { note: "PLAINTEXT_SENTINEL_DO_NOT_RENDER" },
            created_at: "2026-05-19T12:00:00Z",
          },
          {
            id: "audit-cors-origins",
            key_name: "cors.allowed_origins",
            version_id: "version-cors",
            action: "value_updated",
            actor_id: "admin-technical",
            actor_role: "admin",
            source: "admin_gateway",
            request_id: "request-cors-origins",
            reason: "technical CORS update",
            old_version_number: 1,
            new_version_number: 2,
            old_masked_value: "https://old-admin.example.test",
            new_masked_value: "https://admin.example.test",
            value_fingerprint: null,
            metadata: { note: "PLAINTEXT_SENTINEL_DO_NOT_RENDER" },
            created_at: "2026-05-19T13:00:00Z",
          },
        ];
        const requestedAuditKey = typeof body.key === "string" ? body.key : undefined;

        return Promise.resolve({
          data: {
            data: requestedAuditKey ? auditRows.filter((row) => row.key_name === requestedAuditKey) : auditRows,
          },
          error: null,
        });
      }

      return Promise.resolve({ data: { data: { ok: true } }, error: null });
    });
    mocks.supabaseFrom.mockClear();
  });

  it("renders product create and edit forms with image upload wiring", () => {
    mocks.useForm
      .mockReturnValueOnce({ formProps: {}, saveButtonProps: {}, form: { setFieldValue: mocks.setFieldValue, setFields: mocks.setFields } })
      .mockReturnValueOnce({
        formProps: {},
        saveButtonProps: {},
        form: { setFieldValue: mocks.setFieldValue, setFieldsValue: mocks.setFieldsValue, setFields: mocks.setFields },
        query: { data: { data: { id: "prod-1", product_images: [{ id: "img-1", url: "https://example.com/one.png", sort_order: 0 }] } } },
      });

    const { rerender } = render(<ProductCreate />);
    expect(screen.getByText("ProductImageUpload")).not.toBeNull();
    expect(screen.getByText("products.fields.sku")).not.toBeNull();

    rerender(<ProductEdit />);
    expect(mocks.setFieldsValue).toHaveBeenCalledWith({ images: ["https://example.com/one.png"] });
    expect(screen.getAllByText("products.fields.sku").length).toBeGreaterThan(0);
  });

  it("auto-generates product create SKU while SKU is untouched", () => {
    mocks.useForm.mockReturnValue({
      formProps: {},
      saveButtonProps: {},
      form: { setFieldValue: mocks.setFieldValue, setFields: mocks.setFields },
    });

    render(<ProductCreate />);

    mocks.lastOnValuesChange.current?.(
      { name: "Vitamin C 1000" },
      { name: "Vitamin C 1000", category_id: "cat-1" }
    );

    expect(mocks.setFieldValue).toHaveBeenCalledWith("slug", "vitamin-c-1000");
    expect(mocks.setFieldValue).toHaveBeenCalledWith(
      "sku",
      expect.stringMatching(/^CATEGORY-VITAMIN-C-1000-[A-Z0-9]{4}$/)
    );
  });

  it("stops product create SKU auto-generation after the SKU field is touched", () => {
    mocks.useForm.mockReturnValue({
      formProps: {},
      saveButtonProps: {},
      form: { setFieldValue: mocks.setFieldValue, setFields: mocks.setFields },
    });

    render(<ProductCreate />);

    mocks.lastOnValuesChange.current?.({ sku: "manual sku" }, { sku: "manual sku" });
    mocks.setFieldValue.mockClear();
    mocks.lastOnValuesChange.current?.(
      { name: "Vitamin C 1000", category_id: "cat-1" },
      { name: "Vitamin C 1000", category_id: "cat-1", sku: "manual sku" }
    );

    expect(mocks.setFieldValue).toHaveBeenCalledWith("slug", "vitamin-c-1000");
    expect(mocks.setFieldValue).not.toHaveBeenCalledWith("sku", expect.any(String));
  });

  it("normalizes manual product create SKU on blur", () => {
    mocks.useForm.mockReturnValue({
      formProps: {},
      saveButtonProps: {},
      form: { setFieldValue: mocks.setFieldValue, setFields: mocks.setFields },
    });

    render(<ProductCreate />);

    fireEvent.blur(screen.getAllByLabelText("input")[1], { target: { value: " manual sku 1 " } });

    expect(mocks.setFieldValue).toHaveBeenCalledWith("sku", "MANUAL-SKU-1");
  });

  it("normalizes manual product create SKU before submit", async () => {
    const onFinish = vi.fn(() => Promise.resolve({ data: { id: "prod-1" } }));
    mocks.nextSubmitValues.current = {
      name: "Vitamin C",
      sku: "manual sku 1",
      slug: "vitamin-c",
      images: [],
    };
    mocks.useForm.mockReturnValue({
      formProps: { onFinish },
      saveButtonProps: {},
      form: { setFieldValue: mocks.setFieldValue, setFields: mocks.setFields },
    });

    const { container } = render(<ProductCreate />);
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    await waitFor(() => expect(onFinish).toHaveBeenCalledWith(expect.objectContaining({ sku: "MANUAL-SKU-1" })));
    expect(mocks.supabaseFrom).toHaveBeenCalledWith("admin_products");
    expect(mocks.productQueries[0].select).toHaveBeenCalledWith("id");
    expect(mocks.productQueries[0].eq).toHaveBeenCalledWith("sku", "MANUAL-SKU-1");
  });

  it("sets a field error and prevents submit for duplicate product create SKU", async () => {
    const onFinish = vi.fn();
    mocks.duplicateSkuRows.current = [{ id: "prod-2" }];
    mocks.nextSubmitValues.current = {
      name: "Vitamin C",
      sku: "duplicate sku",
      slug: "vitamin-c",
      images: [],
    };
    mocks.useForm.mockReturnValue({
      formProps: { onFinish },
      saveButtonProps: {},
      form: { setFieldValue: mocks.setFieldValue, setFields: mocks.setFields },
    });

    const { container } = render(<ProductCreate />);
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    await waitFor(() => expect(mocks.setFields).toHaveBeenCalledWith([
      { name: "sku", errors: ["This SKU is already used by another product."] },
    ]));
    expect(mocks.supabaseFrom).toHaveBeenCalledWith("admin_products");
    expect(onFinish).not.toHaveBeenCalled();
  });

  it("sets a field error and prevents submit for invalid product create SKU", async () => {
    const onFinish = vi.fn();
    mocks.nextSubmitValues.current = {
      name: "Vitamin C",
      sku: "bad",
      slug: "vitamin-c",
      images: [],
    };
    mocks.useForm.mockReturnValue({
      formProps: { onFinish },
      saveButtonProps: {},
      form: { setFieldValue: mocks.setFieldValue, setFields: mocks.setFields },
    });

    const { container } = render(<ProductCreate />);
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    await waitFor(() => expect(mocks.setFields).toHaveBeenCalledWith([
      { name: "sku", errors: ["SKU must be 4-50 characters using uppercase letters, numbers, and hyphens."] },
    ]));
    expect(mocks.supabaseFrom).not.toHaveBeenCalledWith("admin_products");
    expect(onFinish).not.toHaveBeenCalled();
  });

  it("checks duplicate product edit SKU through admin_products excluding the current product", async () => {
    const onFinish = vi.fn(() => Promise.resolve({ data: { id: "prod-1" } }));
    mocks.nextSubmitValues.current = {
      name: "Vitamin C",
      sku: "manual sku 1",
      slug: "vitamin-c",
      images: [],
    };
    mocks.useForm.mockReturnValue({
      formProps: { onFinish },
      saveButtonProps: {},
      form: {
        setFieldValue: mocks.setFieldValue,
        setFieldsValue: mocks.setFieldsValue,
        setFields: mocks.setFields,
      },
      query: { data: { data: { id: "prod-1", product_images: [] } } },
    });

    const { container } = render(<ProductEdit />);
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    await waitFor(() => expect(onFinish).toHaveBeenCalledWith(expect.objectContaining({ sku: "MANUAL-SKU-1" })));
    expect(mocks.supabaseFrom).toHaveBeenCalledWith("admin_products");
    expect(mocks.productQueries[0].select).toHaveBeenCalledWith("id");
    expect(mocks.productQueries[0].eq).toHaveBeenCalledWith("sku", "MANUAL-SKU-1");
    expect(mocks.productQueries[0].neq).toHaveBeenCalledWith("id", "prod-1");
  });

  it("does not overwrite product edit SKU when name or category changes", () => {
    mocks.useForm.mockReturnValue({
      formProps: {},
      saveButtonProps: {},
      form: {
        setFieldValue: mocks.setFieldValue,
        setFieldsValue: mocks.setFieldsValue,
        setFields: mocks.setFields,
      },
      query: { data: { data: { id: "prod-1", sku: "EXISTING-SKU", product_images: [] } } },
    });

    render(<ProductEdit />);
    mocks.setFieldValue.mockClear();

    mocks.lastOnValuesChange.current?.(
      { name: "Vitamin C 1000", category_id: "cat-1" },
      { name: "Vitamin C 1000", category_id: "cat-1", sku: "EXISTING-SKU" }
    );

    expect(mocks.setFieldValue).toHaveBeenCalledWith("slug", "vitamin-c-1000");
    expect(mocks.setFieldValue).not.toHaveBeenCalledWith("sku", expect.any(String));
  });

  it("normalizes manual product edit SKU on blur", () => {
    mocks.useForm.mockReturnValue({
      formProps: {},
      saveButtonProps: {},
      form: {
        setFieldValue: mocks.setFieldValue,
        setFieldsValue: mocks.setFieldsValue,
        setFields: mocks.setFields,
      },
      query: { data: { data: { id: "prod-1", product_images: [] } } },
    });

    render(<ProductEdit />);

    fireEvent.blur(screen.getAllByLabelText("input")[1], { target: { value: " edited sku 2 " } });

    expect(mocks.setFieldValue).toHaveBeenCalledWith("sku", "EDITED-SKU-2");
  });

  it("rejects duplicate product edit SKU from another product", async () => {
    const onFinish = vi.fn();
    mocks.duplicateSkuRows.current = [{ id: "prod-2" }];
    mocks.nextSubmitValues.current = {
      name: "Vitamin C",
      sku: "other product sku",
      slug: "vitamin-c",
      images: [],
    };
    mocks.useForm.mockReturnValue({
      formProps: { onFinish },
      saveButtonProps: {},
      form: {
        setFieldValue: mocks.setFieldValue,
        setFieldsValue: mocks.setFieldsValue,
        setFields: mocks.setFields,
      },
      query: { data: { data: { id: "prod-1", product_images: [] } } },
    });

    const { container } = render(<ProductEdit />);
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    await waitFor(() => expect(mocks.setFields).toHaveBeenCalledWith([
      { name: "sku", errors: ["This SKU is already used by another product."] },
    ]));
    expect(mocks.productQueries[0].neq).toHaveBeenCalledWith("id", "prod-1");
    expect(onFinish).not.toHaveBeenCalled();
  });

  it("renders product description with edit modal flow", () => {
    mocks.useForm
      .mockReturnValueOnce({ formProps: {}, saveButtonProps: {}, form: { setFieldValue: mocks.setFieldValue, setFields: mocks.setFields } })
      .mockReturnValueOnce({
        formProps: {},
        saveButtonProps: {},
        form: { setFieldValue: mocks.setFieldValue, setFieldsValue: mocks.setFieldsValue, setFields: mocks.setFields },
        query: { data: { data: { product_images: [] } } },
      });

    const { rerender } = render(<ProductCreate />);
    
    const previewCard = screen.getByRole("button", { name: /file-text.*No description added.*edit.*Add description/i });
    expect(previewCard).not.toBeNull();
    
    fireEvent.click(previewCard);
    
    const dialog = screen.getByRole("dialog");
    expect(dialog).not.toBeNull();
    
    const cancelButton = screen.getByRole("button", { name: "Cancel" });
    fireEvent.click(cancelButton);
    
    expect(screen.queryByRole("dialog")).toBeNull();
    
    fireEvent.click(previewCard);
    
    expect(screen.getByRole("dialog")).not.toBeNull();
    
    const saveButton = screen.getByRole("button", { name: "Save" });
    fireEvent.click(saveButton);
    
    expect(screen.queryByRole("dialog")).toBeNull();

    rerender(<ProductEdit />);
    const previewCardInEdit = screen.getByRole("button", { name: /file-text.*No description added.*edit.*Add description/i });
    expect(previewCardInEdit).not.toBeNull();
  });

  it("renders category create and edit forms with logo upload", () => {
    mocks.useForm
      .mockReturnValueOnce({ formProps: {}, saveButtonProps: {}, form: { setFieldValue: mocks.setFieldValue } })
      .mockReturnValueOnce({ formProps: {}, saveButtonProps: {}, form: { setFieldValue: mocks.setFieldValue } });

    const { rerender } = render(<CategoryCreate />);
    expect(screen.getByText("CategoryLogoUpload")).not.toBeNull();

    rerender(<CategoryEdit />);
    expect(screen.getAllByText("CategoryLogoUpload").length).toBeGreaterThan(0);
  });

  it("renders domain Settings tabs with localized labels", async () => {
    mocks.useForm.mockReturnValue({
      formProps: {},
      saveButtonProps: {},
      form: {
        setFieldValue: mocks.setFieldValue,
        getFieldValue: mocks.getFieldValue,
      },
    });

    renderWithQueryClient(<Settings />);

    expect(screen.getByRole("tab", { name: "Profil Toko" })).not.toBeNull();
    expect(screen.getByRole("tab", { name: "Pengaturan Pengiriman" })).not.toBeNull();
    expect(screen.getByRole("tab", { name: "Pengaturan Pembayaran" })).not.toBeNull();
    expect(screen.getByRole("tab", { name: "Lanjutan" })).not.toBeNull();
    expect(screen.getByRole("tab", { name: "Audit Konfigurasi" })).not.toBeNull();
    expect(screen.queryByRole("tab", { name: "Konfigurasi Integrasi" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Integration Config" })).toBeNull();

    expect(await screen.findByRole("region", { name: "Pengaturan Pengiriman" })).not.toBeNull();
    expect(await screen.findByRole("region", { name: "Pengaturan Pembayaran" })).not.toBeNull();
    expect(await screen.findByRole("region", { name: "Lanjutan" })).not.toBeNull();
    expect(await screen.findByRole("region", { name: "Audit Konfigurasi" })).not.toBeNull();
  });

  it("scopes the public settings save affordance to the Store Profile tab", async () => {
    mocks.useForm.mockReturnValue({
      formProps: {},
      saveButtonProps: { disabled: false },
      form: {
        setFieldValue: mocks.setFieldValue,
        getFieldValue: mocks.getFieldValue,
      },
    });

    renderWithQueryClient(<Settings />);

    const storeProfileSave = screen.getByRole("button", { name: "Store Profile Save" }) as HTMLButtonElement;
    expect(storeProfileSave.disabled).toBe(false);
    expect(storeProfileSave.style.display).toBe("");

    fireEvent.click(screen.getByRole("tab", { name: "Pengaturan Pengiriman" }));
    expect(storeProfileSave.disabled).toBe(true);
    expect(storeProfileSave.style.display).toBe("none");

    fireEvent.click(screen.getByRole("tab", { name: "Pengaturan Pembayaran" }));
    expect(storeProfileSave.disabled).toBe(true);
    expect(storeProfileSave.style.display).toBe("none");

    fireEvent.click(screen.getByRole("tab", { name: "Lanjutan" }));
    expect(storeProfileSave.disabled).toBe(true);
    expect(storeProfileSave.style.display).toBe("none");

    fireEvent.click(screen.getByRole("tab", { name: "Profil Toko" }));
    expect(storeProfileSave.disabled).toBe(false);
    expect(storeProfileSave.style.display).toBe("");

    expect(await screen.findByRole("region", { name: "Pengaturan Pengiriman" })).not.toBeNull();
    expect(await screen.findByRole("region", { name: "Pengaturan Pembayaran" })).not.toBeNull();
    expect(await screen.findByRole("region", { name: "Lanjutan" })).not.toBeNull();
  });

  it("renders settings page with shipping picker controls outside the public settings form path", async () => {
    mocks.useForm.mockReturnValue({
      formProps: {},
      saveButtonProps: {},
      form: {
        setFieldValue: mocks.setFieldValue,
        getFieldValue: mocks.getFieldValue,
      },
    });

    renderWithQueryClient(<Settings />);

    const shippingPanel = await screen.findByRole("region", { name: "Pengaturan Pengiriman" });
    expect(await within(shippingPanel).findByText("BiteshipAreaSearch")).not.toBeNull();
    expect(within(shippingPanel).getByText("MapLocationPicker")).not.toBeNull();
    fireEvent.click(within(shippingPanel).getByRole("button", { name: "CourierPickerModal" }));
    expect(mocks.courierModalConfirm).toHaveBeenCalledTimes(1);
    expect(mocks.setFieldValue).not.toHaveBeenCalledWith("enabled_couriers", expect.anything());
  });

  it("payment settings renders sanitized Midtrans controls and requests only payment summary keys", async () => {
    mocks.useForm.mockReturnValue({
      formProps: {},
      saveButtonProps: {},
      form: {
        setFieldValue: mocks.setFieldValue,
        getFieldValue: mocks.getFieldValue,
      },
    });

    renderWithQueryClient(<Settings />);

    const paymentPanel = await screen.findByRole("region", { name: "Pengaturan Pembayaran" });
    expect(await within(paymentPanel).findByText("Kunci Server Midtrans")).not.toBeNull();
    expect(within(paymentPanel).getByText("Mode Pembayaran Midtrans")).not.toBeNull();
    const serverKeyInput = within(paymentPanel).getByLabelText("Kunci Server Midtrans") as HTMLInputElement;
    expect(serverKeyInput.value).toBe("");
    expect(serverKeyInput.placeholder).toBe("Kosongkan untuk memakai kunci saat ini");
    expect(within(paymentPanel).getByRole("switch", { name: "Mode Pembayaran Midtrans" }).getAttribute("aria-checked")).toBe("false");

    expect(within(paymentPanel).queryByRole("button", { name: "Detail" })).toBeNull();
    expect(within(paymentPanel).queryByRole("button", { name: "Details" })).toBeNull();
    expect(paymentPanel.textContent).not.toContain("Ganti kunci server tanpa menampilkan nilai saat ini.");
    expect(paymentPanel.textContent).not.toContain("Sandbox untuk uji coba, Produksi untuk transaksi pelanggan.");
    expect(paymentPanel.textContent).not.toContain("Midtrans Server Key");
    expect(paymentPanel.textContent).not.toContain("Mode Midtrans");
    expect(paymentPanel.textContent).not.toContain("checkout runtime");
    expect(paymentPanel.textContent).not.toContain("Kosongkan jika tidak diganti");
    expect(paymentPanel.textContent).not.toContain("Midtrans server key");

    expect(within(paymentPanel).queryByText("midtrans.server_key")).toBeNull();
    expect(within(paymentPanel).queryByText("midtrans.is_production")).toBeNull();
    expect(within(paymentPanel).queryByText("Tidak diketahui")).toBeNull();
    expect(within(paymentPanel).queryByText("Wajib untuk runtime")).toBeNull();
    expect(within(paymentPanel).queryByText("Terakhir dibaca runtime")).toBeNull();
    expect(paymentPanel.textContent).not.toContain("Key: midtrans.server_key");
    expect(paymentPanel.textContent).not.toContain("Version ID:");
    expect(paymentPanel.textContent).not.toContain("Last runtime read");
    expect(paymentPanel.textContent).not.toContain("version-secret");
    expect(paymentPanel.textContent).not.toContain("version-mode");
    expect(paymentPanel.textContent).not.toContain("request-1");
    expect(paymentPanel.textContent).not.toContain("request-runtime-read");
    expect(paymentPanel.textContent).not.toContain("Reason");
    expect(paymentPanel.textContent).not.toContain("source");
    expect(paymentPanel.textContent).not.toContain("PLAINTEXT_SENTINEL_DO_NOT_RENDER");
    expect(paymentPanel.textContent).not.toContain("SB-Mid-****7890");

    await waitFor(() => expect(mocks.functionsInvoke).toHaveBeenCalledWith("integration-config", {
      body: {
        action: "summary",
        keys: ["midtrans.server_key", "midtrans.is_production"],
      },
    }));
  });

  it("payment settings shows a safe empty state when payment summary rows are absent", async () => {
    mocks.useForm.mockReturnValue({
      formProps: {},
      saveButtonProps: {},
      form: {
        setFieldValue: mocks.setFieldValue,
        getFieldValue: mocks.getFieldValue,
      },
    });
    mocks.functionsInvoke.mockImplementation((_name: string, { body }: { body: Record<string, unknown> }) => {
      if (body.action === "summary" && Array.isArray(body.keys) && body.keys.every((key) => typeof key === "string" && key.startsWith("midtrans."))) {
        return Promise.resolve({ data: { data: { rows: [] } }, error: null });
      }

      if (body.action === "summary") {
        return Promise.resolve({ data: { data: { rows: [] } }, error: null });
      }

      if (body.action === "audit") {
        return Promise.resolve({ data: { data: [] }, error: null });
      }

      return Promise.resolve({ data: { data: { ok: true } }, error: null });
    });

    renderWithQueryClient(<Settings />);

    const paymentPanel = await screen.findByRole("region", { name: "Pengaturan Pembayaran" });
    expect(await within(paymentPanel).findByText("Pengaturan pembayaran belum tersedia.")).not.toBeNull();

    for (const internalText of [
      "midtrans.server_key",
      "midtrans.is_production",
      "Version ID:",
      "request-",
      "PLAINTEXT_SENTINEL_DO_NOT_RENDER",
    ]) {
      expect(paymentPanel.textContent).not.toContain(internalText);
    }
  });

  it("normalizes deployed legacy summary arrays into settings rows", async () => {
    const summaryRow = {
      key_name: "midtrans.server_key" as const,
      display_name: "Midtrans Server Key",
      description: "Server credential",
      value_kind: "secret" as const,
      is_secret: true,
      is_required: true,
      is_runtime_required: true,
      version_id: "version-secret",
      version_number: 2,
      status: "active",
      masked_value: "SB-Mid-****7890",
      value_fingerprint: "fingerprint-secret",
      non_secret_value: null,
      updated_by: "admin-1",
      updated_at: "2026-05-19T09:00:00Z",
    };
    mocks.functionsInvoke.mockResolvedValueOnce({
      data: { data: [summaryRow] },
      error: null,
    });

    await expect(integrationConfigClient.summary(["midtrans.server_key"])).resolves.toEqual({
      rows: [summaryRow],
    });
  });

  it("payment settings rotates the Midtrans server key with a hidden reason and clears the replacement input", async () => {
    mocks.useForm.mockReturnValue({
      formProps: {},
      saveButtonProps: {},
      form: {
        setFieldValue: mocks.setFieldValue,
        getFieldValue: mocks.getFieldValue,
      },
    });

    renderWithQueryClient(<Settings />);

    const paymentPanel = await screen.findByRole("region", { name: "Pengaturan Pembayaran" });
    const serverKeyInput = await within(paymentPanel).findByLabelText("Kunci Server Midtrans") as HTMLInputElement;
    const serverKeyRow = serverKeyInput.closest("div")?.parentElement as HTMLElement;

    const saveButton = within(serverKeyRow).getByRole("button", { name: "Simpan" }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);

    fireEvent.change(serverKeyInput, { target: { value: "   " } });
    expect(saveButton.disabled).toBe(true);
    expect(mocks.functionsInvoke.mock.calls.some((call) => call[1]?.body?.action === "rotateSecret")).toBe(false);

    fireEvent.change(serverKeyInput, { target: { value: "TEST_NEW_MIDTRANS_SERVER_KEY" } });
    expect(saveButton.disabled).toBe(false);
    fireEvent.click(saveButton);

    await waitFor(() => expect(mocks.functionsInvoke).toHaveBeenCalledWith("integration-config", {
      body: {
        action: "rotateSecret",
        key: "midtrans.server_key",
        secret: "TEST_NEW_MIDTRANS_SERVER_KEY",
        reason: "settings_payment_save",
      },
      headers: { "x-request-id": expect.stringMatching(/^[A-Za-z0-9._:/=-]{1,128}$/) },
    }));
    const rotateBody = mocks.functionsInvoke.mock.calls.find((call) => call[1]?.body?.action === "rotateSecret")?.[1]?.body;
    expect(rotateBody).not.toHaveProperty("source");
    await waitFor(() => expect(serverKeyInput.value).toBe(""));
  });

  it("payment settings saves Midtrans mode as a boolean without source metadata", async () => {
    mocks.useForm.mockReturnValue({
      formProps: {},
      saveButtonProps: {},
      form: {
        setFieldValue: mocks.setFieldValue,
        getFieldValue: mocks.getFieldValue,
      },
    });

    renderWithQueryClient(<Settings />);

    const paymentPanel = await screen.findByRole("region", { name: "Pengaturan Pembayaran" });
    const modeSwitch = await within(paymentPanel).findByRole("switch", { name: "Mode Pembayaran Midtrans" });
    fireEvent.click(modeSwitch);

    const confirm = vi.mocked(Modal.confirm);
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: "Aktifkan Produksi?",
      content: "Transaksi pelanggan akan memakai Midtrans produksi.",
      okText: "Aktifkan",
      cancelText: "Batal",
      onOk: expect.any(Function),
    }));
    expect(mocks.functionsInvoke.mock.calls.some((call) => call[1]?.body?.action === "updateValue")).toBe(false);

    const confirmOptions = confirm.mock.calls[0]?.[0];
    confirmOptions?.onOk?.();

    await waitFor(() => expect(mocks.functionsInvoke).toHaveBeenCalledWith("integration-config", {
      body: {
        action: "updateValue",
        key: "midtrans.is_production",
        value: true,
        reason: "settings_payment_save",
      },
      headers: { "x-request-id": expect.stringMatching(/^[A-Za-z0-9._:/=-]{1,128}$/) },
    }));
    const updateBody = mocks.functionsInvoke.mock.calls.find((call) => call[1]?.body?.action === "updateValue")?.[1]?.body;
    expect(updateBody).not.toHaveProperty("source");
  });

  it("payment settings does not save production mode when confirmation is cancelled", async () => {
    mocks.useForm.mockReturnValue({
      formProps: {},
      saveButtonProps: {},
      form: {
        setFieldValue: mocks.setFieldValue,
        getFieldValue: mocks.getFieldValue,
      },
    });

    renderWithQueryClient(<Settings />);

    const paymentPanel = await screen.findByRole("region", { name: "Pengaturan Pembayaran" });
    const modeSwitch = await within(paymentPanel).findByRole("switch", { name: "Mode Pembayaran Midtrans" });
    fireEvent.click(modeSwitch);

    const confirmOptions = vi.mocked(Modal.confirm).mock.calls[0]?.[0];
    confirmOptions?.onCancel?.();

    expect(mocks.functionsInvoke.mock.calls.some((call) => call[1]?.body?.action === "updateValue")).toBe(false);
  });


  it("shipping runtime renders concise integration-backed controls without duplicate public settings editors", async () => {
    mocks.setLocale("en");
    expect(mocks.translate("settings.shipping.shipperName.label", {}, "Shipper Name")).toBe("Shipper Name");
    expect(mocks.translate("settings.shipping.shipperPhone.label", {}, "Shipper Phone")).toBe("Shipper Phone");
    expect(mocks.translate("settings.shipping.shipperEmail.label", {}, "Shipper Email")).toBe("Shipper Email");
    expect(mocks.translate("settings.integration.status.active", {}, "active")).toBe("Active");
    mocks.setLocale("id");
    mocks.translate.mockClear();

    const onFinish = vi.fn();
    mocks.useForm.mockReturnValue({
      formProps: { onFinish },
      saveButtonProps: {},
      form: {
        setFieldValue: mocks.setFieldValue,
        getFieldValue: mocks.getFieldValue,
      },
    });

    renderWithQueryClient(<Settings />);

    const shippingPanel = await screen.findByRole("region", { name: "Pengaturan Pengiriman" });
    const biteshipApiKeyInput = await within(shippingPanel).findByLabelText("Biteship API Key") as HTMLInputElement;
    expect(biteshipApiKeyInput).not.toBeNull();
    expect(within(shippingPanel).getByText("Active Couriers")).not.toBeNull();
    expect(within(shippingPanel).getByText("Origin Area")).not.toBeNull();
    expect(within(shippingPanel).getByLabelText("Postal Code").getAttribute("readonly")).not.toBeNull();
    expect(within(shippingPanel).getByText("Store Location")).not.toBeNull();
    expect(within(shippingPanel).getByLabelText("Latitude")).not.toBeNull();
    expect(within(shippingPanel).getByLabelText("Longitude")).not.toBeNull();
    expect(within(shippingPanel).getByLabelText("Nama Pengirim")).not.toBeNull();
    expect(within(shippingPanel).getByLabelText("Nomor Telepon Pengirim")).not.toBeNull();
    expect(within(shippingPanel).getByLabelText("Email Pengirim")).not.toBeNull();
    expect(within(shippingPanel).queryByLabelText("Shipper Name")).toBeNull();
    expect(within(shippingPanel).queryByLabelText("Shipper Phone")).toBeNull();
    expect(within(shippingPanel).queryByLabelText("Shipper Email")).toBeNull();
    expect(within(shippingPanel).getByLabelText("Store Address")).not.toBeNull();
    expect(within(shippingPanel).getByLabelText("Organization")).not.toBeNull();

    expect(biteshipApiKeyInput.value).toBe("");
    expect(biteshipApiKeyInput.placeholder).toBe("Kosongkan jika tidak diganti");
    expect(within(shippingPanel).getByPlaceholderText("Cari kecamatan, kota, atau area Biteship")).not.toBeNull();
    expect(within(shippingPanel).getByPlaceholderText("Alamat asal pengiriman")).not.toBeNull();
    expect(shippingPanel.textContent).not.toContain("Ganti kunci Biteship tanpa menampilkan nilai saat ini.");
    expect(shippingPanel.textContent).not.toContain("Opsional jika kode pos atau koordinat peta sudah diatur, tetapi disarankan agar pencocokan area Biteship lebih akurat.");
    expect(shippingPanel.textContent).not.toContain("Alamat asal yang dikirim ke Biteship.");
    for (const forbiddenPrimaryShippingText of [
      "biteship.api_key",
      "biteship.enabled_couriers",
      "biteship.origin_postal_code",
      "biteship.origin_area_id",
      "biteship.origin_latitude",
      "biteship.origin_longitude",
      "shop.shipper_name",
      "shop.shipper_phone",
      "shop.shipper_email",
      "shop.address",
      "shop.organization",
      "Tidak diketahui",
      "Wajib untuk runtime",
      "Terakhir dibaca runtime",
      "Runtime required",
      "Last runtime read",
      "Reason",
      "Alasan",
      "source",
      "settings_shipping_save",
      "version-biteship-secret",
      "version-couriers",
      "version-postal",
      "version-area",
      "version-lat",
      "version-lng",
      "version-shipper-name",
      "version-shipper-phone",
      "version-shipper-email",
      "version-address",
      "version-organization",
      "request-1",
      "request-runtime-read",
      "PLAINTEXT_SENTINEL_DO_NOT_RENDER",
      "BS-****9999",
    ]) {
      expect(shippingPanel.textContent).not.toContain(forbiddenPrimaryShippingText);
    }

    expect(screen.queryByLabelText("New value for biteship.enabled_couriers")).toBeNull();
    expect(screen.queryByLabelText("New value for shop.organization")).toBeNull();
    expect(screen.queryByLabelText("New value for shop.address")).toBeNull();
    expect(screen.queryByLabelText("New value for biteship.origin_area_id")).toBeNull();

    await waitFor(() => expect(mocks.functionsInvoke).toHaveBeenCalledWith("integration-config", {
      body: {
        action: "summary",
        keys: [
          "biteship.api_key",
          "biteship.enabled_couriers",
          "biteship.origin_postal_code",
          "biteship.origin_area_id",
          "biteship.origin_latitude",
          "biteship.origin_longitude",
          "shop.shipper_name",
          "shop.shipper_phone",
          "shop.shipper_email",
          "shop.address",
          "shop.organization",
        ],
      },
    }));
    expect(onFinish).not.toHaveBeenCalled();
  });

  it("shipping runtime shows safe Biteship health alert for incomplete runtime config", async () => {
    mocks.useForm.mockReturnValue({
      formProps: {},
      saveButtonProps: {},
      form: {
        setFieldValue: mocks.setFieldValue,
        getFieldValue: mocks.getFieldValue,
      },
    });
    const unsafeSentinels = [
      "TEST_RAW_BITESHIP_KEY_DO_NOT_RENDER",
      "vault-secret-id-do-not-render",
      "biteship_test.secret-looking-token",
      "Jl. Rahasia 99",
      "081299988877",
      "shipper-private@example.test",
    ];
    mocks.functionsInvoke.mockImplementation((_name: string, { body }: { body: Record<string, unknown> }) => {
      if (body.action === "audit") {
        return Promise.resolve({ data: { data: [] }, error: null });
      }

      if (body.action !== "summary") {
        return Promise.resolve({ data: { data: { ok: true } }, error: null });
      }

      const rows = [
        { key_name: "biteship.api_key", display_name: "Biteship API Key", description: "Biteship credential", value_kind: "secret", is_secret: true, is_required: true, is_runtime_required: true, version_id: null, version_number: null, status: null, masked_value: null, value_fingerprint: null, non_secret_value: null, updated_by: null, updated_at: null },
        { key_name: "biteship.enabled_couriers", display_name: "Active Couriers", description: "Courier services", value_kind: "text_array", is_secret: false, is_required: true, is_runtime_required: true, version_id: null, version_number: null, status: null, masked_value: null, value_fingerprint: null, non_secret_value: [], updated_by: null, updated_at: null },
        { key_name: "biteship.origin_postal_code", display_name: "Postal Code", description: "Origin postal code", value_kind: "string", is_secret: false, is_required: true, is_runtime_required: true, version_id: null, version_number: null, status: null, masked_value: null, value_fingerprint: null, non_secret_value: "", updated_by: null, updated_at: null },
        { key_name: "biteship.origin_area_id", display_name: "Origin Area", description: "Biteship area", value_kind: "string", is_secret: false, is_required: true, is_runtime_required: true, version_id: null, version_number: null, status: null, masked_value: null, value_fingerprint: null, non_secret_value: "", updated_by: null, updated_at: null },
        { key_name: "biteship.origin_latitude", display_name: "Latitude", description: "Origin latitude", value_kind: "number", is_secret: false, is_required: true, is_runtime_required: true, version_id: null, version_number: null, status: null, masked_value: null, value_fingerprint: null, non_secret_value: null, updated_by: null, updated_at: null },
        { key_name: "biteship.origin_longitude", display_name: "Longitude", description: "Origin longitude", value_kind: "number", is_secret: false, is_required: true, is_runtime_required: true, version_id: null, version_number: null, status: null, masked_value: null, value_fingerprint: null, non_secret_value: null, updated_by: null, updated_at: null },
      ];

      return Promise.resolve({
        data: {
          data: {
            rows,
            health: {
              biteship: {
                provider: "biteship",
                apiKeyConfigured: false,
                apiKeySource: "missing",
                requiredConfigComplete: false,
                missingKeys: ["biteship.api_key", "biteship.enabled_couriers"],
                legacyDrift: {
                  enabledCouriers: true,
                  originArea: false,
                  originPostalCode: false,
                  originCoordinates: false,
                },
                diagnostics: unsafeSentinels,
              },
            },
          },
        },
        error: null,
      });
    });

    renderWithQueryClient(<Settings />);

    const shippingPanel = await screen.findByRole("region", { name: "Pengaturan Pengiriman" });
    const alert = await within(shippingPanel).findByRole("alert");

    expect(alert.textContent).toContain("Konfigurasi Biteship belum siap");
    expect(alert.textContent).toContain("Pindahkan API key Biteship ke runtime_config sebelum menghitung ongkir.");
    for (const unsafeSentinel of unsafeSentinels) {
      expect(alert.textContent).not.toContain(unsafeSentinel);
    }
    expect(alert.textContent).not.toContain("biteship.api_key");
    expect(alert.textContent).not.toContain("vault");
  });

  it("shipping runtime updates use integration config actions and avoid the public settings save path", async () => {
    const onFinish = vi.fn();
    mocks.useForm.mockReturnValue({
      formProps: { onFinish },
      saveButtonProps: {},
      form: {
        setFieldValue: mocks.setFieldValue,
        getFieldValue: mocks.getFieldValue,
      },
    });

    renderWithQueryClient(<Settings />);

    const shippingPanel = await screen.findByRole("region", { name: "Pengaturan Pengiriman" });
    const getRowWithSaveButton = (label: string): HTMLElement => {
      const labelElement = within(shippingPanel).getByText(label);
      const saveButton = within(shippingPanel).getAllByRole("button", { name: "Simpan" }).find((button) => {
        return Boolean(labelElement.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING);
      });

      expect(saveButton).toBeDefined();

      return saveButton?.parentElement?.parentElement as HTMLElement;
    };
    const apiKeyInput = await within(shippingPanel).findByLabelText("Biteship API Key") as HTMLInputElement;
    const apiKeyRow = apiKeyInput.closest("div")?.parentElement as HTMLElement;

    fireEvent.click(within(apiKeyRow).getByRole("button", { name: "Simpan" }));
    expect(mocks.functionsInvoke.mock.calls.some((call) => call[1]?.body?.key === "biteship.api_key")).toBe(false);

    fireEvent.change(apiKeyInput, { target: { value: "TEST_NEW_BITESHIP_API_KEY" } });
    fireEvent.click(within(apiKeyRow).getByRole("button", { name: "Simpan" }));

    await waitFor(() => expect(mocks.functionsInvoke).toHaveBeenCalledWith("integration-config", {
      body: {
        action: "rotateSecret",
        key: "biteship.api_key",
        secret: "TEST_NEW_BITESHIP_API_KEY",
        reason: "settings_shipping_save",
      },
      headers: { "x-request-id": expect.stringMatching(/^[A-Za-z0-9._:/=-]{1,128}$/) },
    }));
    const rotateBody = mocks.functionsInvoke.mock.calls.find((call) => call[1]?.body?.key === "biteship.api_key")?.[1]?.body;
    expect(rotateBody).not.toHaveProperty("source");
    await waitFor(() => expect(apiKeyInput.value).toBe(""));

    fireEvent.click(within(shippingPanel).getByRole("button", { name: "CourierPickerModal" }));
    const courierRow = getRowWithSaveButton("Active Couriers");
    fireEvent.click(within(courierRow).getByRole("button", { name: "Simpan" }));
    await waitFor(() => expect(mocks.functionsInvoke).toHaveBeenCalledWith("integration-config", {
      body: {
        action: "updateValue",
        key: "biteship.enabled_couriers",
        value: ["jne:reg"],
        reason: "settings_shipping_save",
      },
      headers: { "x-request-id": expect.stringMatching(/^[A-Za-z0-9._:/=-]{1,128}$/) },
    }));

    fireEvent.click(within(shippingPanel).getByRole("button", { name: "BiteshipAreaSearch" }));
    const areaRow = getRowWithSaveButton("Origin Area");
    fireEvent.click(within(areaRow).getByRole("button", { name: "Simpan" }));
    await waitFor(() => expect(mocks.functionsInvoke).toHaveBeenCalledWith("integration-config", {
      body: {
        action: "updateValue",
        key: "biteship.origin_area_id",
        value: "area-runtime-1",
        reason: "settings_shipping_save",
      },
      headers: { "x-request-id": expect.stringMatching(/^[A-Za-z0-9._:/=-]{1,128}$/) },
    }));
    await waitFor(() => expect(mocks.functionsInvoke).toHaveBeenCalledWith("integration-config", {
      body: {
        action: "updateValue",
        key: "biteship.origin_postal_code",
        value: "12110",
        reason: "settings_shipping_save",
      },
      headers: { "x-request-id": expect.stringMatching(/^[A-Za-z0-9._:/=-]{1,128}$/) },
    }));

    fireEvent.click(within(shippingPanel).getByRole("button", { name: "MapLocationPicker" }));
    const locationRow = getRowWithSaveButton("Store Location");
    fireEvent.click(within(locationRow).getByRole("button", { name: "Simpan" }));
    await waitFor(() => expect(mocks.functionsInvoke).toHaveBeenCalledWith("integration-config", {
      body: {
        action: "updateValue",
        key: "biteship.origin_latitude",
        value: "-6.244100",
        reason: "settings_shipping_save",
      },
      headers: { "x-request-id": expect.stringMatching(/^[A-Za-z0-9._:/=-]{1,128}$/) },
    }));
    await waitFor(() => expect(mocks.functionsInvoke).toHaveBeenCalledWith("integration-config", {
      body: {
        action: "updateValue",
        key: "biteship.origin_longitude",
        value: "106.799500",
        reason: "settings_shipping_save",
      },
      headers: { "x-request-id": expect.stringMatching(/^[A-Za-z0-9._:/=-]{1,128}$/) },
    }));

    const shipperNameInput = within(shippingPanel).getByLabelText("Nama Pengirim");
    fireEvent.change(shipperNameInput, { target: { value: "Apotek Runtime" } });
    const shipperNameRow = shipperNameInput.closest("div")?.parentElement as HTMLElement;
    fireEvent.click(within(shipperNameRow).getByRole("button", { name: "Simpan" }));
    await waitFor(() => expect(mocks.functionsInvoke).toHaveBeenCalledWith("integration-config", {
      body: {
        action: "updateValue",
        key: "shop.shipper_name",
        value: "Apotek Runtime",
        reason: "settings_shipping_save",
      },
      headers: { "x-request-id": expect.stringMatching(/^[A-Za-z0-9._:/=-]{1,128}$/) },
    }));

    const shipperPhoneInput = within(shippingPanel).getByLabelText("Nomor Telepon Pengirim");
    fireEvent.change(shipperPhoneInput, { target: { value: "081200000001" } });
    const shipperPhoneRow = shipperPhoneInput.closest("div")?.parentElement as HTMLElement;
    fireEvent.click(within(shipperPhoneRow).getByRole("button", { name: "Simpan" }));
    await waitFor(() => expect(mocks.functionsInvoke).toHaveBeenCalledWith("integration-config", {
      body: {
        action: "updateValue",
        key: "shop.shipper_phone",
        value: "081200000001",
        reason: "settings_shipping_save",
      },
      headers: { "x-request-id": expect.stringMatching(/^[A-Za-z0-9._:/=-]{1,128}$/) },
    }));

    const shipperEmailInput = within(shippingPanel).getByLabelText("Email Pengirim");
    fireEvent.change(shipperEmailInput, { target: { value: "runtime@example.test" } });
    const shipperEmailRow = shipperEmailInput.closest("div")?.parentElement as HTMLElement;
    fireEvent.click(within(shipperEmailRow).getByRole("button", { name: "Simpan" }));
    await waitFor(() => expect(mocks.functionsInvoke).toHaveBeenCalledWith("integration-config", {
      body: {
        action: "updateValue",
        key: "shop.shipper_email",
        value: "runtime@example.test",
        reason: "settings_shipping_save",
      },
      headers: { "x-request-id": expect.stringMatching(/^[A-Za-z0-9._:/=-]{1,128}$/) },
    }));

    const addressInput = within(shippingPanel).getByLabelText("Store Address");
    fireEvent.change(addressInput, { target: { value: "Jl. Runtime 2" } });
    const addressRow = addressInput.closest("div")?.parentElement as HTMLElement;
    fireEvent.click(within(addressRow).getByRole("button", { name: "Simpan" }));
    await waitFor(() => expect(mocks.functionsInvoke).toHaveBeenCalledWith("integration-config", {
      body: {
        action: "updateValue",
        key: "shop.address",
        value: "Jl. Runtime 2",
        reason: "settings_shipping_save",
      },
      headers: { "x-request-id": expect.stringMatching(/^[A-Za-z0-9._:/=-]{1,128}$/) },
    }));

    const organizationInput = within(shippingPanel).getByLabelText("Organization");
    fireEvent.change(organizationInput, { target: { value: "PT Runtime" } });
    const organizationRow = organizationInput.closest("div")?.parentElement as HTMLElement;
    fireEvent.click(within(organizationRow).getByRole("button", { name: "Simpan" }));
    await waitFor(() => expect(mocks.functionsInvoke).toHaveBeenCalledWith("integration-config", {
      body: {
        action: "updateValue",
        key: "shop.organization",
        value: "PT Runtime",
        reason: "settings_shipping_save",
      },
      headers: { "x-request-id": expect.stringMatching(/^[A-Za-z0-9._:/=-]{1,128}$/) },
    }));

    const updateBodies = mocks.functionsInvoke.mock.calls
      .map((call) => call[1]?.body)
      .filter((body) => body?.action === "updateValue" || body?.action === "rotateSecret");
    expect(updateBodies.every((body) => !Object.prototype.hasOwnProperty.call(body, "source"))).toBe(true);
    expect(onFinish).not.toHaveBeenCalled();
  });

  it("keeps shipping runtime config keys in the client contract and shipping panel source", () => {
    const shippingRuntimeKeys = [
      "biteship.origin_area_id",
      "biteship.origin_postal_code",
      "biteship.origin_latitude",
      "biteship.origin_longitude",
      "biteship.enabled_couriers",
      "shop.shipper_name",
      "shop.shipper_phone",
      "shop.shipper_email",
      "shop.address",
      "shop.organization",
    ];
    expect(RUNTIME_CONFIG_KEYS).toEqual(expect.arrayContaining(shippingRuntimeKeys));
    expect(shippingPanelSource).toContain("const SHIPPING_CONFIG_KEYS = INTEGRATION_CONFIG_OWNERSHIP.shipping");
    expect(shippingPanelSource).toContain("integrationConfigClient.summary([...SHIPPING_CONFIG_KEYS])");

    for (const key of shippingRuntimeKeys) {
      expect(shippingPanelSource).toContain(key);
    }
  });

  it("defines one primary Settings owner for every runtime integration config key", () => {
    expect(INTEGRATION_CONFIG_OWNERSHIP).toEqual({
      payment: ["midtrans.server_key", "midtrans.is_production"],
      shipping: [
        "biteship.api_key",
        "biteship.enabled_couriers",
        "biteship.origin_postal_code",
        "biteship.origin_area_id",
        "biteship.origin_latitude",
        "biteship.origin_longitude",
        "shop.shipper_name",
        "shop.shipper_phone",
        "shop.shipper_email",
        "shop.address",
        "shop.organization",
      ],
      technical: ["push.expo_access_token", "cors.allowed_origins"],
    });

    const ownedKeys = Object.values(INTEGRATION_CONFIG_OWNERSHIP).flat();

    expect(new Set(ownedKeys).size).toBe(ownedKeys.length);
    expect(getPrimaryOwnerForIntegrationConfigKey("midtrans.server_key")).toBe("payment");
    expect(getPrimaryOwnerForIntegrationConfigKey("biteship.api_key")).toBe("shipping");
    expect(getPrimaryOwnerForIntegrationConfigKey("cors.allowed_origins")).toBe("technical");
  });

  function getAuditRequestBodies(): Array<{ action: "audit"; key?: string; limit?: number }> {
    return mocks.functionsInvoke.mock.calls
      .map((call) => call[1]?.body)
      .filter((body): body is { action: "audit"; key?: string; limit?: number } => body?.action === "audit");
  }

  function createAuditRow(
    overrides: Pick<IntegrationConfigAuditRow, "id" | "key_name" | "action" | "created_at"> &
      Partial<IntegrationConfigAuditRow>
  ): IntegrationConfigAuditRow {
    return {
      version_id: null,
      actor_id: "admin-audit",
      actor_role: "admin",
      source: "admin_gateway",
      request_id: `request-${overrides.id}`,
      reason: "audit reason",
      old_version_number: 1,
      new_version_number: 2,
      old_masked_value: "old-masked",
      new_masked_value: "new-masked",
      value_fingerprint: null,
      metadata: null,
      ...overrides,
    };
  }

  function mockAuditRows(rows: IntegrationConfigAuditRow[]) {
    mocks.functionsInvoke.mockImplementation((_name: string, { body }: { body: Record<string, unknown> }) => {
      if (body.action === "audit") {
        const requestedAuditKey = typeof body.key === "string" ? body.key : undefined;

        return Promise.resolve({
          data: {
            data: requestedAuditKey ? rows.filter((row) => row.key_name === requestedAuditKey) : rows,
          },
          error: null,
        });
      }

      return Promise.resolve({ data: { data: { ok: true } }, error: null });
    });
  }

  it("Audit Konfigurasi manually loads all owner audit keys after clicking Muat audit", async () => {
    render(<IntegrationAuditPanel />);

    expect(screen.getByRole("region", { name: "Audit Konfigurasi" })).not.toBeNull();
    expect(screen.getByLabelText("Area")).not.toBeNull();
    expect(screen.getByLabelText("Konfigurasi")).not.toBeNull();
    expect(screen.getByLabelText("Aksi")).not.toBeNull();
    expect(screen.getByLabelText("Limit")).not.toBeNull();

    expect(mocks.functionsInvoke.mock.calls.some((call) => call[1]?.body?.action === "audit")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Muat audit" }));

    const allOwnedKeys = Object.values(INTEGRATION_CONFIG_OWNERSHIP).flat();
    await waitFor(() => expect(getAuditRequestBodies().length).toBe(allOwnedKeys.length));
    expect(getAuditRequestBodies()).toEqual(expect.arrayContaining(
      allOwnedKeys.map((key) => ({ action: "audit", key, limit: 50 }))
    ));
    await waitFor(() => expect(screen.getAllByText("Allowed Origins").length).toBeGreaterThan(0));
    expect(screen.getAllByText("Expo Push Token").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Kunci Server Midtrans").length).toBeGreaterThan(0);
    expect(document.body.textContent).toContain("Keycors.allowed_origins");
    expect(document.body.textContent).toContain("Requestrequest-cors-origins");
    expect(document.body.textContent).toContain("Nilai diperbarui");
    expect(document.body.textContent).not.toContain("PLAINTEXT_SENTINEL_DO_NOT_RENDER");
    expect(document.body.textContent).not.toContain("metadata");

    const bodyText = document.body.textContent ?? "";
    expect(bodyText.indexOf("Requestrequest-cors-origins")).toBeLessThan(bodyText.indexOf("Requestrequest-push-token"));
    expect(bodyText.indexOf("Requestrequest-push-token")).toBeLessThan(bodyText.indexOf("Requestrequest-runtime-read"));
  });

  it("Audit Konfigurasi loads owner-specific keys and explicit key filters only", async () => {
    render(<IntegrationAuditPanel />);

    fireEvent.change(screen.getByLabelText("Area"), { target: { value: "shipping" } });
    fireEvent.click(screen.getByRole("button", { name: "Muat audit" }));

    await waitFor(() => expect(getAuditRequestBodies().length).toBe(INTEGRATION_CONFIG_OWNERSHIP.shipping.length));
    expect(getAuditRequestBodies()).toEqual(expect.arrayContaining(
      INTEGRATION_CONFIG_OWNERSHIP.shipping.map((key) => ({ action: "audit", key, limit: 50 }))
    ));
    expect(getAuditRequestBodies().some((body) => body.key === "midtrans.server_key")).toBe(false);

    mocks.functionsInvoke.mockClear();
    fireEvent.change(screen.getByLabelText("Konfigurasi"), { target: { value: "biteship.api_key" } });
    fireEvent.change(screen.getByLabelText("Limit"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Muat audit" }));

    await waitFor(() => expect(getAuditRequestBodies()).toEqual([
      { action: "audit", key: "biteship.api_key", limit: 100 },
    ]));
  });

  it("Audit Konfigurasi loads only payment owner keys", async () => {
    render(<IntegrationAuditPanel />);

    fireEvent.change(screen.getByLabelText("Area"), { target: { value: "payment" } });
    fireEvent.click(screen.getByRole("button", { name: "Muat audit" }));

    await waitFor(() => expect(getAuditRequestBodies()).toEqual(
      INTEGRATION_CONFIG_OWNERSHIP.payment.map((key) => ({ action: "audit", key, limit: 50 }))
    ));
    expect(getAuditRequestBodies().some((body) => INTEGRATION_CONFIG_OWNERSHIP.shipping.includes(body.key as never))).toBe(false);
    expect(getAuditRequestBodies().some((body) => INTEGRATION_CONFIG_OWNERSHIP.technical.includes(body.key as never))).toBe(false);
  });

  it("Audit Konfigurasi loads only technical owner keys", async () => {
    render(<IntegrationAuditPanel />);

    fireEvent.change(screen.getByLabelText("Area"), { target: { value: "technical" } });
    fireEvent.click(screen.getByRole("button", { name: "Muat audit" }));

    await waitFor(() => expect(getAuditRequestBodies()).toEqual(
      INTEGRATION_CONFIG_OWNERSHIP.technical.map((key) => ({ action: "audit", key, limit: 50 }))
    ));
    expect(getAuditRequestBodies().some((body) => INTEGRATION_CONFIG_OWNERSHIP.payment.includes(body.key as never))).toBe(false);
    expect(getAuditRequestBodies().some((body) => INTEGRATION_CONFIG_OWNERSHIP.shipping.includes(body.key as never))).toBe(false);
  });

  it("Audit Konfigurasi loads only the explicit Midtrans server key", async () => {
    render(<IntegrationAuditPanel />);

    fireEvent.change(screen.getByLabelText("Konfigurasi"), { target: { value: "midtrans.server_key" } });
    fireEvent.click(screen.getByRole("button", { name: "Muat audit" }));

    await waitFor(() => expect(getAuditRequestBodies()).toEqual([
      { action: "audit", key: "midtrans.server_key", limit: 50 },
    ]));
  });

  it("Audit Konfigurasi filters actions after fetch and before the final limit", async () => {
    mockAuditRows([
      createAuditRow({ id: "runtime-read", key_name: "midtrans.server_key", action: "runtime_read", request_id: "request-runtime-read-filter", reason: "runtime read content", created_at: "2026-05-20T10:00:00Z" }),
      createAuditRow({ id: "value-updated", key_name: "midtrans.server_key", action: "value_updated", request_id: "request-value-updated-filter", reason: "value updated content", created_at: "2026-05-20T11:00:00Z" }),
      createAuditRow({ id: "secret-1", key_name: "midtrans.server_key", action: "secret_rotated", request_id: "request-secret-rotated-filter", reason: "secret rotated content", created_at: "2026-05-20T12:00:00Z" }),
    ]);
    render(<IntegrationAuditPanel />);

    fireEvent.change(screen.getByLabelText("Konfigurasi"), { target: { value: "midtrans.server_key" } });
    fireEvent.change(screen.getByLabelText("Aksi"), { target: { value: "secret_rotated" } });
    fireEvent.click(screen.getByRole("button", { name: "Muat audit" }));

    expect(await screen.findByText("request-secret-rotated-filter")).not.toBeNull();
    expect(document.body.textContent).toContain("secret rotated content");
    expect(document.body.textContent).not.toContain("runtime read content");
    expect(document.body.textContent).not.toContain("value updated content");
    expect(getAuditRequestBodies()).toEqual([{ action: "audit", key: "midtrans.server_key", limit: 50 }]);
  });

  it("Audit Konfigurasi sorts visible rows newest first", async () => {
    mockAuditRows([
      createAuditRow({ id: "oldest", key_name: "midtrans.server_key", action: "secret_rotated", request_id: "request-sort-oldest", created_at: "2026-05-20T08:00:00Z" }),
      createAuditRow({ id: "newest", key_name: "midtrans.server_key", action: "secret_rotated", request_id: "request-sort-newest", created_at: "2026-05-20T12:00:00Z" }),
      createAuditRow({ id: "middle", key_name: "midtrans.server_key", action: "secret_rotated", request_id: "request-sort-middle", created_at: "2026-05-20T10:00:00Z" }),
    ]);
    render(<IntegrationAuditPanel />);

    fireEvent.change(screen.getByLabelText("Konfigurasi"), { target: { value: "midtrans.server_key" } });
    fireEvent.click(screen.getByRole("button", { name: "Muat audit" }));

    await screen.findByText("request-sort-newest");
    const bodyText = document.body.textContent ?? "";
    expect(bodyText.indexOf("request-sort-newest")).toBeLessThan(bodyText.indexOf("request-sort-middle"));
    expect(bodyText.indexOf("request-sort-middle")).toBeLessThan(bodyText.indexOf("request-sort-oldest"));
  });

  it("Audit Konfigurasi displays no more rows than the selected limit", async () => {
    mockAuditRows(Array.from({ length: 55 }, (_, index) => createAuditRow({
      id: `limit-${index + 1}`,
      key_name: "midtrans.server_key",
      action: "secret_rotated",
      request_id: `request-limit-${String(index + 1).padStart(2, "0")}`,
      created_at: new Date(Date.UTC(2026, 4, 20, 12, 0, 0) - index * 60_000).toISOString(),
    })));
    render(<IntegrationAuditPanel />);

    fireEvent.change(screen.getByLabelText("Konfigurasi"), { target: { value: "midtrans.server_key" } });
    fireEvent.click(screen.getByRole("button", { name: "Muat audit" }));

    await waitFor(() => expect(screen.getAllByText(/^request-limit-/)).toHaveLength(50));
    expect(document.body.textContent).toContain("request-limit-50");
    expect(document.body.textContent).not.toContain("request-limit-51");
  });

  it("Audit Konfigurasi renders missing values as dashes and uses only masked old and new values", async () => {
    mockAuditRows([
      createAuditRow({
        id: "missing-values",
        key_name: "midtrans.server_key",
        action: "secret_rotated",
        actor_id: null,
        actor_role: "",
        source: null,
        request_id: "",
        reason: null,
        old_masked_value: null,
        new_masked_value: "",
        value_fingerprint: "fingerprint-must-not-render",
        metadata: { old_masked_value: "metadata-old-must-not-render", new_masked_value: "metadata-new-must-not-render" },
        created_at: "2026-05-20T12:00:00Z",
      }),
    ]);
    render(<IntegrationAuditPanel />);

    fireEvent.change(screen.getByLabelText("Konfigurasi"), { target: { value: "midtrans.server_key" } });
    fireEvent.click(screen.getByRole("button", { name: "Muat audit" }));

    await screen.findByText("Kunci Server Midtrans");
    expect(screen.getAllByText("-").length).toBeGreaterThanOrEqual(6);
    expect(document.body.textContent).not.toContain("fingerprint-must-not-render");
    expect(document.body.textContent).not.toContain("metadata-old-must-not-render");
    expect(document.body.textContent).not.toContain("metadata-new-must-not-render");
  });

  it("Audit Konfigurasi renders unknown action labels as safe text", async () => {
    const unsafeAction = "<img src=x onerror=alert(1)>";
    mockAuditRows([
      createAuditRow({
        id: "unknown-action",
        key_name: "midtrans.server_key",
        action: unsafeAction,
        request_id: "request-unknown-action",
        created_at: "2026-05-20T12:00:00Z",
      }),
    ]);
    render(<IntegrationAuditPanel />);

    fireEvent.change(screen.getByLabelText("Konfigurasi"), { target: { value: "midtrans.server_key" } });
    fireEvent.click(screen.getByRole("button", { name: "Muat audit" }));

    expect(await screen.findByText(unsafeAction)).not.toBeNull();
    expect(document.body.querySelector("img")).toBeNull();
  });

  it("Audit Konfigurasi clears an incompatible payment key when owner switches to shipping", async () => {
    render(<IntegrationAuditPanel />);

    fireEvent.change(screen.getByLabelText("Area"), { target: { value: "payment" } });
    fireEvent.change(screen.getByLabelText("Konfigurasi"), { target: { value: "midtrans.server_key" } });
    expect((screen.getByLabelText("Konfigurasi") as HTMLSelectElement).value).toBe("midtrans.server_key");

    fireEvent.change(screen.getByLabelText("Area"), { target: { value: "shipping" } });
    expect((screen.getByLabelText("Konfigurasi") as HTMLSelectElement).value).toBe("all");

    fireEvent.click(screen.getByRole("button", { name: "Muat audit" }));

    await waitFor(() => expect(getAuditRequestBodies().length).toBe(INTEGRATION_CONFIG_OWNERSHIP.shipping.length));
    expect(getAuditRequestBodies()).toEqual(expect.arrayContaining(
      INTEGRATION_CONFIG_OWNERSHIP.shipping.map((key) => ({ action: "audit", key, limit: 50 }))
    ));
    expect(getAuditRequestBodies().some((body) => body.key === "midtrans.server_key")).toBe(false);
  });

  it("Audit Konfigurasi discards partial rows and shows a generic error when any key fails", async () => {
    mocks.functionsInvoke.mockImplementation((_name: string, { body }: { body: Record<string, unknown> }) => {
      if (body.action === "audit" && body.key === "biteship.api_key") {
        return Promise.reject(new Error("raw gateway failure PLAINTEXT_SENTINEL_DO_NOT_RENDER vault-secret-id-do-not-render"));
      }

      if (body.action === "audit") {
        return Promise.resolve({
          data: {
            data: [
              {
                id: "partial-row",
                key_name: body.key,
                version_id: "partial-version",
                action: "value_updated",
                actor_id: "partial-admin",
                actor_role: "admin",
                source: "admin_gateway",
                request_id: "request-partial-success",
                reason: "partial success should not render",
                old_version_number: 1,
                new_version_number: 2,
                old_masked_value: "old-partial",
                new_masked_value: "new-partial",
                value_fingerprint: null,
                metadata: { note: "PLAINTEXT_SENTINEL_DO_NOT_RENDER" },
                created_at: "2026-05-19T14:00:00Z",
              },
            ],
          },
          error: null,
        });
      }

      return Promise.resolve({ data: { data: { ok: true } }, error: null });
    });

    render(<IntegrationAuditPanel />);
    fireEvent.change(screen.getByLabelText("Area"), { target: { value: "shipping" } });
    fireEvent.click(screen.getByRole("button", { name: "Muat audit" }));

    expect(await screen.findByRole("alert")).not.toBeNull();
    expect(document.body.textContent).toContain("Jejak audit konfigurasi tidak dapat dimuat.");
    expect(document.body.textContent).not.toContain("raw gateway failure");
    expect(document.body.textContent).not.toContain("vault-secret-id-do-not-render");
    expect(document.body.textContent).not.toContain("PLAINTEXT_SENTINEL_DO_NOT_RENDER");
    expect(document.body.textContent).not.toContain("request-partial-success");
    expect(document.body.textContent).not.toContain("partial success should not render");
  });

  it("provides primitive rows that hide raw metadata until details are requested", () => {
    const row = {
      key_name: "midtrans.server_key" as const,
      display_name: "Midtrans Server Key",
      description: "Server credential",
      value_kind: "secret" as const,
      is_secret: true,
      is_required: true,
      is_runtime_required: true,
      version_id: "version-secret",
      version_number: 2,
      status: "active",
      masked_value: "SB-Mid-****7890",
      value_fingerprint: "fingerprint-secret",
      non_secret_value: "PLAINTEXT_SENTINEL_DO_NOT_RENDER",
      updated_by: "admin-1",
      updated_at: "2026-05-19T09:00:00Z",
    };
    const auditRow = {
      id: "audit-1",
      key_name: "midtrans.server_key",
      version_id: "version-secret",
      action: "secret_rotated",
      actor_id: "admin-1",
      actor_role: "admin",
      source: "admin_gateway",
      request_id: "request-1",
      reason: "scheduled rotation",
      old_version_number: 1,
      new_version_number: 2,
      old_masked_value: "SB-Mid-****1234",
      new_masked_value: "SB-Mid-****7890",
      value_fingerprint: "fingerprint-secret",
      metadata: { note: "PLAINTEXT_SENTINEL_DO_NOT_RENDER" },
      created_at: "2026-05-19T10:00:00Z",
    };
    const runtimeRead = { ...auditRow, id: "runtime-read", action: "runtime_read", request_id: "request-runtime-read" };

    const { unmount } = render(
      <OperationalConfigRow
        row={row}
        actions={<ConfigDetailsDisclosure row={row} auditRows={[auditRow]} lastRuntimeRead={runtimeRead} />}
      />
    );

    const label = screen.getByText("Midtrans Server Key");
    const status = screen.getByText("Aktif");
    const description = screen.getByText("Server credential");
    const detailsButton = screen.getByRole("button", { name: "Details" });

    expect(label).not.toBeNull();
    expect(status).not.toBeNull();
    expect(label.parentElement).toBe(status.parentElement);
    expect(label.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(description.parentElement).toBe(label.parentElement?.parentElement);
    expect(detailsButton.parentElement).not.toBe(label.parentElement);
    expect(document.body.textContent).not.toContain("active");
    expect(document.body.textContent).not.toContain("midtrans.server_key");
    expect(document.body.textContent).not.toContain("Runtime required");
    expect(document.body.textContent).not.toContain("Last runtime read");
    expect(document.body.textContent).not.toContain("request-runtime-read");
    expect(document.body.textContent).not.toContain("request-1");
    expect(document.body.textContent).not.toContain("version-secret");
    expect(document.body.textContent).not.toContain("scheduled rotation");
    expect(document.body.textContent).not.toContain("PLAINTEXT_SENTINEL_DO_NOT_RENDER");

    fireEvent.click(screen.getByRole("button", { name: "Details" }));

    expect(screen.getByRole("dialog")).not.toBeNull();
    expect(document.body.textContent).toContain("Key: midtrans.server_key");
    expect(document.body.textContent).toContain("Version ID: version-secret");
    expect(document.body.textContent).toContain("Version: 2");
    expect(document.body.textContent).toContain("Last runtime read request: request-runtime-read");
    expect(document.body.textContent).toContain("Request: request-1");
    expect(document.body.textContent).toContain("Actor role: admin");
    expect(document.body.textContent).toContain("Actor ID: admin-1");
    expect(document.body.textContent).toContain("Source: admin_gateway");
    expect(document.body.textContent).toContain("Reason: scheduled rotation");
    expect(document.body.textContent).toContain("Old: SB-Mid-****1234");
    expect(document.body.textContent).toContain("New: SB-Mid-****7890");
    expect(document.body.textContent).not.toContain("PLAINTEXT_SENTINEL_DO_NOT_RENDER");

    unmount();
    mocks.setLocale("en");
    const englishRender = render(<OperationalConfigRow row={row} />);

    expect(screen.getByText("Active")).not.toBeNull();
    expect(document.body.textContent).not.toContain("Aktif");

    englishRender.unmount();
    mocks.setLocale("id");
    const unknownStatusRender = render(
      <OperationalConfigRow row={{ ...row, display_name: "Retry Policy", description: "Edge condition", status: "pending_review-now" }} />
    );

    expect(screen.getByText("Pending Review Now")).not.toBeNull();
    expect(screen.getByText("Retry Policy").parentElement).toBe(screen.getByText("Pending Review Now").parentElement);

    unknownStatusRender.unmount();
    render(<OperationalConfigRow row={{ ...row, display_name: "No Status Row", description: null, status: "  " }} />);

    expect(screen.getByText("No Status Row")).not.toBeNull();
    expect(screen.queryByText("Aktif")).toBeNull();
    expect(screen.queryByText("Active")).toBeNull();
  });

  it("creates blank secret replacement drafts instead of hydrating masked or plaintext values", () => {
    const draft = createBlankSecretReplacementDraft({
      key_name: "midtrans.server_key",
      masked_value: "SB-Mid-****7890",
      non_secret_value: "PLAINTEXT_SENTINEL_DO_NOT_RENDER",
    });

    expect(draft.value).toBe("");
    expect(JSON.stringify(draft)).not.toContain("SB-Mid-****7890");
    expect(JSON.stringify(draft)).not.toContain("PLAINTEXT_SENTINEL_DO_NOT_RENDER");
  });

  it("disables secret replacement saves when requested", () => {
    render(
      <SecretReplacementInput
        label="Midtrans Server Key"
        draft={{ value: "" }}
        onChange={vi.fn()}
        onSave={vi.fn()}
        saveDisabled
      />
    );

    const saveButton = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
    const input = screen.getByLabelText("Midtrans Server Key") as HTMLInputElement;
    expect(input.disabled).toBe(false);
  });

  it("advanced section does not render moved domain edit controls", async () => {
    mocks.useForm.mockReturnValue({
      formProps: {},
      saveButtonProps: {},
      form: {
        setFieldValue: mocks.setFieldValue,
        getFieldValue: mocks.getFieldValue,
      },
    });

    renderWithQueryClient(<Settings />);

    const advancedPanel = await screen.findByRole("region", { name: "Lanjutan" });

    expect(advancedPanel.textContent).not.toMatch(/audit\s+teknis/i);
    expect(await within(advancedPanel).findByLabelText("Expo Push Token")).not.toBeNull();
    expect(within(advancedPanel).getByLabelText("Allowed Origins")).not.toBeNull();
    expect(within(advancedPanel).getAllByRole("button", { name: "Simpan" }).length).toBeGreaterThanOrEqual(2);
    expect(within(advancedPanel).queryByRole("button", { name: /audit\s+teknis/i })).toBeNull();
    expect(within(advancedPanel).queryByRole("button", { name: "Detail" })).toBeNull();
    expect(within(advancedPanel).queryByRole("button", { name: "Details" })).toBeNull();

    expect(advancedPanel.textContent).not.toContain("Midtrans Server Key");
    expect(advancedPanel.textContent).not.toContain("Mode Midtrans");
    expect(advancedPanel.textContent).not.toContain("Biteship API Key");
    expect(advancedPanel.textContent).not.toContain("Active Couriers");
    expect(advancedPanel.textContent).not.toContain("Nama Pengirim");
    expect(advancedPanel.textContent).not.toContain("midtrans.server_key");
    expect(advancedPanel.textContent).not.toContain("biteship.api_key");
    expect(advancedPanel.textContent).not.toContain("shop.organization");
    expect(advancedPanel.textContent).not.toContain("Runtime required");
    expect(advancedPanel.textContent).not.toContain("Last runtime read");
    expect(advancedPanel.textContent).not.toContain("Reason");
    expect(advancedPanel.textContent).not.toContain("request-runtime-read");
    expect(advancedPanel.textContent).not.toContain("version-secret");
    expect(advancedPanel.textContent).not.toContain("PLAINTEXT_SENTINEL_DO_NOT_RENDER");
    expect(within(advancedPanel).queryByRole("button", { name: "Rotate secret" })).toBeNull();
    expect(within(advancedPanel).queryByRole("button", { name: "Save value" })).toBeNull();

    await waitFor(() => expect(mocks.functionsInvoke).toHaveBeenCalledWith("integration-config", {
      body: {
        action: "summary",
        keys: ["push.expo_access_token", "cors.allowed_origins"],
      },
    }));
  });

  it("advanced advanced settings rotates the Expo push token with a hidden reason", async () => {
    mocks.useForm.mockReturnValue({
      formProps: {},
      saveButtonProps: {},
      form: {
        setFieldValue: mocks.setFieldValue,
        getFieldValue: mocks.getFieldValue,
      },
    });

    renderWithQueryClient(<Settings />);

    const advancedPanel = await screen.findByRole("region", { name: "Lanjutan" });
    const pushTokenInput = await within(advancedPanel).findByLabelText("Expo Push Token") as HTMLInputElement;
    const pushTokenRow = pushTokenInput.closest("div")?.parentElement as HTMLElement;

    fireEvent.click(within(pushTokenRow).getByRole("button", { name: "Simpan" }));
    expect(mocks.functionsInvoke.mock.calls.some((call) => call[1]?.body?.key === "push.expo_access_token")).toBe(false);

    fireEvent.change(pushTokenInput, { target: { value: "TEST_NEW_EXPO_ACCESS_TOKEN" } });
    fireEvent.click(within(pushTokenRow).getByRole("button", { name: "Simpan" }));

    await waitFor(() => expect(mocks.functionsInvoke).toHaveBeenCalledWith("integration-config", {
      body: {
        action: "rotateSecret",
        key: "push.expo_access_token",
        secret: "TEST_NEW_EXPO_ACCESS_TOKEN",
        reason: "settings_technical_save",
      },
      headers: { "x-request-id": expect.stringMatching(/^[A-Za-z0-9._:/=-]{1,128}$/) },
    }));
    const rotateBody = mocks.functionsInvoke.mock.calls.find((call) => call[1]?.body?.key === "push.expo_access_token")?.[1]?.body;
    expect(rotateBody).not.toHaveProperty("source");
    await waitFor(() => expect(pushTokenInput.value).toBe(""));
  });

  it("advanced advanced settings sends CORS origins updates as arrays", async () => {
    mocks.useForm.mockReturnValue({
      formProps: {},
      saveButtonProps: {},
      form: {
        setFieldValue: mocks.setFieldValue,
        getFieldValue: mocks.getFieldValue,
      },
    });

    renderWithQueryClient(<Settings />);

    const advancedPanel = await screen.findByRole("region", { name: "Lanjutan" });
    const allowedOriginsInput = await within(advancedPanel).findByLabelText("Allowed Origins");
    const allowedOriginsRow = allowedOriginsInput.closest("div")?.parentElement as HTMLElement;

    fireEvent.change(allowedOriginsInput, {
      target: { value: "https://admin.example.test, https://ops.example.test" },
    });
    fireEvent.click(within(allowedOriginsRow).getByRole("button", { name: "Simpan" }));

    await waitFor(() => expect(mocks.functionsInvoke).toHaveBeenCalledWith("integration-config", {
      body: {
        action: "updateValue",
        key: "cors.allowed_origins",
        value: ["https://admin.example.test", "https://ops.example.test"],
        reason: "settings_technical_save",
      },
      headers: { "x-request-id": expect.stringMatching(/^[A-Za-z0-9._:/=-]{1,128}$/) },
    }));
    const updateBody = mocks.functionsInvoke.mock.calls.find((call) => call[1]?.body?.key === "cors.allowed_origins")?.[1]?.body;
    expect(updateBody).not.toHaveProperty("source");
    expect(advancedPanel.textContent).not.toContain("Reason");
  });

  it("advanced advanced settings shows safe loading and gateway errors without raw response internals", async () => {
    mocks.useForm.mockReturnValue({
      formProps: {},
      saveButtonProps: {},
      form: {
        setFieldValue: mocks.setFieldValue,
        getFieldValue: mocks.getFieldValue,
      },
    });
    let resolveSummary: ((value: unknown) => void) | undefined;
    let resolveAudit: ((value: unknown) => void) | undefined;
    mocks.functionsInvoke.mockImplementation((_name: string, { body }: { body: Record<string, unknown> }) => {
      if (body.action === "summary") {
        return new Promise((resolve) => {
          resolveSummary = resolve;
        });
      }

      if (body.action === "audit") {
        return new Promise((resolve) => {
          resolveAudit = resolve;
        });
      }

      return Promise.resolve({ data: { data: { ok: true } }, error: null });
    });

    renderWithQueryClient(<Settings />);

    const advancedPanel = await screen.findByRole("region", { name: "Lanjutan" });
    expect(within(advancedPanel).getByText("Loading advanced settings...")).not.toBeNull();

    resolveSummary?.({ data: { error: "Only admin can manage integration config PLAINTEXT_SENTINEL_DO_NOT_RENDER" }, error: null });
    resolveAudit?.({ data: { error: "Only admin can manage integration config PLAINTEXT_SENTINEL_DO_NOT_RENDER" }, error: null });

    expect(await within(advancedPanel).findByText("Advanced settings could not be loaded.")).not.toBeNull();
    expect(document.body.textContent).not.toContain("Only admin can manage integration config");
    expect(document.body.textContent).not.toContain("PLAINTEXT_SENTINEL_DO_NOT_RENDER");
  });

  it("renders nothing for profile without identity and shows password mismatch feedback when loaded", async () => {
    mocks.useGetIdentity.mockReturnValue({ data: { id: "user-1" } }).mockReturnValueOnce({ data: null });
    mocks.useForm.mockReturnValue({ formProps: {}, saveButtonProps: {} });

    const { container, rerender } = renderWithQueryClient(<Profile />);
    expect(container.textContent).toBe("");

    rerender(<Profile />);
    await waitFor(() => expect(mocks.mfaListFactors).toHaveBeenCalledTimes(1));
    expect(screen.getByText("AvatarUpload")).not.toBeNull();

    const useFormCall = mocks.useForm.mock.calls.find((call) => call[0]?.resource === "profiles");
    expect(useFormCall?.[0]?.invalidates).toEqual(["detail"]);

    fireEvent.click(screen.getByRole("button", { name: "profile.changePassword" }));
    expect(mocks.messageError).toHaveBeenCalledWith("profile.passwordMismatch");
  });
});
