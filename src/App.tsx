import type { I18nProvider } from "@refinedev/core";
import { Authenticated, GitHubBanner, Refine } from "@refinedev/core";
import { DevtoolsPanel, DevtoolsProvider } from "@refinedev/devtools";
import { RefineKbar, RefineKbarProvider } from "@refinedev/kbar";

import { AuthPage, ErrorComponent, ThemedLayout, ThemedSider, useNotificationProvider } from "@refinedev/antd";
import "@refinedev/antd/dist/reset.css";

import {
  DashboardOutlined,
  ShoppingCartOutlined,
  UserOutlined,
  ShopOutlined,
  InboxOutlined,
  AppstoreOutlined,
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
import { Title } from "./components/layout/title";
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

function App() {
  const { t, i18n } = useTranslation();

  const i18nProvider: I18nProvider = {
    translate: (key: string, options?: any, defaultMessage?: string): string => {
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
      <GitHubBanner />
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
                    meta: { icon: <ShoppingCartOutlined /> },
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
                ]}
                options={{
                  syncWithLocation: true,
                  warnWhenUnsavedChanges: true,
                }}
              >
                <Routes>
                  <Route
                    element={
                      <Authenticated
                        key="protected"
                        fallback={<CatchAllNavigate to="/login" />}
                      >
                        <ThemedLayout
                          Header={Header}
                          Title={Title}
                          Sider={({ Title }) => (
                            <ThemedSider
                              Title={Title}
                              render={({ items }) => <>{items}</>}
                            />
                          )}
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
                    <Route path="*" element={<ErrorComponent />} />
                  </Route>
                  <Route
                    element={
                      <Authenticated key="auth" fallback={<Outlet />}>
                        <NavigateToResource />
                      </Authenticated>
                    }
                  >
                    <Route path="/login" element={<AuthPage type="login" providers={[]} registerLink={false} />} />
                    <Route path="/forgot-password" element={<AuthPage type="forgotPassword" />} />
                    <Route path="/update-password" element={<AuthPage type="updatePassword" />} />
                  </Route>
                </Routes>
                <RefineKbar />
                <UnsavedChangesNotifier />
                <DocumentTitleHandler />
              </Refine>
              <DevtoolsPanel />
            </DevtoolsProvider>
          </AntdApp>
        </ColorModeContextProvider>
      </RefineKbarProvider>
    </BrowserRouter>
  );
}

export default App;
