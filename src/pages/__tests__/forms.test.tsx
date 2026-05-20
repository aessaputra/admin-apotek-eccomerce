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
  Edit: ({ children, title }: { children: React.ReactNode; title?: React.ReactNode }) => <div><div>{title}</div>{children}</div>,
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
  BiteshipAreaSearch: () => <div>BiteshipAreaSearch</div>,
}));

vi.mock("../../components/map-location-picker", () => ({
  MapLocationPicker: () => <div>MapLocationPicker</div>,
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
          <input aria-label={ariaLabel ?? placeholder ?? "password"} value={value} onChange={onChange} type="password" />
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
    Tabs: ({ items }: { items?: Array<{ label: React.ReactNode; children: React.ReactNode }> }) => <div>{items?.map((item) => <div key={String(item.label)}>{item.label}{item.children}</div>)}</div>,
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
        return Promise.resolve({
          data: {
            data: [
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
            ],
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

  it("renders settings page and writes courier selections back to the form", () => {
    mocks.useForm.mockReturnValue({
      formProps: {},
      saveButtonProps: {},
      form: {
        setFieldValue: mocks.setFieldValue,
        getFieldValue: mocks.getFieldValue,
      },
    });

    renderWithQueryClient(<Settings />);

    expect(screen.getByText("BiteshipAreaSearch")).not.toBeNull();
    expect(screen.getByText("MapLocationPicker")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "CourierPickerModal" }));
    expect(mocks.setFieldValue).toHaveBeenCalledWith("enabled_couriers", "jne:reg");
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
    expect(document.body.textContent).toContain("midtrans.server_key");
    expect(document.body.textContent).toContain("version-secret");
    expect(document.body.textContent).toContain("request-runtime-read");
    expect(document.body.textContent).toContain("request-1");
    expect(document.body.textContent).toContain("scheduled rotation");
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

  it("renders masked integration config and every required audit field without plaintext sentinels", async () => {
    mocks.useForm.mockReturnValue({
      formProps: {},
      saveButtonProps: {},
      form: {
        setFieldValue: mocks.setFieldValue,
        getFieldValue: mocks.getFieldValue,
      },
    });

    renderWithQueryClient(<Settings />);

    expect(await screen.findAllByText("SB-Mid-****7890")).not.toHaveLength(0);
    expect(document.body.textContent).toContain("SB-Mid-****1234");
    expect(document.body.textContent).toContain(`Last runtime read: ${new Date("2026-05-19T11:00:00Z").toLocaleString("id-ID")}`);
    expect(document.body.textContent).toContain("request-runtime-read");
    expect(document.body.textContent).toContain("Last runtime read: -");
    expect(document.body.textContent).toContain("secret_rotated");
    expect(document.body.textContent).toContain("midtrans.server_key");
    expect(document.body.textContent).toContain("Old: SB-Mid-****1234");
    expect(document.body.textContent).toContain("New: SB-Mid-****7890");
    expect(document.body.textContent).toContain("1 → 2");
    expect(document.body.textContent).toContain("admin");
    expect(document.body.textContent).toContain("admin-1");
    expect(document.body.textContent).toContain("admin_gateway");
    expect(document.body.textContent).toContain("scheduled rotation");
    expect(document.body.textContent).toContain(new Date("2026-05-19T10:00:00Z").toLocaleString("id-ID"));
    expect(document.body.textContent).toContain("request-1");
    expect(screen.queryByText("PLAINTEXT_SENTINEL_DO_NOT_RENDER")).toBeNull();
    expect(document.body.textContent).not.toContain("PLAINTEXT_SENTINEL_DO_NOT_RENDER");
    expect(mocks.functionsInvoke).toHaveBeenCalledWith("integration-config", { body: { action: "summary", keys: undefined } });
    expect(mocks.functionsInvoke).toHaveBeenCalledWith("integration-config", { body: { action: "audit", key: undefined, limit: 50 } });
  });

  it("shows safe loading and non-admin gateway errors without raw response internals", async () => {
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

    expect(await screen.findAllByText("Loading integration configuration...")).not.toHaveLength(0);
    expect(screen.getByText("Loading audit trail...")).not.toBeNull();

    resolveSummary?.({ data: { error: "Only admin can manage integration config PLAINTEXT_SENTINEL_DO_NOT_RENDER" }, error: null });
    resolveAudit?.({ data: { error: "Only admin can manage integration config PLAINTEXT_SENTINEL_DO_NOT_RENDER" }, error: null });

    expect(await screen.findAllByText("Integration configuration could not be loaded.")).not.toHaveLength(0);
    expect(screen.getByText("Audit trail could not be loaded.")).not.toBeNull();
    expect(document.body.textContent).not.toContain("Only admin can manage integration config");
    expect(document.body.textContent).not.toContain("PLAINTEXT_SENTINEL_DO_NOT_RENDER");
  });

  it("renders safe localized gateway errors for update failures without plaintext response data", async () => {
    mocks.useForm.mockReturnValue({
      formProps: {},
      saveButtonProps: {},
      form: {
        setFieldValue: mocks.setFieldValue,
        getFieldValue: mocks.getFieldValue,
      },
    });

    renderWithQueryClient(<Settings />);

    fireEvent.change(await screen.findByLabelText("New value for midtrans.is_production"), { target: { value: "true" } });
    fireEvent.click(screen.getByRole("button", { name: "Save value" }));
    expect(mocks.messageError).toHaveBeenCalledWith("Enter a reason.");
    expect(mocks.functionsInvoke.mock.calls.some((call) => call[1]?.body?.action === "updateValue")).toBe(false);

    mocks.messageError.mockClear();
    mocks.functionsInvoke.mockImplementation((_name: string, { body }: { body: Record<string, unknown> }) => {
      if (body.action === "summary") {
        return Promise.resolve({ data: { data: [] }, error: null });
      }

      if (body.action === "audit") {
        return Promise.resolve({ data: { data: [] }, error: null });
      }

      if (body.action === "updateValue") {
        return Promise.resolve({ data: { error: "Validation failed for PLAINTEXT_SENTINEL_DO_NOT_RENDER" }, error: null });
      }

      return Promise.resolve({ data: { data: { ok: true } }, error: null });
    });

    fireEvent.change(screen.getByLabelText("Reason for midtrans.is_production"), { target: { value: "enable production mode" } });
    fireEvent.click(screen.getByRole("button", { name: "Save value" }));

    await waitFor(() => expect(mocks.functionsInvoke).toHaveBeenCalledWith("integration-config", {
      body: {
        action: "updateValue",
        key: "midtrans.is_production",
        value: true,
        reason: "enable production mode",
      },
    }));
    await waitFor(() => expect(mocks.messageError).toHaveBeenCalledWith("Configuration update failed."));
    expect(mocks.messageError.mock.calls.flat().join(" ")).not.toContain("PLAINTEXT_SENTINEL_DO_NOT_RENDER");
    expect(document.body.textContent).not.toContain("PLAINTEXT_SENTINEL_DO_NOT_RENDER");
  });

  it("sends text_array integration config updates as arrays", async () => {
    mocks.useForm.mockReturnValue({
      formProps: {},
      saveButtonProps: {},
      form: {
        setFieldValue: mocks.setFieldValue,
        getFieldValue: mocks.getFieldValue,
      },
    });
    mocks.functionsInvoke.mockImplementation((_name: string, { body }: { body: Record<string, unknown> }) => {
      if (body.action === "summary") {
        return Promise.resolve({
          data: {
            data: [
              {
                key_name: "biteship.enabled_couriers",
                display_name: "Enabled couriers",
                description: "Allowed Biteship courier services",
                value_kind: "text_array",
                is_secret: false,
                is_required: true,
                is_runtime_required: true,
                version_id: "version-couriers",
                version_number: 1,
                status: "active",
                masked_value: null,
                value_fingerprint: null,
                non_secret_value: ["jne:reg"],
                updated_by: "admin-1",
                updated_at: "2026-05-19T09:00:00Z",
              },
            ],
          },
          error: null,
        });
      }

      if (body.action === "audit") {
        return Promise.resolve({ data: { data: [] }, error: null });
      }

      return Promise.resolve({ data: { data: { ok: true } }, error: null });
    });

    renderWithQueryClient(<Settings />);

    fireEvent.change(await screen.findByLabelText("New value for biteship.enabled_couriers"), {
      target: { value: "jne:reg, grab:instant" },
    });
    fireEvent.change(screen.getByLabelText("Reason for biteship.enabled_couriers"), {
      target: { value: "refresh enabled courier list" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save value" }));

    await waitFor(() => expect(mocks.functionsInvoke).toHaveBeenCalledWith("integration-config", {
      body: {
        action: "updateValue",
        key: "biteship.enabled_couriers",
        value: ["jne:reg", "grab:instant"],
        reason: "refresh enabled courier list",
      },
    }));
  });

  it("requires rotate secret, confirmation phrase, and reason before calling the gateway", async () => {
    mocks.useForm.mockReturnValue({
      formProps: {},
      saveButtonProps: {},
      form: {
        setFieldValue: mocks.setFieldValue,
        getFieldValue: mocks.getFieldValue,
      },
    });

    renderWithQueryClient(<Settings />);

    fireEvent.click((await screen.findAllByRole("button", { name: "Rotate secret" }))[0]);
    expect(screen.getByRole("dialog")).not.toBeNull();
    expect((screen.getByLabelText("New secret") as HTMLInputElement).value).toBe("");

    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Rotate secret" }));

    expect(await screen.findByText("Enter the new secret.")).not.toBeNull();
    expect(screen.getByText("Type ROTATE to confirm.")).not.toBeNull();
    expect(screen.getByText("Enter a reason.")).not.toBeNull();
    expect(mocks.functionsInvoke.mock.calls.some((call) => call[1]?.body?.action === "rotateSecret")).toBe(false);

    fireEvent.change(screen.getByLabelText("New secret"), { target: { value: "TEST_NEW_SECRET_SENTINEL" } });
    fireEvent.change(screen.getByLabelText("Type ROTATE"), { target: { value: "ROTATE" } });
    fireEvent.change(screen.getByLabelText("Rotation reason"), { target: { value: "scheduled rotation" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Rotate secret" }));

    await waitFor(() => expect(mocks.functionsInvoke).toHaveBeenCalledWith("integration-config", {
      body: {
        action: "rotateSecret",
        key: "midtrans.server_key",
        secret: "TEST_NEW_SECRET_SENTINEL",
        reason: "scheduled rotation",
      },
    }));
    await waitFor(() => expect(mocks.messageSuccess).toHaveBeenCalledWith("Secret rotated safely."));
  });

  it("keeps rotate secret input masked and removes the password reveal control", async () => {
    mocks.useForm.mockReturnValue({
      formProps: {},
      saveButtonProps: {},
      form: {
        setFieldValue: mocks.setFieldValue,
        getFieldValue: mocks.getFieldValue,
      },
    });

    renderWithQueryClient(<Settings />);

    fireEvent.click((await screen.findAllByRole("button", { name: "Rotate secret" }))[0]);
    const secretInput = screen.getByLabelText("New secret") as HTMLInputElement;

    expect(within(screen.getByRole("dialog")).queryByRole("button", { name: /password visibility toggle/i })).toBeNull();
    expect(secretInput.type).toBe("password");

    fireEvent.change(secretInput, { target: { value: "TEST_NEW_SECRET_SENTINEL" } });

    expect(secretInput.type).toBe("password");
    expect(secretInput.value).toBe("TEST_NEW_SECRET_SENTINEL");
  });

  it("renders safe localized gateway errors for rotate failures without plaintext response data", async () => {
    mocks.useForm.mockReturnValue({
      formProps: {},
      saveButtonProps: {},
      form: {
        setFieldValue: mocks.setFieldValue,
        getFieldValue: mocks.getFieldValue,
      },
    });
    mocks.functionsInvoke.mockImplementation((_name: string, { body }: { body: Record<string, unknown> }) => {
      if (body.action === "summary") {
        return Promise.resolve({
          data: {
            data: [
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
                non_secret_value: null,
                updated_by: "admin-1",
                updated_at: "2026-05-19T09:00:00Z",
              },
            ],
          },
          error: null,
        });
      }

      if (body.action === "audit") {
        return Promise.resolve({ data: { data: [] }, error: null });
      }

      if (body.action === "rotateSecret") {
        return Promise.resolve({ data: { error: "Validation failed for TEST_NEW_SECRET_SENTINEL" }, error: null });
      }

      return Promise.resolve({ data: { data: { ok: true } }, error: null });
    });

    renderWithQueryClient(<Settings />);

    fireEvent.click((await screen.findAllByRole("button", { name: "Rotate secret" }))[0]);
    fireEvent.change(screen.getByLabelText("New secret"), { target: { value: "TEST_NEW_SECRET_SENTINEL" } });
    fireEvent.change(screen.getByLabelText("Type ROTATE"), { target: { value: "ROTATE" } });
    fireEvent.change(screen.getByLabelText("Rotation reason"), { target: { value: "emergency rotation" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Rotate secret" }));

    await waitFor(() => expect(mocks.messageError).toHaveBeenCalledWith("Secret rotation failed."));
    expect(mocks.messageError.mock.calls.flat().join(" ")).not.toContain("TEST_NEW_SECRET_SENTINEL");
    expect(document.body.textContent).not.toContain("TEST_NEW_SECRET_SENTINEL");
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
