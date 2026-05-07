import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrderShow } from "../orders/show";

const mocks = vi.hoisted(() => {
  const formValues = {
    status: "processing",
    waybill_number: "WB123",
    waybill_override_reason: "",
  };

  const resetFormValues = () => {
    formValues.status = "processing";
    formValues.waybill_number = "WB123";
    formValues.waybill_override_reason = "";
  };

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
  const refetch = vi.fn();
  const from = vi.fn();
  const invoke = vi.fn();

  return {
    translate,
    useShow,
    success,
    error,
    confirm,
    setFieldsValue,
    refetch,
    from,
    invoke,
    formValues,
    resetFormValues,
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
        onFinish?.({
          status: mocks.formValues.status,
          waybill_number: mocks.formValues.waybill_number,
          waybill_override_reason: mocks.formValues.waybill_override_reason,
        });
      }}
    >
      {children}
    </form>
  );

  const Form = Object.assign(FormComponent, {
    Item: ({ children, label }: { children: React.ReactNode; label?: React.ReactNode }) => <div><div>{label}</div>{children}</div>,
    useForm: () => [{ setFieldsValue: (values: Record<string, unknown>) => {
      if (typeof values.status === "string") {
        mocks.formValues.status = values.status;
      }
      if (typeof values.waybill_number === "string") {
        mocks.formValues.waybill_number = values.waybill_number;
      }
      if (typeof values.waybill_override_reason === "string") {
        mocks.formValues.waybill_override_reason = values.waybill_override_reason;
      }
      mocks.setFieldsValue(values);
    } }],
  });

  const Table = ({ dataSource = [], columns = [], locale, scroll }: { dataSource?: Record<string, unknown>[]; columns?: Array<{ title?: React.ReactNode; dataIndex?: unknown; key?: string; render?: (value: unknown, record: Record<string, unknown>) => React.ReactNode }>; locale?: { emptyText?: React.ReactNode }; scroll?: { x?: string | number | boolean } }) => (
    <div data-testid="order-items-table" data-scroll-x={String(scroll?.x ?? "")}>
      {dataSource.length === 0 && locale?.emptyText ? <div>{locale.emptyText}</div> : null}
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
    ({ children, style, styles }: { children: React.ReactNode; style?: React.CSSProperties; styles?: { label?: React.CSSProperties; content?: React.CSSProperties } }) => (
      <div
        data-testid="order-descriptions"
        data-label-min-width={String(styles?.label?.minWidth ?? "")}
        data-content-overflow-wrap={String(styles?.content?.overflowWrap ?? "")}
        style={style}
      >
        {children}
      </div>
    ),
    {
      Item: ({ label, children }: { label: React.ReactNode; children: React.ReactNode }) => <div><div>{label}</div><div>{children}</div></div>,
    }
  );

  return {
    Typography: {
      Title: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
      Text: ({ children, copyable, style }: { children: React.ReactNode; copyable?: boolean; style?: React.CSSProperties }) => (
        <span style={style}>
          {children}
          {copyable ? <button type="button" aria-label={`copy ${String(children)}`}>copy</button> : null}
        </span>
      ),
    },
    theme: {
      useToken: () => ({
        token: {
          marginXXS: 4,
          marginXS: 8,
          marginMD: 16,
          marginLG: 24,
          paddingXXS: 4,
          paddingSM: 12,
          paddingLG: 24,
          fontSizeSM: 12,
          lineHeightSM: 1.5,
          screenMD: 768,
          colorTextTertiary: "#999",
          colorWarning: "#faad14",
        },
      }),
    },
    Table,
    Tag: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
    Descriptions,
    Form,
    Select: ({ options, disabled }: { options?: Array<{ label: string; value: string }>; disabled?: boolean }) => (
      <select
        aria-label="status-select"
        value={mocks.formValues.status}
        disabled={disabled}
        onChange={(event) => {
          mocks.formValues.status = event.target.value;
        }}
      >
        {options?.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    ),
    Input: Object.assign(
      ({ placeholder, disabled }: { placeholder?: string; disabled?: boolean }) => (
        <input
          aria-label={placeholder ?? "input"}
          disabled={disabled}
          value={mocks.formValues.waybill_number}
          onChange={(event) => {
            mocks.formValues.waybill_number = event.target.value;
          }}
        />
      ),
      {
        TextArea: ({ placeholder }: { placeholder?: string }) => (
          <textarea
            aria-label={placeholder ?? "textarea"}
            value={mocks.formValues.waybill_override_reason}
            onChange={(event) => {
              mocks.formValues.waybill_override_reason = event.target.value;
            }}
          />
        ),
      }
    ),
    Button: ({ children, onClick, htmlType, loading, disabled }: { children: React.ReactNode; onClick?: () => void; htmlType?: "submit" | "button"; loading?: boolean; disabled?: boolean; size?: "small" | "middle" | "large" }) => <button type={htmlType ?? "button"} onClick={onClick} data-loading={String(Boolean(loading))} disabled={disabled}>{children}</button>,
    Card: ({ title, children }: { title?: React.ReactNode; children: React.ReactNode; style?: React.CSSProperties; styles?: { body?: React.CSSProperties } }) => <div><div>{title}</div>{children}</div>,
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
    Alert: ({ message, description, action }: { message: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode }) => <div role="alert"><div>{message}</div><div>{description}</div><div>{action}</div></div>,
    Space: ({ children, style, wrap }: { children: React.ReactNode; direction?: "horizontal" | "vertical"; size?: number; style?: React.CSSProperties; wrap?: boolean }) => <div data-wrap={String(Boolean(wrap))} style={style}>{children}</div>,
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
    mocks.resetFormValues();
    mocks.translate.mockClear();
    mocks.useShow.mockReset();
    mocks.success.mockReset();
    mocks.error.mockReset();
    mocks.confirm.mockReset();
    mocks.setFieldsValue.mockReset();
    mocks.refetch.mockReset();
    mocks.refetch.mockResolvedValue(undefined);
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
        customer: {
          full_name: "Alice Customer",
          phone_number: "+628123456789",
          email: "alice@example.com",
        },
        shipping_address: {
          receiver_name: "Alice Receiver",
          phone_number: "+628987654321",
          street_address: "Jl. Merdeka No. 1",
          area_name: "Coblong",
          city: "Bandung",
          province: "Jawa Barat",
          postal_code: "40111",
          address_note: "Dekat apotek",
          country_code: "ID",
        },
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
      query: { isLoading: false, refetch: mocks.refetch },
    });
    mocks.invoke.mockResolvedValue({ data: { data: { status: "shipped" } }, error: null });

    render(<OrderShow />);

    expect(mocks.useShow).toHaveBeenCalledWith();

    await waitFor(() => {
      expect(mocks.setFieldsValue).toHaveBeenCalledWith({ status: "processing", waybill_number: "WB123" });
    });

    expect(screen.getByText("order-1")).not.toBeNull();
    expect(screen.getAllByText("orders.currentOrderStatus")).toHaveLength(1);
    expect(screen.getAllByText("orders.currentPaymentStatus")).toHaveLength(1);
    expect(screen.getByText("orders.nextOrderStatus")).not.toBeNull();
    expect(screen.getByText("orders.actionsTitle")).not.toBeNull();
    expect(screen.getByText("orders.actionsDescription")).not.toBeNull();
    expect(screen.getByText("orders.productList")).not.toBeNull();
    expect(screen.getByText("orders.buyerAndShipping")).not.toBeNull();
    expect(screen.getByText("orders.totalAndShipping")).not.toBeNull();
    expect(screen.getByText("orders.activityTitle")).not.toBeNull();
    expect(screen.getByText("Alice Customer")).not.toBeNull();
    expect(screen.getByText("alice@example.com")).not.toBeNull();
    expect(screen.getByText("Alice Receiver")).not.toBeNull();
    expect(screen.getByText("Jl. Merdeka No. 1, Coblong, Bandung, Jawa Barat, 40111, ID")).not.toBeNull();
    expect(screen.getByText("Dekat apotek")).not.toBeNull();
    expect(screen.queryByText("orders.fields.status")).toBeNull();
    expect(screen.getAllByText("paymentStatus.settlement")).toHaveLength(1);
    expect(screen.getByText("Vitamin C")).not.toBeNull();
    expect(screen.queryByTestId("order-descriptions")).toBeNull();
    expect(screen.getAllByText((content) => content.replace(/\s/g, " ") === "Rp 25.000").length).toBeGreaterThan(0);
    expect(screen.getAllByText((content) => content.includes("1 Apr 2026") && content.includes("07.00")).length).toBeGreaterThan(0);
    const actionsTitle = screen.getByText("orders.actionsTitle");
    const productTitle = screen.getByText("orders.productList");
    const buyerTitle = screen.getByText("orders.buyerAndShipping");
    const totalTitle = screen.getByText("orders.totalAndShipping");
    const activityTitle = screen.getByText("orders.activityTitle");
    expect(Boolean(actionsTitle.compareDocumentPosition(productTitle) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(Boolean(productTitle.compareDocumentPosition(buyerTitle) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(Boolean(buyerTitle.compareDocumentPosition(totalTitle) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(Boolean(totalTitle.compareDocumentPosition(activityTitle) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(screen.getByRole("button", { name: "copy MID-1" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "copy TX-1" })).not.toBeNull();
    expect(screen.getAllByRole("button", { name: "copy WB123" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "copy BT-1" })).not.toBeNull();
    expect(
      screen.getByText((content) => content.includes("orderStatus.awaiting_shipment")),
    ).not.toBeNull();
    expect(screen.queryByText("orderStatus.paid")).toBeNull();
    expect(screen.getAllByRole("button", { name: "orders.syncTracking" })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "orders.syncTracking" }));

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith("order-manager", {
        body: {
          action: "sync_tracking",
          orderId: "order-1",
        },
      });
      expect(mocks.refetch).toHaveBeenCalledTimes(1);
      expect(mocks.success).toHaveBeenCalled();
    });
  });

  it("keeps long order and shipping identifiers readable in narrow detail layouts", async () => {
    const longOrderId = "order-2026-05-07-very-long-admin-read-model-identifier";
    const longMidtransOrderId = "MIDTRANS-ORDER-20260507-0000000000000000000001";
    const longTransactionId = "MIDTRANS-TRANSACTION-20260507-ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const longWaybill = "JNE-REG-WAYBILL-20260507-0000000000000000000002";
    const longBiteshipOrderId = "BITESHIP-ORDER-20260507-0000000000000000000003";
    const longTrackingId = "BITESHIP-TRACKING-20260507-0000000000000000000004";

    mocks.useShow.mockReturnValue({
      result: {
        id: longOrderId,
        total_amount: 25000,
        status: "processing",
        payment_status: "settlement",
        waybill_number: longWaybill,
        waybill_source: "manual",
        midtrans_order_id: longMidtransOrderId,
        midtrans_transaction_id: longTransactionId,
        biteship_order_id: longBiteshipOrderId,
        biteship_tracking_id: longTrackingId,
        created_at: "2026-04-01T00:00:00.000Z",
        order_items: [
          { id: "item-long", quantity: 1, price_at_purchase: 25000, products: { name: "Vitamin C" } },
        ],
      },
      query: { isLoading: false, refetch: mocks.refetch },
    });

    render(<OrderShow />);

    await waitFor(() => {
      expect(mocks.setFieldsValue).toHaveBeenCalledWith({ status: "processing", waybill_number: longWaybill });
    });

    expect(screen.queryByTestId("order-descriptions")).toBeNull();
    expect((screen.getByText(longOrderId) as HTMLElement).style.overflowWrap).toBe("break-word");
    expect((screen.getByText(longMidtransOrderId) as HTMLElement).style.display).toBe("inline-flex");
    expect((screen.getByText(longTransactionId) as HTMLElement).style.wordBreak).toBe("normal");
    expect(screen.getAllByRole("button", { name: `copy ${longWaybill}` })).toHaveLength(2);
    expect(screen.getByRole("button", { name: `copy ${longBiteshipOrderId}` })).not.toBeNull();
    expect(screen.getByRole("button", { name: `copy ${longTrackingId}` })).not.toBeNull();
    expect(screen.getAllByText(longWaybill)[0].closest("[data-wrap='true']")).not.toBeNull();
    expect(screen.getByTestId("order-items-table").getAttribute("data-scroll-x")).toBe("max-content");
  });

  it("does not render copy controls for blank external IDs or waybills", async () => {
    mocks.useShow.mockReturnValue({
      result: {
        id: "order-blank-copy",
        total_amount: 25000,
        status: "processing",
        payment_status: "settlement",
        waybill_number: "   ",
        midtrans_order_id: "",
        midtrans_transaction_id: "   ",
        biteship_order_id: null,
        biteship_tracking_id: "",
        created_at: "2026-04-01T00:00:00.000Z",
        order_items: [],
      },
      query: { isLoading: false, refetch: mocks.refetch },
    });

    render(<OrderShow />);

    await waitFor(() => {
      expect(mocks.setFieldsValue).toHaveBeenCalledWith({ status: "processing", waybill_number: "   " });
    });

    expect(screen.getByRole("button", { name: "copy order-blank-copy" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "copy -" })).toBeNull();
    expect(screen.getAllByRole("button", { name: /^copy / })).toHaveLength(1);
  });

  it("renders a clear error alert when the primary order load fails", () => {
    mocks.useShow.mockReturnValue({
      result: undefined,
      query: { isLoading: false, error: new Error("network down"), refetch: mocks.refetch },
    });

    render(<OrderShow />);

    expect(screen.getByRole("alert")).not.toBeNull();
    expect(screen.getByText("Detail pesanan tidak dapat dimuat")).not.toBeNull();
    expect(screen.getByText("network down")).not.toBeNull();
    expect(screen.queryByText("orders.orderInfo")).toBeNull();
  });

  it("announces activity loading with visible status text", async () => {
    mocks.from.mockReturnValueOnce({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(() => ({
            limit: vi.fn().mockReturnValue(new Promise(() => undefined)),
          })),
        })),
      })),
    });
    mocks.useShow.mockReturnValue({
      result: {
        id: "order-loading-activity",
        total_amount: 0,
        status: "processing",
        payment_status: "settlement",
        created_at: "2026-04-01T00:00:00.000Z",
        order_items: [],
      },
      query: { isLoading: false, refetch: mocks.refetch },
    });

    render(<OrderShow />);

    const status = await screen.findByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(screen.getByText("Memuat aktivitas pesanan...")).not.toBeNull();
  });

  it("renders order item SKU snapshots with an explicit fallback for legacy rows", async () => {
    mocks.useShow.mockReturnValue({
      result: {
        id: "order-sku",
        total_amount: 40000,
        status: "processing",
        payment_status: "settlement",
        created_at: "2026-04-01T00:00:00.000Z",
        order_items: [
          {
            id: "item-with-sku",
            quantity: 1,
            price_at_purchase: 25000,
            product_sku_at_purchase: "VIT-C-001",
            products: { name: "Vitamin C" },
          },
          {
            id: "item-null-sku",
            quantity: 1,
            price_at_purchase: 15000,
            product_sku_at_purchase: null,
            products: { name: "Legacy Product" },
          },
          {
            id: "item-blank-sku",
            quantity: 1,
            price_at_purchase: 5000,
            product_sku_at_purchase: "   ",
            products: { name: "Blank SKU Product" },
          },
        ],
      },
      query: { isLoading: false, refetch: mocks.refetch },
    });

    render(<OrderShow />);

    await waitFor(() => {
      expect(mocks.setFieldsValue).toHaveBeenCalledWith({ status: "processing", waybill_number: "" });
    });

    expect(screen.getByText("orders.fields.sku")).not.toBeNull();
    expect(screen.getByText("VIT-C-001")).not.toBeNull();
    expect(screen.getAllByText("SKU belum tersimpan")).toHaveLength(2);
    expect(screen.getByTestId("order-items-table").getAttribute("data-scroll-x")).toBe("max-content");
  });

  it("renders localized empty product and activity error states", async () => {
    mocks.from.mockReturnValueOnce({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue({ data: null, error: new Error("activity failed") }),
          })),
        })),
      })),
    });
    mocks.useShow.mockReturnValue({
      result: {
        id: "order-empty",
        total_amount: 0,
        status: "processing",
        payment_status: "settlement",
        created_at: "2026-04-01T00:00:00.000Z",
        order_items: [],
      },
      query: { isLoading: false, refetch: mocks.refetch },
    });

    render(<OrderShow />);

    await waitFor(() => {
      expect(screen.getByText("orders.activity.loadErrorTitle")).not.toBeNull();
    });
    expect(screen.getByText("orders.activity.loadErrorDescription")).not.toBeNull();
    expect(screen.getByText("orders.empty.productItems")).not.toBeNull();
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
      query: { isLoading: false, refetch: mocks.refetch },
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
      query: { isLoading: false, refetch: mocks.refetch },
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
      query: { isLoading: false, refetch: mocks.refetch },
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
      query: { isLoading: false, refetch: mocks.refetch },
    });

    render(<OrderShow />);

    await waitFor(() => {
      expect(mocks.setFieldsValue).toHaveBeenCalledWith({ status: "shipped", waybill_number: "WB999" });
    });

    expect(screen.getByRole("option", { name: "orderStatus.shipped" })).not.toBeNull();
    expect(screen.getByRole("option", { name: "orderStatus.in_transit" })).not.toBeNull();
    expect(screen.getByRole("option", { name: "orderStatus.delivered" })).not.toBeNull();
  });

  it("keeps Biteship-managed shipped orders sync-driven by hiding manual downstream status options", async () => {
    mocks.useShow.mockReturnValue({
      result: {
        id: "order-3b",
        total_amount: 25000,
        status: "shipped",
        payment_status: "settlement",
        biteship_order_id: "BT-3b",
        biteship_tracking_id: "TR-3b",
        waybill_number: "WB1000",
        waybill_source: "system",
        created_at: "2026-04-01T00:00:00.000Z",
        order_items: [],
      },
      query: { isLoading: false, refetch: mocks.refetch },
    });

    render(<OrderShow />);

    await waitFor(() => {
      expect(mocks.setFieldsValue).toHaveBeenCalledWith({ status: "shipped", waybill_number: "WB1000" });
    });

    expect(screen.getByRole("option", { name: "orderStatus.shipped" })).not.toBeNull();
    expect(screen.queryByRole("option", { name: "orderStatus.in_transit" })).toBeNull();
    expect(screen.queryByRole("option", { name: "orderStatus.delivered" })).toBeNull();
    expect(screen.getByRole("button", { name: "buttons.save" }).hasAttribute("disabled")).toBe(true);
  });

  it("keeps Biteship-managed in_transit orders sync-driven by hiding manual delivery transition", async () => {
    mocks.useShow.mockReturnValue({
      result: {
        id: "order-3c",
        total_amount: 25000,
        status: "in_transit",
        payment_status: "settlement",
        biteship_order_id: "BT-3c",
        biteship_tracking_id: "TR-3c",
        waybill_number: "WB1001",
        waybill_source: "system",
        created_at: "2026-04-01T00:00:00.000Z",
        order_items: [],
      },
      query: { isLoading: false, refetch: mocks.refetch },
    });

    render(<OrderShow />);

    await waitFor(() => {
      expect(mocks.setFieldsValue).toHaveBeenCalledWith({ status: "in_transit", waybill_number: "WB1001" });
    });

    expect(screen.queryByRole("option", { name: "orderStatus.delivered" })).toBeNull();
    expect(screen.getByRole("button", { name: "buttons.save" }).hasAttribute("disabled")).toBe(true);
  });

  it("hides manual waybill entry by default for Biteship-managed awaiting_shipment orders", async () => {
    mocks.useShow.mockReturnValue({
      result: {
        id: "order-6",
        total_amount: 25000,
        status: "awaiting_shipment",
        payment_status: "settlement",
        biteship_order_id: "BT-6",
        biteship_tracking_id: "TR-6",
        created_at: "2026-04-01T00:00:00.000Z",
        order_items: [],
      },
      query: { isLoading: false, refetch: mocks.refetch },
    });

    render(<OrderShow />);

    await waitFor(() => {
      expect(mocks.setFieldsValue).toHaveBeenCalledWith({ status: "awaiting_shipment", waybill_number: "" });
    });

    expect(screen.getByRole("option", { name: "orderStatus.cancelled" })).not.toBeNull();
    expect(screen.queryByRole("option", { name: "orderStatus.shipped" })).toBeNull();
    expect(screen.queryByLabelText("orders.waybillPlaceholder")).toBeNull();
    expect(screen.getByText("orders.providerManagedWaybillHelp")).not.toBeNull();
  });

  it("shows manual waybill override controls after enabling override mode", async () => {
    mocks.useShow.mockReturnValue({
      result: {
        id: "order-7",
        total_amount: 25000,
        status: "awaiting_shipment",
        payment_status: "settlement",
        biteship_order_id: "BT-7",
        waybill_number: "AUTO-12345",
        waybill_source: "system",
        created_at: "2026-04-01T00:00:00.000Z",
        order_items: [],
      },
      query: { isLoading: false, refetch: mocks.refetch },
    });

    render(<OrderShow />);

    await waitFor(() => {
      expect(mocks.setFieldsValue).toHaveBeenCalledWith({ status: "awaiting_shipment", waybill_number: "AUTO-12345" });
    });

    fireEvent.click(screen.getByRole("checkbox"));

    expect(screen.getByLabelText("orders.waybillPlaceholder")).not.toBeNull();
    expect(screen.getByLabelText("orders.waybillOverridePlaceholder")).not.toBeNull();
    expect(screen.getByText("orders.manualWaybillWarning")).not.toBeNull();
    expect(screen.getByRole("option", { name: "orderStatus.shipped" })).not.toBeNull();
    expect(screen.getByRole("option", { name: "orderStatus.cancelled" })).not.toBeNull();
  });

  it("submits a manual override payload for Biteship-managed shipped transitions", async () => {
    mocks.useShow.mockReturnValue({
      result: {
        id: "order-8",
        total_amount: 25000,
        status: "awaiting_shipment",
        payment_status: "settlement",
        biteship_order_id: "BT-8",
        waybill_number: "AUTO-12345",
        waybill_source: "system",
        created_at: "2026-04-01T00:00:00.000Z",
        order_items: [],
      },
      query: { isLoading: false, refetch: mocks.refetch },
    });
    mocks.invoke.mockResolvedValue({ data: { data: { status: "shipped" } }, error: null });

    render(<OrderShow />);

    await waitFor(() => {
      expect(mocks.setFieldsValue).toHaveBeenCalledWith({ status: "awaiting_shipment", waybill_number: "AUTO-12345" });
    });

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByRole("combobox", { name: "status-select" }), {
      target: { value: "shipped" },
    });
    fireEvent.change(screen.getByLabelText("orders.waybillPlaceholder"), {
      target: { value: "MANUAL-9988" },
    });
    fireEvent.change(screen.getByLabelText("orders.waybillOverridePlaceholder"), {
      target: { value: "Provider resi unavailable during handoff" },
    });

    fireEvent.click(screen.getByRole("button", { name: "buttons.save" }));

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith("order-manager", {
        body: {
          action: "transition_status",
          orderId: "order-8",
          payload: {
            to: "shipped",
            waybill_number: "MANUAL-9988",
            waybill_source: "manual",
            waybill_override_reason: "Provider resi unavailable during handoff",
          },
        },
      });
    });
  });
});
