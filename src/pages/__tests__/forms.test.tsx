import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
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
  const resetFields = vi.fn();
  const getFieldValue = vi.fn((field: string) => (field === "enabled_couriers" ? "jne:reg,grab:instant" : undefined));
  const courierModalConfirm = vi.fn();

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
    resetFields,
    getFieldValue,
    courierModalConfirm,
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
  const FormComponent = ({ children, onFinish }: { children: React.ReactNode; onFinish?: (values: Record<string, unknown>) => void }) => (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onFinish?.({ password: "secret123", confirmPassword: "different" });
      }}
    >
      {children}
    </form>
  );

  const Form = Object.assign(FormComponent, {
    Item: ({ children, label }: { children: React.ReactNode; label?: React.ReactNode }) => <div><div>{label}</div>{children}</div>,
    useForm: () => [
      {
        resetFields: mocks.resetFields,
        setFieldValue: mocks.setFieldValue,
        setFieldsValue: mocks.setFieldsValue,
        getFieldValue: mocks.getFieldValue,
      },
    ],
  });

  const Input = Object.assign(
    ({ placeholder, readOnly }: { placeholder?: string; readOnly?: boolean }) => <input aria-label={placeholder ?? "input"} readOnly={readOnly} />,
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

  return {
    Form,
    Input,
    InputNumber: ({ addonAfter }: { addonAfter?: React.ReactNode }) => <div>{addonAfter ?? "InputNumber"}</div>,
    Select: ({ options, placeholder }: { options?: Array<{ label: string; value: string | boolean }>; placeholder?: string }) => <div>{placeholder ?? options?.map((option) => String(option.label)).join(",")}</div>,
    Tabs: ({ items }: { items?: Array<{ label: React.ReactNode; children: React.ReactNode }> }) => <div>{items?.map((item) => <div key={String(item.label)}>{item.label}{item.children}</div>)}</div>,
    Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Row: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Col: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Upload: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Typography,
    theme,
    Button: ({ children, onClick, htmlType, type, size, icon }: { children?: React.ReactNode; onClick?: () => void; htmlType?: "submit" | "button"; type?: string; size?: string; icon?: React.ReactNode }) => <button type={htmlType ?? "button"} data-type={type} data-size={size} onClick={onClick}>{icon}{children}</button>,
    Space: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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
    mocks.resetFields.mockReset();
    mocks.getFieldValue.mockReset();
    mocks.getFieldValue.mockImplementation((field: string) => (field === "enabled_couriers" ? "jne:reg,grab:instant" : undefined));
    mocks.courierModalConfirm.mockReset();
  });

  it("renders product create and edit forms with image upload wiring", () => {
    mocks.useForm
      .mockReturnValueOnce({ formProps: {}, saveButtonProps: {}, form: { setFieldValue: mocks.setFieldValue } })
      .mockReturnValueOnce({
        formProps: {},
        saveButtonProps: {},
        form: { setFieldValue: mocks.setFieldValue, setFieldsValue: mocks.setFieldsValue },
        query: { data: { data: { product_images: [{ id: "img-1", url: "https://example.com/one.png", sort_order: 0 }] } } },
      });

    const { rerender } = render(<ProductCreate />);
    expect(screen.getByText("ProductImageUpload")).not.toBeNull();

    rerender(<ProductEdit />);
    expect(mocks.setFieldsValue).toHaveBeenCalledWith({ images: ["https://example.com/one.png"] });
  });

  it("renders product description with edit modal flow", () => {
    mocks.useForm
      .mockReturnValueOnce({ formProps: {}, saveButtonProps: {}, form: { setFieldValue: mocks.setFieldValue } })
      .mockReturnValueOnce({
        formProps: {},
        saveButtonProps: {},
        form: { setFieldValue: mocks.setFieldValue, setFieldsValue: mocks.setFieldsValue },
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
