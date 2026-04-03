import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HomeBannerList } from "../home-banners/list";
import { HomeBannerCreate } from "../home-banners/create";

const mocks = vi.hoisted(() => {
  const translate = vi.fn((key: string) => key);
  const useTable = vi.fn();
  const onFinish = vi.fn();
  const confirm = vi.fn(({ onOk }: { onOk?: () => void }) => onOk?.());
  const formSubmitValues = {
    placement_key: "home_banner_top",
    intent: "branding",
    title: "Hero banner",
    body: "Short body",
    media_path: "banners/home_banner_top/banner.webp",
    cta_kind: "none",
    cta_label: null,
    cta_route: null,
    is_active: true,
  };

  return {
    translate,
    useTable,
    onFinish,
    confirm,
    formSubmitValues,
  };
});

vi.mock("@refinedev/core", () => ({
  useTranslation: () => ({ translate: mocks.translate }),
}));

vi.mock("@refinedev/antd", () => ({
  List: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Create: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useTable: mocks.useTable,
  useForm: () => ({
    formProps: {},
    saveButtonProps: {},
    form: {
      setFieldValue: vi.fn(),
      setFieldsValue: vi.fn(),
      getFieldValue: vi.fn(),
    },
    onFinish: mocks.onFinish,
  }),
  ShowButton: ({ recordItemId }: { recordItemId: string }) => <button type="button">show:{recordItemId}</button>,
  EditButton: ({ recordItemId }: { recordItemId: string }) => <button type="button">edit:{recordItemId}</button>,
  DeleteButton: ({ recordItemId }: { recordItemId: string }) => <button type="button">delete:{recordItemId}</button>,
}));

vi.mock("../../components/home-banner-media-input", () => ({
  HomeBannerMediaInput: () => <div>HomeBannerMediaInput</div>,
}));

vi.mock("../../components/home-banner-media-library", () => ({
  HomeBannerMediaLibrary: () => <div>HomeBannerMediaLibrary</div>,
}));

vi.mock("../home-banners/preview", () => ({
  HomeBannerPreview: () => <div>HomeBannerPreview</div>,
}));

vi.mock("antd", async () => {
  const ReactModule = await import("react");

  const FormComponent = ({ children, onFinish }: { children: React.ReactNode; onFinish?: (values: Record<string, unknown>) => void }) => (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onFinish?.(mocks.formSubmitValues as unknown as Record<string, unknown>);
      }}
    >
      {children}
      <button type="submit">submit</button>
    </form>
  );

  const Form = Object.assign(FormComponent, {
    Item: ({ children, label, extra, help }: { children: React.ReactNode; label?: React.ReactNode; extra?: React.ReactNode; help?: React.ReactNode }) => <div><div>{label}</div>{children}{extra ? <div>{extra}</div> : null}{help ? <div>{help}</div> : null}</div>,
    useWatch: (name: string) => (mocks.formSubmitValues as Record<string, unknown>)[name],
  });

  const Column = (props: Record<string, unknown>) => ReactModule.createElement("mock-column", props as never);

  const Table = ({ dataSource = [], children }: { dataSource?: Record<string, unknown>[]; children: React.ReactNode }) => {
    const columns = ReactModule.Children.toArray(children).filter(ReactModule.isValidElement);

    return <div>{columns.map((column, columnIndex) => {
      const props = column.props as Record<string, unknown>;
      return (
        <div key={String(column.key ?? columnIndex)}>
          <div>{String(props.title ?? "")}</div>
          {dataSource.map((record, rowIndex) => {
            const value = typeof props.dataIndex === "string" ? record[props.dataIndex] : undefined;
            const render = props.render as ((value: unknown, record: Record<string, unknown>) => React.ReactNode) | undefined;
            const rowKey = String(record.id ?? `${String(props.dataIndex ?? "column")}-${rowIndex}`);
            return <div key={rowKey}>{render ? render(value, record) : String(value ?? "")}</div>;
          })}
        </div>
      );
    })}</div>;
  };
  Table.Column = Column;

  return {
    App: {
      useApp: () => ({ modal: { confirm: mocks.confirm } }),
    },
    Form,
    Table,
    Tag: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
    Tooltip: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Space: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Flex: ({ children, gap }: { children: React.ReactNode; gap?: number }) => <div data-gap={gap}>{children}</div>,
    Input: Object.assign(({ maxLength, placeholder }: { maxLength?: number; placeholder?: string }) => <input data-maxlength={maxLength} placeholder={placeholder} />, {
      TextArea: ({ placeholder }: { placeholder?: string }) => <textarea placeholder={placeholder} />,
    }),
    Select: ({ placeholder }: { placeholder?: string }) => <select data-placeholder={placeholder} />,
    Switch: () => <input type="checkbox" />,
    Typography: {
      Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
    },
    Alert: ({ message }: { message: React.ReactNode }) => <div>{message}</div>,
    Button: ({ children, icon }: { children?: React.ReactNode; icon?: React.ReactNode }) => <button type="button">{icon}{children}</button>,
    Modal: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div data-testid="modal">{children}</div> : null,
    message: {
      error: vi.fn(),
    },
  };
});

describe("home banner admin UX", () => {
  beforeEach(() => {
    mocks.translate.mockClear();
    mocks.useTable.mockReset();
    mocks.onFinish.mockReset();
    mocks.confirm.mockClear();
    mocks.onFinish.mockResolvedValue(undefined);
  });

  it("renders list badges for placement, CTA status, image status, and active status", () => {
    mocks.useTable.mockReturnValue({
      tableProps: {
        dataSource: [
          {
            id: "banner-1",
            placement_key: "home_banner_top",
            intent: "promotional",
            title: "Promo",
            cta_kind: "route",
            media_path: "banners/home_banner_top/hero.webp",
            is_active: true,
            updated_at: "2026-04-03T00:00:00.000Z",
          },
        ],
      },
    });

    render(<HomeBannerList />);

    expect(screen.getByText("homeBanners.options.placements.home_banner_top")).not.toBeNull();
    expect(screen.getByText("homeBanners.status.withCta")).not.toBeNull();
    expect(screen.getByText("homeBanners.status.withImage")).not.toBeNull();
    expect(screen.getByText("homeBanners.status.active")).not.toBeNull();
  });

  it("renders form and confirms when saving an active banner", async () => {
    render(<HomeBannerCreate />);

    expect(screen.getByText("homeBanners.fields.placementKey")).not.toBeNull();
    expect(screen.getByText("homeBanners.fields.title")).not.toBeNull();
    expect(screen.getByText("homeBanners.fields.body")).not.toBeNull();
    expect(screen.getByText("HomeBannerMediaInput")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "submit" }));

    expect(mocks.confirm).toHaveBeenCalled();
    await waitFor(() => {
      expect(mocks.onFinish).toHaveBeenCalled();
    });
  });
});
