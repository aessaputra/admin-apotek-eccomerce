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
import { lazy, Suspense } from "react";
import { BrowserRouter, Outlet, Route, Routes } from "react-router";
import { useTranslation } from "react-i18next";
import { ColorModeContextProvider } from "./contexts/color-mode";
import { Header } from "./components/header";
import { AuthInterceptor } from "./components/auth/auth-interceptor";
import { AppSider } from "./components/layout/app-sider";
import { AuthTitle } from "./components/layout/auth-title";
import { Title } from "./components/layout/title";
import { useStoreBranding } from "./hooks/useStoreBranding";
import { ORDER_READ_RESOURCE } from "./constants/resources";
import authProvider from "./providers/auth";
import { dataProvider } from "./providers/data";
import { supabaseClient } from "./providers/supabase-client";

const Dashboard = lazy(() => import("./pages/dashboard").then(({ Dashboard }) => ({ default: Dashboard })));
const OrderList = lazy(() => import("./pages/orders/list").then(({ OrderList }) => ({ default: OrderList })));
const OrderShow = lazy(() => import("./pages/orders/show").then(({ OrderShow }) => ({ default: OrderShow })));
const CustomerList = lazy(() => import("./pages/customers/list").then(({ CustomerList }) => ({ default: CustomerList })));
const CustomerShow = lazy(() => import("./pages/customers/show").then(({ CustomerShow }) => ({ default: CustomerShow })));
const ProductList = lazy(() => import("./pages/products/list").then(({ ProductList }) => ({ default: ProductList })));
const ProductCreate = lazy(() => import("./pages/products/create").then(({ ProductCreate }) => ({ default: ProductCreate })));
const ProductEdit = lazy(() => import("./pages/products/edit").then(({ ProductEdit }) => ({ default: ProductEdit })));
const ProductShow = lazy(() => import("./pages/products/show").then(({ ProductShow }) => ({ default: ProductShow })));
const CategoryList = lazy(() => import("./pages/categories/list").then(({ CategoryList }) => ({ default: CategoryList })));
const CategoryCreate = lazy(() => import("./pages/categories/create").then(({ CategoryCreate }) => ({ default: CategoryCreate })));
const CategoryEdit = lazy(() => import("./pages/categories/edit").then(({ CategoryEdit }) => ({ default: CategoryEdit })));
const CategoryShow = lazy(() => import("./pages/categories/show").then(({ CategoryShow }) => ({ default: CategoryShow })));
const Profile = lazy(() => import("./pages/profile").then(({ Profile }) => ({ default: Profile })));
const SalesReport = lazy(() => import("./pages/reports/sales").then(({ SalesReport }) => ({ default: SalesReport })));
const Settings = lazy(() => import("./pages/settings").then(({ Settings }) => ({ default: Settings })));
const HomeBannerList = lazy(() => import("./pages/home-banners/list").then(({ HomeBannerList }) => ({ default: HomeBannerList })));
const HomeBannerCreate = lazy(() => import("./pages/home-banners/create").then(({ HomeBannerCreate }) => ({ default: HomeBannerCreate })));
const HomeBannerEdit = lazy(() => import("./pages/home-banners/edit").then(({ HomeBannerEdit }) => ({ default: HomeBannerEdit })));
const HomeBannerShow = lazy(() => import("./pages/home-banners/show").then(({ HomeBannerShow }) => ({ default: HomeBannerShow })));
const MfaVerify = lazy(() => import("./pages/auth/mfa-verify").then(({ MfaVerify }) => ({ default: MfaVerify })));
const Login = lazy(() => import("./pages/auth/login").then(({ Login }) => ({ default: Login })));
const UpdatePassword = lazy(() => import("./pages/auth/update-password").then(({ UpdatePassword }) => ({ default: UpdatePassword })));

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
      <AuthInterceptor />
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
                  { name: "report_sold_products" },
                  { name: "report_customer_sales" },
                ]}
                options={{
                  syncWithLocation: true,
                  warnWhenUnsavedChanges: true,
                }}
              >
                <Suspense fallback={null}>
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
                    <Route path="/update-password" element={<UpdatePassword />} />
                  </Route>
                </Routes>
                </Suspense>
                <RefineKbar />
                <UnsavedChangesNotifier />
                <BrandedDocumentTitleHandler />
              </Refine>
              {import.meta.env.DEV && <DevtoolsPanel />}
            </DevtoolsProvider>
          </AntdApp>
        </ColorModeContextProvider>
      </RefineKbarProvider>
    </BrowserRouter>
  );
}

const BrandedDocumentTitleHandler: React.FC = () => {
  const { t } = useTranslation();
  const { storeName } = useStoreBranding();
  const appTitle = storeName ?? t("app.title");

  return (
    <DocumentTitleHandler
      handler={({ resource, action, params }) => {
        const resourceLabel = resource?.name ? t(`resources.${resource.name}`) : t("resources.dashboard", "Dashboard");
        const id = params?.id ?? "";

        const actionPrefixMatcher: Record<string, string> = {
          create: `${t("actions.create")} ${resourceLabel}`,
          clone: `#${id} ${resourceLabel}`,
          edit: `#${id} ${t("actions.edit")} ${resourceLabel}`,
          show: `#${id} ${t("actions.show")} ${resourceLabel}`,
          list: resourceLabel,
        };

        const title = actionPrefixMatcher[action || "list"] ?? resourceLabel;
        return `${title} | ${appTitle}`;
      }}
    />
  );
};

export default App;
