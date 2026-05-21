import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Settings from "../settings";
import { INTEGRATION_CONFIG_OWNERSHIP, getPrimaryOwnerForIntegrationConfigKey } from "../settings/integration-config-ownership";
import {
  ConfigDetailsDisclosure,
  OperationalConfigRow,
  createBlankSecretReplacementDraft,
} from "../settings/integration-config-primitives";
import { Profile } from "../profile";
import { CategoryCreate } from "../categories/create";
import { CategoryEdit } from "../categories/edit";
import { ProductCreate } from "../products/create";
import { ProductEdit } from "../products/edit";

const mocks = vi.hoisted(() => {
  const translate = vi.fn((key: string, paramsOrFallback?: Record<string, unknown> | string, fallback?: string) => {
    if (typeof paramsOrFallback === "string") {
      return paramsOrFallback;
    }
    return fallback ?? key;
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
    Select: ({ options, placeholder }: { options?: Array<{ label: string; value: string | boolean }>; placeholder?: string }) => <div>{placeholder ?? options?.map((option) => String(option.label)).join(",")}</div>,
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
    Alert: ({ message, description }: { message: React.ReactNode; description?: React.ReactNode }) => <div role="alert">{message}{description}</div>,
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
    Button: ({ children, onClick, htmlType, type, size, icon }: { children?: React.ReactNode; onClick?: () => void; htmlType?: "submit" | "button"; type?: string; size?: string; icon?: React.ReactNode }) => <button type={htmlType ?? "button"} data-type={type} data-size={size} onClick={onClick}>{icon}{children}</button>,
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
        return Promise.resolve({
          data: {
            data: requestedKeys ? summaryRows.filter((row) => requestedKeys.includes(row.key_name)) : summaryRows,
          },
          error: null,
        });
      }

      if (body.action === "audit") {
        return Promise.resolve({
          data: {
            data: [
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
            ],
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
    expect(screen.getByRole("tab", { name: "Teknis" })).not.toBeNull();
    expect(screen.queryByRole("tab", { name: "Konfigurasi Integrasi" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Integration Config" })).toBeNull();

    expect(await screen.findByRole("region", { name: "Pengaturan Pengiriman" })).not.toBeNull();
    expect(await screen.findByRole("region", { name: "Pengaturan Pembayaran" })).not.toBeNull();
    expect(await screen.findByRole("region", { name: "Teknis" })).not.toBeNull();
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

    fireEvent.click(screen.getByRole("tab", { name: "Teknis" }));
    expect(storeProfileSave.disabled).toBe(true);
    expect(storeProfileSave.style.display).toBe("none");

    fireEvent.click(screen.getByRole("tab", { name: "Profil Toko" }));
    expect(storeProfileSave.disabled).toBe(false);
    expect(storeProfileSave.style.display).toBe("");

    expect(await screen.findByRole("region", { name: "Pengaturan Pengiriman" })).not.toBeNull();
    expect(await screen.findByRole("region", { name: "Pengaturan Pembayaran" })).not.toBeNull();
    expect(await screen.findByRole("region", { name: "Teknis" })).not.toBeNull();
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
    expect(await within(paymentPanel).findByText("Midtrans Server Key")).not.toBeNull();
    expect(within(paymentPanel).getByText("Mode Midtrans")).not.toBeNull();
    const serverKeyInput = within(paymentPanel).getByLabelText("Midtrans Server Key") as HTMLInputElement;
    expect(serverKeyInput.value).toBe("");
    expect(serverKeyInput.placeholder).toBe("Kosongkan jika tidak diganti");
    expect(within(paymentPanel).getByRole("switch", { name: "Mode Midtrans" }).getAttribute("aria-checked")).toBe("false");
    expect(within(paymentPanel).getByText("Sandbox untuk uji coba. Produksi untuk transaksi pelanggan.")).not.toBeNull();
    expect(paymentPanel.textContent).not.toContain("Ganti kunci server tanpa menampilkan nilai saat ini.");
    expect(paymentPanel.textContent).not.toContain("Sandbox untuk uji coba, Produksi untuk transaksi pelanggan.");

    expect(within(paymentPanel).queryByText("midtrans.server_key")).toBeNull();
    expect(within(paymentPanel).queryByText("midtrans.is_production")).toBeNull();
    expect(within(paymentPanel).queryByText("Tidak diketahui")).toBeNull();
    expect(within(paymentPanel).queryByText("Wajib untuk runtime")).toBeNull();
    expect(within(paymentPanel).queryByText("Terakhir dibaca runtime")).toBeNull();
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
    const serverKeyInput = await within(paymentPanel).findByLabelText("Midtrans Server Key") as HTMLInputElement;
    const serverKeyRow = serverKeyInput.closest("div")?.parentElement as HTMLElement;

    fireEvent.click(within(serverKeyRow).getByRole("button", { name: "Simpan" }));
    expect(mocks.functionsInvoke.mock.calls.some((call) => call[1]?.body?.action === "rotateSecret")).toBe(false);

    fireEvent.change(serverKeyInput, { target: { value: "TEST_NEW_MIDTRANS_SERVER_KEY" } });
    fireEvent.click(within(serverKeyRow).getByRole("button", { name: "Simpan" }));

    await waitFor(() => expect(mocks.functionsInvoke).toHaveBeenCalledWith("integration-config", {
      body: {
        action: "rotateSecret",
        key: "midtrans.server_key",
        secret: "TEST_NEW_MIDTRANS_SERVER_KEY",
        reason: "settings_payment_save",
      },
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
    const modeSwitch = await within(paymentPanel).findByRole("switch", { name: "Mode Midtrans" });
    const modeRow = modeSwitch.closest("div")?.parentElement as HTMLElement;

    fireEvent.click(modeSwitch);
    fireEvent.click(within(modeRow).getByRole("button", { name: "Simpan" }));

    await waitFor(() => expect(mocks.functionsInvoke).toHaveBeenCalledWith("integration-config", {
      body: {
        action: "updateValue",
        key: "midtrans.is_production",
        value: true,
        reason: "settings_payment_save",
      },
    }));
    const updateBody = mocks.functionsInvoke.mock.calls.find((call) => call[1]?.body?.action === "updateValue")?.[1]?.body;
    expect(updateBody).not.toHaveProperty("source");
  });


  it("shipping runtime renders concise integration-backed controls without duplicate public settings editors", async () => {
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
    expect(within(shippingPanel).getByLabelText("Shipper Name")).not.toBeNull();
    expect(within(shippingPanel).getByLabelText("Shipper Phone")).not.toBeNull();
    expect(within(shippingPanel).getByLabelText("Shipper Email")).not.toBeNull();
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
    }));
    const rotateBody = mocks.functionsInvoke.mock.calls.find((call) => call[1]?.body?.key === "biteship.api_key")?.[1]?.body;
    expect(rotateBody).not.toHaveProperty("source");
    await waitFor(() => expect(apiKeyInput.value).toBe(""));

    fireEvent.click(within(shippingPanel).getByRole("button", { name: "CourierPickerModal" }));
    const courierRow = within(shippingPanel).getByText("Active Couriers").closest("div")?.parentElement as HTMLElement;
    fireEvent.click(within(courierRow).getByRole("button", { name: "Simpan" }));
    await waitFor(() => expect(mocks.functionsInvoke).toHaveBeenCalledWith("integration-config", {
      body: {
        action: "updateValue",
        key: "biteship.enabled_couriers",
        value: ["jne:reg"],
        reason: "settings_shipping_save",
      },
    }));

    fireEvent.click(within(shippingPanel).getByRole("button", { name: "BiteshipAreaSearch" }));
    const areaRow = within(shippingPanel).getByText("Origin Area").closest("div")?.parentElement as HTMLElement;
    fireEvent.click(within(areaRow).getByRole("button", { name: "Simpan" }));
    await waitFor(() => expect(mocks.functionsInvoke).toHaveBeenCalledWith("integration-config", {
      body: {
        action: "updateValue",
        key: "biteship.origin_area_id",
        value: "area-runtime-1",
        reason: "settings_shipping_save",
      },
    }));
    await waitFor(() => expect(mocks.functionsInvoke).toHaveBeenCalledWith("integration-config", {
      body: {
        action: "updateValue",
        key: "biteship.origin_postal_code",
        value: "12110",
        reason: "settings_shipping_save",
      },
    }));

    fireEvent.click(within(shippingPanel).getByRole("button", { name: "MapLocationPicker" }));
    const locationRow = within(shippingPanel).getByText("Store Location").closest("div")?.parentElement as HTMLElement;
    fireEvent.click(within(locationRow).getByRole("button", { name: "Simpan" }));
    await waitFor(() => expect(mocks.functionsInvoke).toHaveBeenCalledWith("integration-config", {
      body: {
        action: "updateValue",
        key: "biteship.origin_latitude",
        value: "-6.244100",
        reason: "settings_shipping_save",
      },
    }));
    await waitFor(() => expect(mocks.functionsInvoke).toHaveBeenCalledWith("integration-config", {
      body: {
        action: "updateValue",
        key: "biteship.origin_longitude",
        value: "106.799500",
        reason: "settings_shipping_save",
      },
    }));

    const shipperNameInput = within(shippingPanel).getByLabelText("Shipper Name");
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
    }));

    const updateBodies = mocks.functionsInvoke.mock.calls
      .map((call) => call[1]?.body)
      .filter((body) => body?.action === "updateValue" || body?.action === "rotateSecret");
    expect(updateBodies.every((body) => !Object.prototype.hasOwnProperty.call(body, "source"))).toBe(true);
    expect(onFinish).not.toHaveBeenCalled();
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

    render(
      <OperationalConfigRow
        row={row}
        actions={<ConfigDetailsDisclosure row={row} auditRows={[auditRow]} lastRuntimeRead={runtimeRead} />}
      />
    );

    expect(screen.getByText("Midtrans Server Key")).not.toBeNull();
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

    const advancedPanel = await screen.findByRole("region", { name: "Teknis" });
    expect(await within(advancedPanel).findByLabelText("Expo Push Token")).not.toBeNull();
    expect(within(advancedPanel).getByLabelText("Allowed Origins")).not.toBeNull();
    expect(within(advancedPanel).getByRole("button", { name: "Lihat audit teknis" })).not.toBeNull();

    expect(advancedPanel.textContent).not.toContain("Midtrans Server Key");
    expect(advancedPanel.textContent).not.toContain("Mode Midtrans");
    expect(advancedPanel.textContent).not.toContain("Biteship API Key");
    expect(advancedPanel.textContent).not.toContain("Active Couriers");
    expect(advancedPanel.textContent).not.toContain("Shipper Name");
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

  it("details drawer shows sanitized metadata only", async () => {
    mocks.useForm.mockReturnValue({
      formProps: {},
      saveButtonProps: {},
      form: {
        setFieldValue: mocks.setFieldValue,
        getFieldValue: mocks.getFieldValue,
      },
    });

    renderWithQueryClient(<Settings />);

    const advancedPanel = await screen.findByRole("region", { name: "Teknis" });
    expect(document.body.textContent).not.toContain("request-1");
    expect(document.body.textContent).not.toContain("request-runtime-read");
    expect(document.body.textContent).not.toContain("version-secret");
    expect(document.body.textContent).not.toContain("admin_gateway");
    expect(document.body.textContent).not.toContain("PLAINTEXT_SENTINEL_DO_NOT_RENDER");

    fireEvent.click(within(advancedPanel).getByRole("button", { name: "Lihat audit teknis" }));

    expect(screen.getByRole("dialog")).not.toBeNull();
    expect(document.body.textContent).toContain("Payment configuration");
    expect(document.body.textContent).toContain("secret_rotated");
    expect(document.body.textContent).toContain("Key: midtrans.server_key");
    expect(document.body.textContent).toContain("Version ID: version-secret");
    expect(document.body.textContent).toContain("Version: 2");
    expect(document.body.textContent).toContain("Request: request-1");
    expect(document.body.textContent).toContain("Request: request-runtime-read");
    expect(document.body.textContent).toContain("Actor role: admin");
    expect(document.body.textContent).toContain("Actor ID: admin-1");
    expect(document.body.textContent).toContain("Actor role: service_role");
    expect(document.body.textContent).toContain("Source: admin_gateway");
    expect(document.body.textContent).toContain("Source: edge_function");
    expect(document.body.textContent).toContain("Reason: scheduled rotation");
    expect(document.body.textContent).toContain("Old: SB-Mid-****1234");
    expect(document.body.textContent).toContain("New: SB-Mid-****7890");
    expect(document.body.textContent).not.toContain("PLAINTEXT_SENTINEL_DO_NOT_RENDER");
  });

  it("advanced technical settings rotates the Expo push token with a hidden reason", async () => {
    mocks.useForm.mockReturnValue({
      formProps: {},
      saveButtonProps: {},
      form: {
        setFieldValue: mocks.setFieldValue,
        getFieldValue: mocks.getFieldValue,
      },
    });

    renderWithQueryClient(<Settings />);

    const advancedPanel = await screen.findByRole("region", { name: "Teknis" });
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
    }));
    const rotateBody = mocks.functionsInvoke.mock.calls.find((call) => call[1]?.body?.key === "push.expo_access_token")?.[1]?.body;
    expect(rotateBody).not.toHaveProperty("source");
    await waitFor(() => expect(pushTokenInput.value).toBe(""));
  });

  it("advanced technical settings sends CORS origins updates as arrays", async () => {
    mocks.useForm.mockReturnValue({
      formProps: {},
      saveButtonProps: {},
      form: {
        setFieldValue: mocks.setFieldValue,
        getFieldValue: mocks.getFieldValue,
      },
    });

    renderWithQueryClient(<Settings />);

    const advancedPanel = await screen.findByRole("region", { name: "Teknis" });
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
    }));
    const updateBody = mocks.functionsInvoke.mock.calls.find((call) => call[1]?.body?.key === "cors.allowed_origins")?.[1]?.body;
    expect(updateBody).not.toHaveProperty("source");
    expect(advancedPanel.textContent).not.toContain("Reason");
  });

  it("advanced technical settings shows safe loading and gateway errors without raw response internals", async () => {
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

    const advancedPanel = await screen.findByRole("region", { name: "Teknis" });
    expect(within(advancedPanel).getByText("Loading technical settings...")).not.toBeNull();

    resolveSummary?.({ data: { error: "Only admin can manage integration config PLAINTEXT_SENTINEL_DO_NOT_RENDER" }, error: null });
    resolveAudit?.({ data: { error: "Only admin can manage integration config PLAINTEXT_SENTINEL_DO_NOT_RENDER" }, error: null });

    expect(await within(advancedPanel).findByText("Technical settings could not be loaded.")).not.toBeNull();
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
