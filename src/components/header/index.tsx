import type { RefineThemedLayoutHeaderProps } from "@refinedev/antd";
import { useGetIdentity, useLogout } from "@refinedev/core";
import { Link } from "react-router";
import {
  Layout as AntdLayout,
  Avatar,
  Button,
  Dropdown,
  Space,
  Switch,
  theme,
} from "antd";
import type { MenuProps } from "antd";
import { DownOutlined, LogoutOutlined, UserOutlined } from "@ant-design/icons";
import React, { useContext } from "react";
import { ColorModeContext } from "../../contexts/color-mode";

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
      label: <Link to="/profile">Profil saya</Link>,
    },
    { type: "divider" },
    {
      key: "logout",
      icon: <LogoutOutlined />,
      label: "Keluar",
      danger: true,
      onClick: () => logout(),
    },
  ];

  return (
    <AntdLayout.Header style={headerStyles}>
      <Space>
        <Switch
          checkedChildren="🌛"
          unCheckedChildren="🔆"
          onChange={() => setMode(mode === "light" ? "dark" : "light")}
          defaultChecked={mode === "dark"}
        />
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
