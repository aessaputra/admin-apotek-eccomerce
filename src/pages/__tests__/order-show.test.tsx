import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrderShow } from "../orders/show";

const mocks = vi.hoisted(() => {
  const translate = vi.fn((key: string, paramsOrFallback?: Record<string, unknown> | string, fallback?: string) => {
    if (key.startsWith("orderStatus.") || key.startsWith("paymentStatus.")) {
      return key;
    }

    if (typeof paramsOrFallback === "string") {
      return paramsOrFallback;
    }

    return fallback ?? key;
  });
  const useShow = vi.fn();
  const success = vi.fn();
  const error = vi.fn();
  const confirm = vi.fn();
  const setFieldsValue = vi.fn();
  const from = vi.fn();
  const invoke = vi.fn();

  return {
    translate,
    useShow,
    success,
    error,
    confirm,
    setFieldsValue,
    from,
    invoke,
  };
});

vi.mock("@refinedev/core", () => ({
  useTranslation: () => ({ translate: mocks.translate }),
  useShow: mocks.useShow,
}));

vi.mock("@refinedev/antd", () => ({
  Show: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DateField: ({ value }: { value?: string }) => <span>{value ?? "-"}</span>,
  NumberField: ({ value }: { value?: number | string }) => <span>{String(value ?? 0)}</span>,
}));

vi.mock("../../providers/supabase-client", () => ({
  supabaseClient: {
    from: mocks.from,
    functions: {
      invoke: mocks.invoke,
    },
  },
}));

vi.mock("../../utils/functions-error", () => ({
  getFunctionsErrorMessage: vi.fn(async (_error: unknown, fallback: string) => fallback),
}));

vi.mock("antd", async () => {
  const FormComponent = ({ children, onFinish }: { children: React.ReactNode; onFinish?: (values: Record<string, unknown>) => void }) => (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onFinish?.({ status: "processing", waybill_number: "WB123" });
      }}
    >
      {children}
    </form>
  );

  const Form = Object.assign(FormComponent, {
    Item: ({ children, label }: { children: React.ReactNode; label?: React.ReactNode }) => <div><div>{label}</div>{children}</div>,
    useForm: () => [{ setFieldsValue: mocks.setFieldsValue }],
  });

  const Table = ({ dataSource = [], columns = [] }: { dataSource?: Record<string, unknown>[]; columns?: Array<{ title?: React.ReactNode; dataIndex?: unknown; key?: string; render?: (value: unknown, record: Record<string, unknown>) => React.ReactNode }> }) => (
    <div>
      {columns.map((column) => (
        <div key={String(column.key ?? column.title)}>
          <div>{column.title}</div>
          {dataSource.map((record) => {
            const value = Array.isArray(column.dataIndex)
              ? column.dataIndex.reduce<unknown>((current, key) => {
                  if (current == null) return undefined;
                  if (typeof key === "number" && Array.isArray(current)) return current[key];
                  if (typeof current === "object") return (current as Record<string, unknown>)[String(key)];
                  return undefined;
                }, record)
              : typeof column.dataIndex === "string"
                ? record[column.dataIndex]
                : undefined;

            return <div key={String(record.id)}>{column.render ? column.render(value, record) : String(value ?? "")}</div>;
          })}
        </div>
      ))}
    </div>
  );

  const Descriptions = Object.assign(
    ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    {
      Item: ({ label, children }: { label: React.ReactNode; children: React.ReactNode }) => <div><div>{label}</div><div>{children}</div></div>,
    }
  );

  return {
    Typography: {
      Title: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
      Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
    },
    Table,
    Tag: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
    Descriptions,
    Form,
    Select: ({ options }: { options?: Array<{ label: string; value: string }> }) => <div>{options?.map((option) => option.label).join(",")}</div>,
    Input: Object.assign(
      ({ placeholder }: { placeholder?: string }) => <input aria-label={placeholder ?? "input"} />,
      {
        TextArea: ({ placeholder }: { placeholder?: string }) => <textarea aria-label={placeholder ?? "textarea"} />,
      }
    ),
    Button: ({ children, onClick, htmlType, loading }: { children: React.ReactNode; onClick?: () => void; htmlType?: "submit" | "button"; loading?: boolean }) => <button type={htmlType ?? "button"} onClick={onClick} data-loading={String(Boolean(loading))}>{children}</button>,
    Card: ({ title, children }: { title?: React.ReactNode; children: React.ReactNode }) => <div><div>{title}</div>{children}</div>,
    App: {
      useApp: () => ({
        modal: {
          success: mocks.success,
          error: mocks.error,
          confirm: mocks.confirm,
        },
      }),
    },
    Timeline: ({ items }: { items?: Array<{ children: React.ReactNode }> }) => <div>{items?.map((item, index) => <div key={index}>{item.children}</div>)}</div>,
    Spin: () => <div>loading</div>,
    Tooltip: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Switch: ({ checked, onChange }: { checked?: boolean; onChange?: (checked: boolean) => void }) => <input type="checkbox" checked={checked} onChange={() => onChange?.(!checked)} />,
    Alert: ({ message, description }: { message: React.ReactNode; description?: React.ReactNode }) => <div><div>{message}</div><div>{description}</div></div>,
    Space: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  };
});

vi.mock("@ant-design/icons", () => ({
  SyncOutlined: () => <span>sync</span>,
  InfoCircleOutlined: () => <span>info</span>,
  LockOutlined: () => <span>lock</span>,
  WarningOutlined: () => <span>warning</span>,
}));

describe("OrderShow", () => {
  beforeEach(() => {
    mocks.translate.mockClear();
    mocks.useShow.mockReset();
    mocks.success.mockReset();
    mocks.error.mockReset();
    mocks.confirm.mockReset();
    mocks.setFieldsValue.mockReset();
    mocks.from.mockReset();
    mocks.invoke.mockReset();

    mocks.from.mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue({
              data: [
                {
                  id: "act-1",
                  action: "status_update",
                  old_status: "pending",
                  new_status: "processing",
                  actor_type: "admin",
                  metadata: {},
                  created_at: "2026-04-01T10:00:00.000Z",
                },
                {
                  id: "act-2",
                  action: "sync_tracking",
                  old_status: "in_transit",
                  new_status: "in_transit",
                  actor_type: "admin",
                  metadata: {
                    biteship_exception_status: "on_hold",
                    biteship_exception_alert_type: "warning",
                    biteship_exception_message_key: "on_hold",
                  },
                  created_at: "2026-04-02T10:00:00.000Z",
                },
              ],
              error: null,
            }),
          })),
        })),
      })),
    });
  });

  it("renders order details, initializes the form, and syncs tracking", async () => {
    mocks.useShow.mockReturnValue({
      result: {
        id: "order-1",
        total_amount: 25000,
        status: "processing",
        payment_status: "settlement",
        shipping_cost: 10000,
        courier_code: "jne",
        courier_service: "reg",
        shipping_etd: "2 days",
        waybill_number: "WB123",
        waybill_source: "manual",
        payment_type: "bank_transfer",
        midtrans_order_id: "MID-1",
        midtrans_transaction_id: "TX-1",
        biteship_order_id: "BT-1",
        created_at: "2026-04-01T00:00:00.000Z",
        updated_at: "2026-04-02T00:00:00.000Z",
        order_items: [
          { id: "item-1", quantity: 2, price_at_purchase: 5000, products: { name: "Vitamin C" } },
        ],
      },
      query: { isLoading: false },
    });
    mocks.invoke.mockResolvedValue({ data: { data: { status: "shipped" } }, error: null });

    render(<OrderShow />);

    await waitFor(() => {
      expect(mocks.setFieldsValue).toHaveBeenCalledWith({ status: "processing", waybill_number: "WB123" });
    });

    expect(screen.getByText("order-1")).not.toBeNull();
    expect(screen.getByText("paymentStatus.settlement")).not.toBeNull();
    expect(screen.getByText("Vitamin C")).not.toBeNull();
    expect(
      screen.getByText((content) => content.includes("orderStatus.awaiting_shipment")),
    ).not.toBeNull();
    expect(screen.queryByText("orderStatus.paid")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "orders.syncTracking" }));

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith("order-manager", {
        body: {
          action: "sync_tracking",
          orderId: "order-1",
        },
      });
      expect(mocks.success).toHaveBeenCalled();
    });
  });

  it("hides sync action for terminal biteship orders", async () => {
    mocks.useShow.mockReturnValue({
      result: {
        id: "order-2",
        total_amount: 25000,
        status: "delivered",
        payment_status: "settlement",
        biteship_order_id: "BT-2",
        created_at: "2026-04-01T00:00:00.000Z",
        order_items: [],
      },
      query: { isLoading: false },
    });

    render(<OrderShow />);

    await waitFor(() => {
      expect(mocks.setFieldsValue).toHaveBeenCalledWith({ status: "delivered", waybill_number: "" });
    });

    expect(screen.queryByRole("button", { name: "orders.syncTracking" })).toBeNull();
  });

  it("renders a biteship warning when the latest sync reports an exception state", async () => {
    mocks.useShow.mockReturnValue({
      result: {
        id: "order-4",
        total_amount: 25000,
        status: "in_transit",
        payment_status: "settlement",
        biteship_order_id: "BT-4",
        biteship_tracking_id: "TR-4",
        created_at: "2026-04-01T00:00:00.000Z",
        order_items: [],
      },
      query: { isLoading: false },
    });

    render(<OrderShow />);

    await waitFor(() => {
      expect(mocks.setFieldsValue).toHaveBeenCalledWith({ status: "in_transit", waybill_number: "" });
    });

    expect(screen.getByText("orders.biteshipAlertTitle")).not.toBeNull();
    expect(screen.getByText("orders.biteshipAlertUnknown")).not.toBeNull();
    expect(screen.getByText((content) => content.includes("orders.biteshipAlertStatusLabel") && content.includes("On Hold"))).not.toBeNull();
  });

  it("does not keep showing an old biteship warning after a newer healthy sync", async () => {
    mocks.from.mockReturnValueOnce({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue({
              data: [
                {
                  id: "act-healthy",
                  action: "sync_tracking",
                  old_status: "shipped",
                  new_status: "in_transit",
                  actor_type: "admin",
                  metadata: {
                    biteship_status: "dropping_off",
                    biteship_status_mapped: true,
                  },
                  created_at: "2026-04-03T10:00:00.000Z",
                },
                {
                  id: "act-old-warning",
                  action: "sync_tracking",
                  old_status: "in_transit",
                  new_status: "in_transit",
                  actor_type: "admin",
                  metadata: {
                    biteship_exception_status: "on_hold",
                    biteship_exception_alert_type: "warning",
                    biteship_exception_message_key: "on_hold",
                  },
                  created_at: "2026-04-02T10:00:00.000Z",
                },
              ],
              error: null,
            }),
          })),
        })),
      })),
    });

    mocks.useShow.mockReturnValue({
      result: {
        id: "order-5",
        total_amount: 25000,
        status: "in_transit",
        payment_status: "settlement",
        biteship_order_id: "BT-5",
        biteship_tracking_id: "TR-5",
        created_at: "2026-04-01T00:00:00.000Z",
        order_items: [],
      },
      query: { isLoading: false },
    });

    render(<OrderShow />);

    await waitFor(() => {
      expect(mocks.setFieldsValue).toHaveBeenCalledWith({ status: "in_transit", waybill_number: "" });
    });

    expect(screen.queryByText("orders.biteshipAlertTitle")).toBeNull();
    expect(screen.queryByText("orders.biteshipAlertUnknown")).toBeNull();
  });

  it("shows only next-step status options for shipped orders", async () => {
    mocks.useShow.mockReturnValue({
      result: {
        id: "order-3",
        total_amount: 25000,
        status: "shipped",
        payment_status: "settlement",
        waybill_number: "WB999",
        created_at: "2026-04-01T00:00:00.000Z",
        order_items: [],
      },
      query: { isLoading: false },
    });

    render(<OrderShow />);

    await waitFor(() => {
      expect(mocks.setFieldsValue).toHaveBeenCalledWith({ status: "shipped", waybill_number: "WB999" });
    });

    expect(screen.getByText((content) => content.includes("orderStatus.in_transit"))).not.toBeNull();
    expect(screen.getByText((content) => content.includes("orderStatus.delivered"))).not.toBeNull();
    expect(screen.queryByText("orderStatus.shipped,orderStatus.in_transit,orderStatus.delivered")).toBeNull();
    expect(screen.getByText("orderStatus.in_transit,orderStatus.delivered")).not.toBeNull();
  });
});
