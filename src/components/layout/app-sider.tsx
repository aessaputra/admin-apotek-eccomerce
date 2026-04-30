import React, { useContext } from "react";
import {
  CanAccess,
  type TreeMenuItem,
  useIsExistAuthentication,
  useLink,
  useLogout,
  useMenu,
  useTranslate,
  useWarnAboutChange,
} from "@refinedev/core";
import { LogoutOutlined, UnorderedListOutlined } from "@ant-design/icons";
import { Button, ConfigProvider, Drawer, Grid, Layout, Menu, theme } from "antd";
import type { MenuProps } from "antd";
import { useThemedLayoutContext } from "@refinedev/antd";

type MenuItem = NonNullable<MenuProps["items"]>[number];

const drawerButtonStyles: React.CSSProperties = {
  borderStartStartRadius: 0,
  borderEndStartRadius: 0,
  position: "fixed",
  top: 64,
  zIndex: 999,
};

interface AppSiderProps {
  Title?: React.ComponentType<{ collapsed: boolean }>;
}

export const AppSider: React.FC<AppSiderProps> = ({ Title }) => {
  const { token } = theme.useToken();
  const {
    siderCollapsed,
    setSiderCollapsed,
    mobileSiderOpen,
    setMobileSiderOpen,
  } = useThemedLayoutContext();
  const { menuItems, selectedKey, defaultOpenKeys } = useMenu();
  const isExistAuthentication = useIsExistAuthentication();
  const Link = useLink();
  const translate = useTranslate();
  const { warnWhen, setWarnWhen } = useWarnAboutChange();
  const { mutate: mutateLogout } = useLogout();
  const breakpoint = Grid.useBreakpoint();
  const direction = useContext(ConfigProvider.ConfigContext)?.direction;
  const isMobile = typeof breakpoint.lg === "undefined" ? false : !breakpoint.lg;

  const handleLogout = () => {
    if (warnWhen) {
      const confirmed = window.confirm(
        translate(
          "warnWhenUnsavedChanges",
          "Are you sure you want to leave? You have unsaved changes."
        )
      );

      if (!confirmed) return;
      setWarnWhen(false);
    }

    mutateLogout();
  };

  const buildMenuItems = (tree: TreeMenuItem[]): MenuItem[] => {
    return tree.map((item) => {
      const { key, name, children, meta, list } = item;
      const label = item.label ?? meta?.label ?? name;
      const icon = meta?.icon;

      if (children.length > 0) {
        return {
          key,
          icon: icon ?? <UnorderedListOutlined />,
          label: (
            <CanAccess resource={name} action="list" params={{ resource: item }}>
              {label}
            </CanAccess>
          ),
          children: buildMenuItems(children),
        };
      }

      return {
        key,
        icon: icon ?? <UnorderedListOutlined />,
        label: (
          <CanAccess resource={name} action="list" params={{ resource: item }}>
            <Link to={list ?? ""}>{label}</Link>
          </CanAccess>
        ),
      };
    });
  };

  const logoutItem: MenuItem | null = isExistAuthentication
    ? {
        key: "logout",
        icon: <LogoutOutlined />,
        label: translate("buttons.logout", "Logout"),
        onClick: handleLogout,
      }
    : null;

  const items: MenuProps["items"] = logoutItem
    ? [...buildMenuItems(menuItems), logoutItem]
    : buildMenuItems(menuItems);

  const renderTitle = (collapsed: boolean) => (Title ? <Title collapsed={collapsed} /> : null);
  const titleContainerStyle = (collapsed: boolean): React.CSSProperties => ({
    alignItems: "center",
    backgroundColor: token.colorBgElevated,
    display: "flex",
    fontSize: "14px",
    height: "64px",
    justifyContent: collapsed ? "center" : "flex-start",
    padding: collapsed ? 0 : "0 16px",
    width: collapsed ? "80px" : "200px",
  });

  const menu = (
    <Menu
      selectedKeys={selectedKey ? [selectedKey] : []}
      defaultOpenKeys={defaultOpenKeys}
      mode="inline"
      items={items}
      style={{
        border: "none",
        height: "calc(100% - 72px)",
        overflow: "auto",
        paddingTop: "8px",
      }}
      onClick={() => setMobileSiderOpen(false)}
    />
  );

  if (isMobile) {
    return (
      <>
        <Drawer
          open={mobileSiderOpen}
          onClose={() => setMobileSiderOpen(false)}
          placement={direction === "rtl" ? "right" : "left"}
          closable={false}
          width={200}
          styles={{ body: { padding: 0 } }}
          maskClosable
        >
          <Layout>
            <Layout.Sider
              style={{
                backgroundColor: token.colorBgContainer,
                borderRight: `1px solid ${token.colorBgElevated}`,
                height: "100vh",
              }}
            >
              <div style={titleContainerStyle(false)}>{renderTitle(false)}</div>
              {menu}
            </Layout.Sider>
          </Layout>
        </Drawer>
        <Button
          style={drawerButtonStyles}
          size="large"
          onClick={() => setMobileSiderOpen(true)}
          icon={<UnorderedListOutlined />}
        />
      </>
    );
  }

  return (
    <Layout.Sider
      style={{
        backgroundColor: token.colorBgContainer,
        borderRight: `1px solid ${token.colorBgElevated}`,
      }}
      collapsible
      collapsed={siderCollapsed}
      collapsedWidth={80}
      breakpoint="lg"
      onCollapse={(collapsed, type) => {
        if (type === "clickTrigger") {
          setSiderCollapsed(collapsed);
        }
      }}
    >
      <div style={titleContainerStyle(siderCollapsed)}>{renderTitle(siderCollapsed)}</div>
      {menu}
    </Layout.Sider>
  );
};
