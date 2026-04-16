import { useEffect, useState } from "react";

export const DEFAULT_BRANDING_ICON_SRC = "/logo-icon.png";

interface BrandingIconProps {
  src?: string | null;
}

export const BrandingIcon: React.FC<BrandingIconProps> = ({ src }) => {
  const [resolvedSrc, setResolvedSrc] = useState(src ?? DEFAULT_BRANDING_ICON_SRC);

  useEffect(() => {
    setResolvedSrc(src ?? DEFAULT_BRANDING_ICON_SRC);
  }, [src]);

  return (
    <img
      src={resolvedSrc}
      alt=""
      onError={() => {
        if (resolvedSrc !== DEFAULT_BRANDING_ICON_SRC) {
          setResolvedSrc(DEFAULT_BRANDING_ICON_SRC);
        }
      }}
      style={{
        width: "100%",
        height: "100%",
        objectFit: "contain",
      }}
    />
  );
};
