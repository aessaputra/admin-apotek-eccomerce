import type { RefineLayoutThemedTitleProps } from "@refinedev/antd";
import { useLink, useTranslation } from "@refinedev/core";
import { Typography, theme } from "antd";

export const Title: React.FC<RefineLayoutThemedTitleProps> = ({
  collapsed,
}) => {
  const Link = useLink();
  const { token } = theme.useToken();
  const { translate } = useTranslation();

  return (
    <Link
      to="/"
      style={{
        display: "flex",
        alignItems: "center",
        textDecoration: "none",
        color: "inherit",
      }}
    >
      <Typography.Title
        level={5}
        style={{
          margin: 0,
          fontWeight: 700,
          color: token.colorText,
          fontSize: collapsed ? "14px" : "16px",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {collapsed ? translate("app.titleShort") : translate("app.title")}
      </Typography.Title>
    </Link>
  );
};
