import type { I18nProvider } from "@refinedev/core";
import { Authenticated, GitHubBanner, Refine } from "@refinedev/core";
import { DevtoolsPanel, DevtoolsProvider } from "@refinedev/devtools";
import { RefineKbar, RefineKbarProvider } from "@refinedev/kbar";

import { AuthPage, ErrorComponent, ThemedLayout, useNotificationProvider } from "@refinedev/antd";
import "@refinedev/antd/dist/reset.css";

import {
  DashboardOutlined,
  ShoppingCartOutlined,
  UserOutlined,
  ShopOutlined,
  InboxOutlined,
  AppstoreOutlined,
  BarChartOutlined,
  SettingOutlined,
  PictureOutlined,
} from "@ant-design/icons";

import routerProvider, {
  CatchAllNavigate,
  DocumentTitleHandler,
  NavigateToResource,
  UnsavedChangesNotifier,
} from "@refinedev/react-router";
import { liveProvider } from "@refinedev/supabase";
import { App as AntdApp } from "antd";
import { BrowserRouter, Outlet, Route, Routes } from "react-router";
import { useTranslation } from "react-i18next";
import { ColorModeContextProvider } from "./contexts/color-mode";
import { Header } from "./components/header";
import { AppSider } from "./components/layout/app-sider";
import { AuthTitle } from "./components/layout/auth-title";
import { Title } from "./components/layout/title";
import { ORDER_READ_RESOURCE } from "./constants/resources";
import authProvider from "./providers/auth";
import { dataProvider } from "./providers/data";
import { supabaseClient } from "./providers/supabase-client";

import { Dashboard } from "./pages/dashboard";
import { OrderList } from "./pages/orders/list";
import { OrderShow } from "./pages/orders/show";
import { CustomerList } from "./pages/customers/list";
import { CustomerShow } from "./pages/customers/show";
import { ProductList } from "./pages/products/list";
import { ProductCreate } from "./pages/products/create";
import { ProductEdit } from "./pages/products/edit";
import { ProductShow } from "./pages/products/show";
import { CategoryList } from "./pages/categories/list";
import { CategoryCreate } from "./pages/categories/create";
import { CategoryEdit } from "./pages/categories/edit";
import { CategoryShow } from "./pages/categories/show";
import { Profile } from "./pages/profile";
import { SalesReport } from "./pages/reports/sales";
import { Settings } from "./pages/settings";
import { HomeBannerList } from "./pages/home-banners/list";
import { HomeBannerCreate } from "./pages/home-banners/create";
import { HomeBannerEdit } from "./pages/home-banners/edit";
import { HomeBannerShow } from "./pages/home-banners/show";
import { MfaVerify } from "./pages/auth/mfa-verify";
import { Login } from "./pages/auth/login";

function App() {
  const { t, i18n } = useTranslation();

  const i18nProvider: I18nProvider = {
    translate: (key: string, options?: Record<string, unknown>, defaultMessage?: string): string => {
      const result =
        defaultMessage !== undefined
          ? t(key, defaultMessage, options ?? {})
          : t(key, options ?? {});
      return typeof result === "string" ? result : String(result);
    },
    changeLocale: (lang: string) => i18n.changeLanguage(lang),
    getLocale: () => {
      const lang = i18n.language || i18n.resolvedLanguage || "id";
      return lang.startsWith("en") ? "en" : "id";
    },
  };

  return (
    <BrowserRouter>
      {import.meta.env.DEV && <GitHubBanner />}
      <RefineKbarProvider>
        <ColorModeContextProvider>
          <AntdApp>
            <DevtoolsProvider>
              <Refine
                dataProvider={dataProvider}
                liveProvider={liveProvider(supabaseClient)}
                authProvider={authProvider}
                routerProvider={routerProvider}
                notificationProvider={useNotificationProvider}
                i18nProvider={i18nProvider}
                resources={[
                  {
                    name: "dashboard",
                    list: "/",
                    meta: { icon: <DashboardOutlined /> },
                  },
                  {
                    name: "orders",
                    list: "/orders",
                    show: "/orders/show/:id",
                    meta: {
                      icon: <ShoppingCartOutlined />,
                      readResource: ORDER_READ_RESOURCE,
                    },
                  },
                  {
                    name: "profiles",
                    list: "/customers",
                    show: "/customers/show/:id",
                    meta: { icon: <UserOutlined /> },
                  },
                  {
                    name: "stores",
                    meta: { icon: <ShopOutlined /> },
                  },
                  {
                    name: "products",
                    list: "/products",
                    create: "/products/create",
                    edit: "/products/edit/:id",
                    show: "/products/show/:id",
                    meta: { parent: "stores", icon: <InboxOutlined /> },
                  },
                  {
                    name: "categories",
                    list: "/categories",
                    create: "/categories/create",
                    edit: "/categories/edit/:id",
                    show: "/categories/show/:id",
                    meta: { parent: "stores", icon: <AppstoreOutlined /> },
                  },
                  {
                    name: "salesReports",
                    list: "/reports/sales",
                    meta: { icon: <BarChartOutlined /> },
                  },
                  {
                    name: "settings",
                    list: "/settings",
                    meta: { icon: <SettingOutlined /> },
                  },
                  {
                    name: "home_banners",
                    list: "/home-banners",
                    create: "/home-banners/create",
                    edit: "/home-banners/edit/:id",
                    show: "/home-banners/show/:id",
                    meta: { parent: "stores", icon: <PictureOutlined /> },
                  },
                  { name: "report_daily_sales" },
                  { name: "report_product_sales" },
                  { name: "report_customer_sales" },
                ]}
                options={{
                  syncWithLocation: true,
                  warnWhenUnsavedChanges: true,
                }}
              >
                <Routes>
                  <Route path="/mfa-verify" element={<MfaVerify />} />
                  <Route
                    element={
                      <Authenticated
                        key="protected"
                        fallback={<CatchAllNavigate to="/login" />}
                      >
                          <ThemedLayout
                            Header={Header}
                            Title={Title}
                            Sider={({ Title }) => <AppSider Title={Title} />}
                          >
                          <Outlet />
                        </ThemedLayout>
                      </Authenticated>
                    }
                  >
                    <Route index element={<Dashboard />} />
                    <Route path="/profile" element={<Profile />} />
                    <Route path="/orders">
                      <Route index element={<OrderList />} />
                      <Route path="show/:id" element={<OrderShow />} />
                    </Route>
                    <Route path="/customers">
                      <Route index element={<CustomerList />} />
                      <Route path="show/:id" element={<CustomerShow />} />
                    </Route>
                    <Route path="/products">
                      <Route index element={<ProductList />} />
                      <Route path="create" element={<ProductCreate />} />
                      <Route path="show/:id" element={<ProductShow />} />
                      <Route path="edit/:id" element={<ProductEdit />} />
                    </Route>
                    <Route path="/categories">
                      <Route index element={<CategoryList />} />
                      <Route path="create" element={<CategoryCreate />} />
                      <Route path="show/:id" element={<CategoryShow />} />
                      <Route path="edit/:id" element={<CategoryEdit />} />
                    </Route>
                    <Route path="/reports">
                      <Route path="sales" element={<SalesReport />} />
                    </Route>
                    <Route path="/settings" element={<Settings />} />
                    <Route path="/home-banners">
                      <Route index element={<HomeBannerList />} />
                      <Route path="create" element={<HomeBannerCreate />} />
                      <Route path="show/:id" element={<HomeBannerShow />} />
                      <Route path="edit/:id" element={<HomeBannerEdit />} />
                    </Route>
                    <Route path="*" element={<ErrorComponent />} />
                  </Route>
                  <Route
                    element={
                      <Authenticated key="auth" fallback={<Outlet />}>
                        <NavigateToResource />
                      </Authenticated>
                    }
                  >
                    <Route path="/login" element={<Login />} />
                    <Route path="/forgot-password" element={<AuthPage type="forgotPassword" title={<AuthTitle />} />} />
                    <Route path="/update-password" element={<AuthPage type="updatePassword" title={<AuthTitle />} />} />
                  </Route>
                </Routes>
                <RefineKbar />
                <UnsavedChangesNotifier />
                <DocumentTitleHandler
                  handler={({ resource, action, params }) => {
                    const resourceLabel = resource?.name ? t(`resources.${resource.name}`) : "Dashboard";
                    const id = params?.id ?? "";

                    const actionPrefixMatcher: Record<string, string> = {
                      create: `${t("actions.create")} ${resourceLabel}`,
                      clone: `#${id} ${resourceLabel}`,
                      edit: `#${id} ${t("actions.edit")} ${resourceLabel}`,
                      show: `#${id} ${t("actions.show")} ${resourceLabel}`,
                      list: resourceLabel,
                    };

                    const title = actionPrefixMatcher[action || "list"] ?? resourceLabel;
                    return `${title} | Pharmacy`;
                  }}
                />
              </Refine>
              {import.meta.env.DEV && <DevtoolsPanel />}
            </DevtoolsProvider>
          </AntdApp>
        </ColorModeContextProvider>
      </RefineKbarProvider>
    </BrowserRouter>
  );
}

export default App;
