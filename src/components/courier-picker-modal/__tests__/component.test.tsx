import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CourierPickerModal from "..";

const mocks = vi.hoisted(() => {
  const translate = vi.fn((key: string, params?: Record<string, unknown>, fallback?: string) => {
    if (key === "settings.courierPicker.servicesSelected") {
      return `${params?.selected} of ${params?.total} services enabled`;
    }

    if (key === "settings.courierPicker.subtitle") {
      return `${params?.selected} of ${params?.total} services selected`;
    }

    return fallback ?? key;
  });

  return { translate };
});

vi.mock("@refinedev/core", () => ({
  useTranslation: () => ({ translate: mocks.translate }),
}));

vi.mock("@ant-design/icons", () => ({
  SearchOutlined: () => <span>search</span>,
}));

vi.mock("antd", () => ({
  Modal: ({ title, open, onOk, onCancel, okText, cancelText, children, okButtonProps }: {
    title: React.ReactNode;
    open: boolean;
    onOk: () => void;
    onCancel: () => void;
    okText: string;
    cancelText: string;
    children: React.ReactNode;
    okButtonProps?: { disabled?: boolean };
  }) =>
    open ? (
      <div>
        <div>{title}</div>
        <button type="button" onClick={onOk} disabled={okButtonProps?.disabled}>
          {okText}
        </button>
        <button type="button" onClick={onCancel}>
          {cancelText}
        </button>
        {children}
      </div>
    ) : null,
  Switch: ({ checked, disabled, onChange, "aria-label": ariaLabel }: {
    checked: boolean;
    disabled?: boolean;
    onChange: () => void;
    "aria-label"?: string;
  }) => <input aria-label={ariaLabel} type="checkbox" checked={checked} disabled={disabled} onChange={onChange} />,
  Typography: {
    Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
    Title: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  },
  Space: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Tag: ({ children, onClick }: { children: React.ReactNode; onClick?: (event: { preventDefault: () => void; stopPropagation: () => void }) => void }) => (
    <button
      type="button"
      onClick={() =>
        onClick?.({
          preventDefault() {},
          stopPropagation() {},
        })
      }
    >
      {children}
    </button>
  ),
  Empty: ({ description }: { description: React.ReactNode }) => <div>{description}</div>,
  Spin: () => <div>loading</div>,
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Collapse: ({ items }: { items: Array<{ label: React.ReactNode; children: React.ReactNode }> }) => (
    <div>
      {items.map((item) => (
        <div key={String(item.label)}>
          <div>{item.label}</div>
          <div>{item.children}</div>
        </div>
      ))}
    </div>
  ),
  Input: ({ value, onChange, placeholder }: { value?: string; onChange: (event: { target: { value: string } }) => void; placeholder?: string }) => (
    <input aria-label={placeholder ?? "search"} value={value} onChange={onChange} />
  ),
  theme: {
    useToken: () => ({
      token: {
        colorPrimaryBorder: "#1677ff",
        colorBorderSecondary: "#d9d9d9",
        colorBgElevated: "#fff",
        colorBgContainer: "#fff",
        colorTextDescription: "#999",
      },
    }),
  },
}));

const couriers = [
  {
    key: "jne:reg",
    companyCode: "jne",
    companyLabel: "JNE",
    serviceCode: "reg",
    serviceLabel: "Regular",
    description: "Regular service",
  },
  {
    key: "jne:yes",
    companyCode: "jne",
    companyLabel: "JNE",
    serviceCode: "yes",
    serviceLabel: "YES",
    description: "Fast service",
  },
  {
    key: "grab:instant",
    companyCode: "grab",
    companyLabel: "GrabExpress",
    serviceCode: "instant",
    serviceLabel: "Instant",
    description: "Instant courier",
  },
];

describe("CourierPickerModal component", () => {
  beforeEach(() => {
    mocks.translate.mockClear();
  });

  it("renders grouped courier services and confirms selected values", () => {
    const onConfirm = vi.fn();

    render(
      <CourierPickerModal
        open
        value={["jne:reg"]}
        couriers={couriers}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText("Select Active Couriers")).not.toBeNull();
    expect(screen.getByText("JNE")).not.toBeNull();
    expect(screen.getByText("GrabExpress")).not.toBeNull();
    expect(screen.getByLabelText("Toggle JNE Regular")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onConfirm).toHaveBeenCalledWith(["jne:reg"]);
  });

  it("supports select-all and clear-all actions", () => {
    const onConfirm = vi.fn();

    render(
      <CourierPickerModal
        open
        value={[]}
        couriers={couriers}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Select All" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onConfirm).toHaveBeenLastCalledWith(["jne:reg", "jne:yes", "grab:instant"]);

    fireEvent.click(screen.getByRole("button", { name: "Clear All" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onConfirm).toHaveBeenLastCalledWith([]);
  });

  it("filters visible courier services by search input", () => {
    render(
      <CourierPickerModal
        open
        value={[]}
        couriers={couriers}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("Search courier or service"), {
      target: { value: "instant" },
    });

    expect(screen.getByText("GrabExpress")).not.toBeNull();
    expect(screen.getByText("Instant")).not.toBeNull();
    expect(screen.queryByText("Regular")).toBeNull();
  });

  it("renders loading and error fallback states", () => {
    const { rerender } = render(
      <CourierPickerModal
        open
        value={[]}
        couriers={couriers}
        loading
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText("Loading couriers...")).not.toBeNull();

    rerender(
      <CourierPickerModal
        open
        value={[]}
        couriers={[]}
        error="failed"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText("Failed to load courier list. Using default options.")).not.toBeNull();
    expect(screen.getByText("No couriers available")).not.toBeNull();
  });
});
