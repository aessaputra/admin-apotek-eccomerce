import { ThemedTitle } from "@refinedev/antd";
import { useTranslation } from "@refinedev/core";

/**
 * Title untuk AuthPage (login, forgot-password, update-password).
 * Logo dan text terpisah sesuai dokumentasi Refine.
 * @see https://refine.dev/docs/ui-integrations/ant-design/components/auth-page/
 */
export const AuthTitle: React.FC = () => {
  const { translate } = useTranslation();

  return (
    <ThemedTitle
      collapsed={false}
      icon={
        <img
          src="/logo-icon.png"
          alt=""
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
          }}
        />
      }
      text={translate("app.title")}
    />
  );
};
