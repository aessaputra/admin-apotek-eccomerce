import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Settings from "../settings";
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
    Item: ({ children, label }: { children: React.ReactNode; label?: React.ReactNode }) => <div><div>{label}</div>{children}</div>,
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
      onBlur,
      onChange,
      placeholder,
      readOnly,
    }: {
      onBlur?: (event: React.FocusEvent<HTMLInputElement>) => void;
      onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
      placeholder?: string;
      readOnly?: boolean;
    }) => (
      <input
        aria-label={placeholder ?? "input"}
        onBlur={onBlur}
        onChange={onChange}
        readOnly={readOnly}
      />
    ),
    {
      TextArea: ({
        placeholder,
        rows,
        maxLength,
        showCount,
        disabled,
        value,
        onChange,
        style,
      }: {
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
          aria-label={placeholder ?? "textarea"}
          data-maxlength={maxLength}
          data-rows={rows}
          data-showcount={showCount ? "true" : "false"}
          data-disabled={disabled ? "true" : "false"}
          value={value}
          onChange={onChange}
          style={style}
        />
      ),
      Password: ({ placeholder }: { placeholder?: string }) => <input aria-label={placeholder ?? "password"} type="password" />,
    }
  );

  const Typography = {
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
    Row: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Col: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Upload: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Typography,
    theme,
    Button: ({ children, onClick, htmlType, type, size, icon }: { children?: React.ReactNode; onClick?: () => void; htmlType?: "submit" | "button"; type?: string; size?: string; icon?: React.ReactNode }) => <button type={htmlType ?? "button"} data-type={type} data-size={size} onClick={onClick}>{icon}{children}</button>,
    Space,
    Tag: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
    Divider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Modal: ({ children, open, title, footer }: { children: React.ReactNode; open?: boolean; title?: React.ReactNode; footer?: React.ReactNode }) => open ? <div role="dialog"><div>{title}</div>{children}{footer}</div> : null,
    message: {
      error: mocks.messageError,
      success: mocks.messageSuccess,
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
    from: mocks.supabaseFrom,
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

    return render(
      <QueryClientProvider client={queryClient}>
        {ui}
      </QueryClientProvider>
    );
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

  it("renders nothing for profile without identity and shows password mismatch feedback when loaded", () => {
    mocks.useGetIdentity.mockReturnValueOnce({ data: null }).mockReturnValueOnce({ data: { id: "user-1" } });
    mocks.useForm.mockReturnValue({ formProps: {}, saveButtonProps: {} });

    const { container, rerender } = render(<Profile />);
    expect(container.textContent).toBe("");

    rerender(<Profile />);
    expect(screen.getByText("AvatarUpload")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "profile.changePassword" }));
    expect(mocks.messageError).toHaveBeenCalledWith("profile.passwordMismatch");
  });
});
