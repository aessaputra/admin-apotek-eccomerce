import type { RefineThemedLayoutHeaderProps } from "@refinedev/antd";
import { useGetIdentity, useLogout, useTranslation } from "@refinedev/core";
import { useTranslation as useI18nTranslation } from "react-i18next";
import { Link } from "react-router";
import {
  Layout as AntdLayout,
  Avatar,
  Button,
  Dropdown,
  Select,
  Space,
  Switch,
  theme,
} from "antd";
import type { MenuProps } from "antd";
import { DownOutlined, LogoutOutlined, UserOutlined } from "@ant-design/icons";
import React, { useContext } from "react";
import { ColorModeContext } from "../../contexts/color-mode";
import { AdminOrderNotifications } from "./notifications/AdminOrderNotifications";

const { useToken } = theme;

type IUser = {
  id: string;
  name: string;
  avatar?: string;
};

export const Header: React.FC<RefineThemedLayoutHeaderProps> = ({
  sticky = true,
}) => {
  const { token } = useToken();
  const { data: user } = useGetIdentity<IUser>();
  const { mutate: logout } = useLogout();
  const { mode, setMode } = useContext(ColorModeContext);
  const { translate, changeLocale } = useTranslation();
  const { i18n } = useI18nTranslation();

  const headerStyles: React.CSSProperties = {
    backgroundColor: token.colorBgElevated,
    display: "flex",
    justifyContent: "flex-end",
    alignItems: "center",
    padding: "0px 24px",
    height: "64px",
  };

  if (sticky) {
    headerStyles.position = "sticky";
    headerStyles.top = 0;
    headerStyles.zIndex = 1;
  }

  const menuItems: MenuProps["items"] = [
    {
      key: "profile",
      icon: <UserOutlined />,
      label: <Link to="/profile">{translate("profile.myProfile")}</Link>,
    },
    { type: "divider" },
    {
      key: "logout",
      icon: <LogoutOutlined />,
      label: translate("buttons.logout"),
      danger: true,
      onClick: () => logout(),
    },
  ];

  return (
    <AntdLayout.Header style={headerStyles}>
      <Space>
        <Select
          value={i18n.language?.startsWith("en") ? "en" : "id"}
          onChange={(v) => changeLocale(v ?? "id")}
          style={{ width: 80 }}
          options={[
            { value: "id", label: "ID" },
            { value: "en", label: "EN" },
          ]}
        />
        <Switch
          checkedChildren="🌛"
          unCheckedChildren="🔆"
          checked={mode === "dark"}
          onChange={() => setMode()}
        />
        <AdminOrderNotifications userId={user?.id} />
        {user && (
          <Dropdown
            menu={{ items: menuItems }}
            trigger={["click"]}
            placement="bottomRight"
            getPopupContainer={() => document.body}
          >
            <Button type="text" style={{ padding: "4px 8px", height: "auto" }}>
              <Space size="small">
                <Avatar src={user.avatar} size="small">
                  {user.name?.[0]?.toUpperCase() ?? "U"}
                </Avatar>
                <span>{user.name}</span>
                <DownOutlined style={{ fontSize: 10 }} />
              </Space>
            </Button>
          </Dropdown>
        )}
      </Space>
    </AntdLayout.Header>
  );
};
