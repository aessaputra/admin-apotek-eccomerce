import type { RefineLayoutThemedTitleProps } from "@refinedev/antd";
import { ThemedTitle } from "@refinedev/antd";
import { useTranslation } from "@refinedev/core";
import { useStoreBranding } from "../../hooks/useStoreBranding";
import { BrandingIcon } from "./branding-icon";

/**
 * Title component menggunakan ThemedTitle dari Refine.
 * Logo (icon) dan text dipisah sesuai dokumentasi:
 * @see https://refine.dev/docs/ui-integrations/ant-design/components/themed-layout/
 */
export const Title: React.FC<RefineLayoutThemedTitleProps> = ({ collapsed }) => {
  const { translate } = useTranslation();
  const { storeName, primaryLogoUrl } = useStoreBranding();

  return (
    <ThemedTitle
      collapsed={collapsed}
      icon={<BrandingIcon src={primaryLogoUrl} />}
      text={storeName ?? translate("app.title")}
    />
  );
};
