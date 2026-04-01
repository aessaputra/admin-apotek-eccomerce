import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "../App";

const captured: {
  refineProps?: Record<string, unknown>;
  documentTitleHandler?: ((params: { resource?: { name?: string }; action?: string; params?: { id?: string } }) => string) | undefined;
} = {};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, defaultMessageOrOptions?: string | Record<string, unknown>) =>
      typeof defaultMessageOrOptions === "string" ? defaultMessageOrOptions : key,
    i18n: {
      language: "id",
      resolvedLanguage: "id",
      changeLanguage: vi.fn(),
    },
  }),
}));

vi.mock("react-router", () => ({
  BrowserRouter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Routes: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Route: ({ element, children }: { element?: React.ReactNode; children?: React.ReactNode }) => <div>{element}{children}</div>,
  Outlet: () => <div>outlet</div>,
}));

vi.mock("@refinedev/core", () => ({
  Authenticated: ({ children, fallback }: { children: React.ReactNode; fallback?: React.ReactNode }) => <div>{children}{fallback}</div>,
  GitHubBanner: () => <div>GitHubBanner</div>,
  Refine: ({ children, ...props }: { children: React.ReactNode }) => {
    captured.refineProps = props;
    return <div>{children}</div>;
  },
}));

vi.mock("@refinedev/devtools", () => ({
  DevtoolsPanel: () => <div>DevtoolsPanel</div>,
  DevtoolsProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@refinedev/kbar", () => ({
  RefineKbar: () => <div>RefineKbar</div>,
  RefineKbarProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@refinedev/antd", () => ({
  AuthPage: () => <div>AuthPage</div>,
  ErrorComponent: () => <div>ErrorComponent</div>,
  ThemedLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ThemedSider: () => <div>ThemedSider</div>,
  useNotificationProvider: vi.fn(),
}));

vi.mock("@refinedev/react-router", () => ({
  default: {},
  CatchAllNavigate: ({ to }: { to: string }) => <div>{to}</div>,
  DocumentTitleHandler: ({ handler }: { handler: typeof captured.documentTitleHandler }) => {
    captured.documentTitleHandler = handler;
    return <div>DocumentTitleHandler</div>;
  },
  NavigateToResource: () => <div>NavigateToResource</div>,
  UnsavedChangesNotifier: () => <div>UnsavedChangesNotifier</div>,
}));

vi.mock("@refinedev/supabase", () => ({
  liveProvider: vi.fn(() => ({ live: true })),
}));

vi.mock("antd", () => ({
  App: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("../contexts/color-mode", () => ({
  ColorModeContextProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("../components/header", () => ({ Header: () => <div>Header</div> }));
vi.mock("../components/layout/auth-title", () => ({ AuthTitle: () => <div>AuthTitle</div> }));
vi.mock("../components/layout/title", () => ({ Title: () => <div>Title</div> }));
vi.mock("../providers/auth", () => ({ default: { auth: true } }));
vi.mock("../providers/data", () => ({ dataProvider: { data: true } }));
vi.mock("../providers/supabase-client", () => ({ supabaseClient: { client: true } }));
vi.mock("../pages/dashboard", () => ({ Dashboard: () => <div>Dashboard</div> }));
vi.mock("../pages/orders/list", () => ({ OrderList: () => <div>OrderList</div> }));
vi.mock("../pages/orders/show", () => ({ OrderShow: () => <div>OrderShow</div> }));
vi.mock("../pages/customers/list", () => ({ CustomerList: () => <div>CustomerList</div> }));
vi.mock("../pages/customers/show", () => ({ CustomerShow: () => <div>CustomerShow</div> }));
vi.mock("../pages/products/list", () => ({ ProductList: () => <div>ProductList</div> }));
vi.mock("../pages/products/create", () => ({ ProductCreate: () => <div>ProductCreate</div> }));
vi.mock("../pages/products/edit", () => ({ ProductEdit: () => <div>ProductEdit</div> }));
vi.mock("../pages/products/show", () => ({ ProductShow: () => <div>ProductShow</div> }));
vi.mock("../pages/categories/list", () => ({ CategoryList: () => <div>CategoryList</div> }));
vi.mock("../pages/categories/create", () => ({ CategoryCreate: () => <div>CategoryCreate</div> }));
vi.mock("../pages/categories/edit", () => ({ CategoryEdit: () => <div>CategoryEdit</div> }));
vi.mock("../pages/categories/show", () => ({ CategoryShow: () => <div>CategoryShow</div> }));
vi.mock("../pages/profile", () => ({ Profile: () => <div>Profile</div> }));
vi.mock("../pages/reports/sales", () => ({ SalesReport: () => <div>SalesReport</div> }));
vi.mock("../pages/settings", () => ({ Settings: () => <div>Settings</div> }));

describe("App", () => {
  it("registers core Refine resources and document title behavior", () => {
    render(<App />);

    const resources = (captured.refineProps?.resources as Array<{ name: string }>) ?? [];
    expect(resources.map((resource) => resource.name)).toEqual([
      "dashboard",
      "orders",
      "profiles",
      "stores",
      "products",
      "categories",
      "salesReports",
      "settings",
      "report_daily_sales",
      "report_product_sales",
      "report_customer_sales",
    ]);

    expect(captured.refineProps?.options).toEqual({
      syncWithLocation: true,
      warnWhenUnsavedChanges: true,
    });
    expect(screen.getByText("DocumentTitleHandler")).not.toBeNull();
    expect(screen.getByText("UnsavedChangesNotifier")).not.toBeNull();
    expect(screen.getByText("RefineKbar")).not.toBeNull();
  });

  it("builds document titles from resource, action, and params", () => {
    render(<App />);

    const handler = captured.documentTitleHandler;
    expect(handler).toBeTypeOf("function");

    if (!handler) {
      throw new Error("Document title handler was not captured");
    }

    expect(handler({ resource: { name: "orders" }, action: "show", params: { id: "123" } })).toBe("#123 actions.show resources.orders | Pharmacy");
    expect(handler({ resource: { name: "products" }, action: "create", params: {} })).toBe("actions.create resources.products | Pharmacy");
    expect(handler({})).toBe("Dashboard | Pharmacy");
  });
});
