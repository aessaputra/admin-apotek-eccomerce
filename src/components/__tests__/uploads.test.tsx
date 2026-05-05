import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AvatarUpload } from "../avatar-upload";
import { CategoryLogoUpload } from "../category-logo-upload";
import { ProductImageUpload } from "../product-image-upload";

const mocks = vi.hoisted(() => {
  const beforeUpload = vi.fn();
  const customRequest = vi.fn();
  const handleRemove = vi.fn();
  const uploadProps: unknown[] = [];

  return {
    beforeUpload,
    customRequest,
    handleRemove,
    uploadProps,
  };
});

vi.mock("../../hooks/useSupabaseUpload", () => ({
  useSupabaseUpload: vi.fn(() => ({
    beforeUpload: mocks.beforeUpload,
    customRequest: mocks.customRequest,
    handleRemove: mocks.handleRemove,
  })),
}));

vi.mock("@refinedev/core", () => ({
  useTranslation: () => ({ translate: (key: string) => key }),
}));

vi.mock("antd", () => ({
  Upload: (props: {
    children?: React.ReactNode;
    onRemove?: ((file?: unknown) => void) | undefined;
    fileList?: Array<{ url?: string }>;
    maxCount?: number;
    multiple?: boolean;
    accept?: string;
  }) => {
    mocks.uploadProps.push(props);

    return (
      <div>
        <div data-testid="upload-max-count">{String(props.maxCount ?? "")}</div>
        <div data-testid="upload-multiple">{String(Boolean(props.multiple))}</div>
        <div data-testid="upload-accept">{props.accept}</div>
        <div data-testid="upload-file-count">{String(props.fileList?.length ?? 0)}</div>
        <button type="button" onClick={() => props.onRemove?.({ url: props.fileList?.[0]?.url })}>
          remove
        </button>
        {props.children}
      </div>
    );
  },
}));

describe("upload components", () => {
  it("renders AvatarUpload with replacement semantics and existing file state", () => {
    render(
      <AvatarUpload
        value="https://demo.supabase.co/storage/v1/object/public/media/avatars/user.png"
      />
    );

    expect(screen.getByTestId("upload-max-count").textContent).toBe("1");
    expect(screen.getByTestId("upload-file-count").textContent).toBe("1");
    expect(screen.queryByText("+ Upload")).toBeNull();

    const lastProps = mocks.uploadProps[mocks.uploadProps.length - 1] as Record<string, unknown>;
    expect(lastProps["aria-label"]).toBe("profile.fields.avatarUpload");
  });

  it("delegates avatar removal to the upload hook", () => {
    render(
      <AvatarUpload
        value="https://demo.supabase.co/storage/v1/object/public/media/avatars/user.png"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "remove" }));

    expect(mocks.handleRemove).toHaveBeenCalledWith(
      "https://demo.supabase.co/storage/v1/object/public/media/avatars/user.png"
    );
  });

  it("renders AvatarUpload empty state with accessible label", () => {
    render(<AvatarUpload />);

    expect(screen.getByTestId("upload-file-count").textContent).toBe("0");
    expect(screen.getByText("profile.fields.avatarUploadButton")).not.toBeNull();

    const lastProps = mocks.uploadProps[mocks.uploadProps.length - 1] as Record<string, unknown>;
    expect(lastProps["aria-label"]).toBe("profile.fields.avatarUpload");
  });

  it("renders CategoryLogoUpload empty state when there is no logo", () => {
    render(<CategoryLogoUpload />);

    expect(screen.getByTestId("upload-file-count").textContent).toBe("0");
    expect(screen.getByText("+ Upload")).not.toBeNull();
  });

  it("renders ProductImageUpload with multiple uploads enabled and hides prompt at max count", () => {
    render(
      <ProductImageUpload
        value={Array.from({ length: 10 }, (_, index) => `https://example.com/product-${index}.png`)}
      />
    );

    expect(screen.getByTestId("upload-max-count").textContent).toBe("10");
    expect(screen.getByTestId("upload-multiple").textContent).toBe("true");
    expect(screen.getByTestId("upload-file-count").textContent).toBe("10");
    expect(screen.queryByText("+ Upload")).toBeNull();
  });

  it("extracts the image url from the Upload file object before delegating removal", () => {
    render(
      <ProductImageUpload
        value={["https://demo.supabase.co/storage/v1/object/public/media/products/first.png"]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "remove" }));

    expect(mocks.handleRemove).toHaveBeenCalledWith(
      "https://demo.supabase.co/storage/v1/object/public/media/products/first.png"
    );
  });
});
