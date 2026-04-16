import { ThemedTitle } from "@refinedev/antd";
import { useTranslation } from "@refinedev/core";
import { useStoreBranding } from "../../hooks/useStoreBranding";
import { BrandingIcon } from "./branding-icon";

/**
 * Title untuk AuthPage (login, forgot-password, update-password).
 * Logo dan text terpisah sesuai dokumentasi Refine.
 * @see https://refine.dev/docs/ui-integrations/ant-design/components/auth-page/
 */
export const AuthTitle: React.FC = () => {
  const { translate } = useTranslation();
  const { storeName, primaryLogoUrl } = useStoreBranding();

  return (
    <ThemedTitle
      collapsed={false}
      icon={<BrandingIcon src={primaryLogoUrl} />}
      text={storeName ?? translate("app.title")}
    />
  );
};
