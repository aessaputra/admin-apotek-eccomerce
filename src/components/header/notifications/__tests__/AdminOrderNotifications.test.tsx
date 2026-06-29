import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CSSProperties, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminOrderNotifications } from "../AdminOrderNotifications";
import type { AdminOrderNotification } from "../types";

type HookResult = {
  notifications: AdminOrderNotification[];
  unreadCount: number;
  loading: boolean;
  markAsReadAndOpen: (notification: AdminOrderNotification) => Promise<string>;
};

const mocks = vi.hoisted(() => {
  const navigate = vi.fn();
  const markAsReadAndOpen = vi.fn(async (notification: AdminOrderNotification) => notification.route);
  const hookState: HookResult = {
    notifications: [],
    unreadCount: 0,
    loading: false,
    markAsReadAndOpen,
  };
  let locale: "en" | "id" = "en";

  const translations: Record<"en" | "id", Record<string, string>> = {
    en: {
      "notifications.orders.new.title": "New orders",
      "notifications.orders.new.description": "Latest admin notifications for incoming orders.",
      "notifications.orders.new.empty": "No new order notifications",
      "notifications.orders.new.unread": "Unread",
      "notifications.orders.new.open": "Open order {{orderId}}",
      "notifications.orders.new.customerUnavailable": "Customer unavailable",
      "notifications.orders.new.badgeLabel": "{{count}} unread order notifications",
      "orderStatus.pending": "Pending",
      "paymentStatus.settlement": "Settled",
    },
    id: {
      "notifications.orders.new.title": "Order baru",
      "notifications.orders.new.description": "Notifikasi admin terbaru untuk order masuk.",
      "notifications.orders.new.empty": "Belum ada notifikasi order baru",
      "notifications.orders.new.unread": "Belum dibaca",
      "notifications.orders.new.open": "Buka order {{orderId}}",
      "notifications.orders.new.customerUnavailable": "Pelanggan tidak tersedia",
      "notifications.orders.new.badgeLabel": "{{count}} notifikasi order belum dibaca",
      "orderStatus.pending": "Menunggu",
      "paymentStatus.settlement": "Lunas",
    },
  };

  const translate = vi.fn((key: string, params?: Record<string, unknown>, fallback?: string) => {
    const template = translations[locale][key] ?? fallback ?? key;

    return template.replace(/{{(\w+)}}/g, (_match: string, paramName: string) => String(params?.[paramName] ?? ""));
  });

  const reset = () => {
    locale = "en";
    navigate.mockReset();
    markAsReadAndOpen.mockReset();
    markAsReadAndOpen.mockImplementation(async (notification: AdminOrderNotification) => notification.route);
    translate.mockClear();
    hookState.notifications = [];
    hookState.unreadCount = 0;
    hookState.loading = false;
    hookState.markAsReadAndOpen = markAsReadAndOpen;
  };

  return {
    hookState,
    markAsReadAndOpen,
    navigate,
    reset,
    setLocale: (nextLocale: "en" | "id") => {
      locale = nextLocale;
    },
    translate,
  };
});

vi.mock("@refinedev/core", () => ({
  useTranslation: () => ({ translate: mocks.translate }),
}));

vi.mock("react-router", () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock("@ant-design/icons", () => ({
  BellOutlined: () => <span aria-hidden="true">bell</span>,
}));

vi.mock("../useAdminOrderNotifications", () => ({
  useAdminOrderNotifications: () => mocks.hookState,
}));

vi.mock("antd", () => {
  const Text = ({ children, style }: { children: ReactNode; style?: CSSProperties }) => (
    <span style={style}>{children}</span>
  );
  const Empty = Object.assign(
    ({ description }: { description?: ReactNode }) => <div>{description}</div>,
    { PRESENTED_IMAGE_SIMPLE: "simple" }
  );

  const List = Object.assign(
    ({
      dataSource,
      renderItem,
    }: {
      dataSource: AdminOrderNotification[];
      renderItem: (item: AdminOrderNotification) => ReactNode;
    }) => <div>{dataSource.map((item) => <div key={item.id}>{renderItem(item)}</div>)}</div>,
    {
      Item: ({ children, style }: { children: ReactNode; style?: CSSProperties }) => (
        <div style={style}>{children}</div>
      ),
    }
  );

  return {
    Badge: ({ count, overflowCount, children }: { count: number; overflowCount: number; children: ReactNode }) => (
      <div>
        <span>{count > overflowCount ? `${overflowCount}+` : count}</span>
        {children}
      </div>
    ),
    Button: ({
      children,
      icon,
      "aria-label": ariaLabel,
    }: {
      children?: ReactNode;
      icon?: ReactNode;
      "aria-label"?: string;
    }) => (
      <button type="button" aria-label={ariaLabel}>
        {icon}
        {children}
      </button>
    ),
    Dropdown: ({ children, popupRender }: { children: ReactNode; popupRender: () => ReactNode }) => (
      <div>
        {children}
        <div role="menu">{popupRender()}</div>
      </div>
    ),
    Empty,
    List,
    Space: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Spin: () => <span>loading</span>,
    Tag: ({ children }: { children: ReactNode }) => <span>{children}</span>,
    Typography: { Text },
    theme: {
      useToken: () => ({
        token: {
          borderRadiusLG: 8,
          boxShadowSecondary: "shadow-token",
          colorBgElevated: "rgb(255, 255, 255)",
          colorBorderSecondary: "rgb(240, 240, 240)",
          colorPrimary: "rgb(22, 119, 255)",
          colorPrimaryBg: "rgb(230, 244, 255)",
          fontSizeSM: 12,
          padding: 16,
          paddingLG: 24,
          paddingSM: 8,
        },
      }),
    },
  };
});

const createNotification = (overrides: Partial<AdminOrderNotification> = {}): AdminOrderNotification => ({
  id: "notification-1",
  userId: "user-1",
  title: "New order received",
  body: "Alice placed an order",
  orderId: "order-1",
  route: "/orders/show/order-1",
  customerName: "Alice",
  orderStatus: "pending",
  paymentStatus: "settlement",
  createdAt: "2026-04-29T10:00:00.000Z",
  readAt: null,
  sourceEventKey: "admin:new-order:order-1",
  ...overrides,
});

describe("AdminOrderNotifications", () => {
  beforeEach(() => {
    mocks.reset();
  });

  it("renders unread order notification dropdown content with exact badge count", () => {
    mocks.hookState.notifications = [createNotification()];
    mocks.hookState.unreadCount = 7;

    render(<AdminOrderNotifications userId="user-1" />);

    expect(screen.getByLabelText("7 unread order notifications")).not.toBeNull();
    expect(screen.getByText("7")).not.toBeNull();
    expect(screen.getByText("New orders")).not.toBeNull();
    expect(screen.getByText("Latest admin notifications for incoming orders.")).not.toBeNull();
    expect(screen.getByText("#order-1")).not.toBeNull();
    expect(screen.getByText("Alice")).not.toBeNull();
    expect(screen.getByText(new Date("2026-04-29T10:00:00.000Z").toLocaleString())).not.toBeNull();
    expect(screen.getByRole("button", { name: "Open order order-1" })).not.toBeNull();
  });

  it("uses localized customer fallback in English and Indonesian", () => {
    mocks.hookState.notifications = [createNotification({ customerName: null })];

    const { unmount } = render(<AdminOrderNotifications userId="user-1" />);
    expect(screen.getByText("Customer unavailable")).not.toBeNull();
    unmount();

    mocks.setLocale("id");
    render(<AdminOrderNotifications userId="user-1" />);

    expect(screen.getByText("Pelanggan tidak tersedia")).not.toBeNull();
    expect(screen.getByLabelText("0 notifikasi order belum dibaca")).not.toBeNull();
  });

  it("marks read then navigates to the returned order route", async () => {
    const notification = createNotification();
    mocks.hookState.notifications = [notification];
    mocks.markAsReadAndOpen.mockResolvedValueOnce("/orders/show/order-1");

    render(<AdminOrderNotifications userId="user-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Open order order-1" }));

    await waitFor(() => expect(mocks.markAsReadAndOpen).toHaveBeenCalledWith(notification));
    expect(mocks.navigate).toHaveBeenCalledWith("/orders/show/order-1");
  });

  it("renders localized empty state", () => {
    render(<AdminOrderNotifications userId="user-1" />);

    expect(screen.getByText("No new order notifications")).not.toBeNull();
  });

  it("caps the unread badge display at 99+", () => {
    mocks.hookState.unreadCount = 150;

    render(<AdminOrderNotifications userId="user-1" />);

    expect(screen.getByText("99+")).not.toBeNull();
    expect(screen.getByLabelText("150 unread order notifications")).not.toBeNull();
  });
});
