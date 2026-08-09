import type { GlobalToken } from "antd/es/theme/interface";
import type { CSSProperties } from "react";

export const getDashboardPageHeaderStyle = (token: GlobalToken): CSSProperties => ({
  marginBottom: token.marginLG,
});

export const getDashboardPrimaryKpiCardStyle = (token: GlobalToken): CSSProperties => ({
  height: "100%",
  borderColor: token.colorBorderSecondary,
  backgroundColor: token.colorBgContainer,
});

export const getDashboardSecondaryKpiCardStyle = (token: GlobalToken): CSSProperties => ({
  height: "100%",
  borderColor: token.colorBorderSecondary,
  backgroundColor: token.colorFillAlter,
});

export const getDashboardPrimaryKpiValueStyle = (token: GlobalToken): CSSProperties => ({
  fontSize: token.fontSizeHeading3,
  fontWeight: token.fontWeightStrong,
});

export const getDashboardSecondaryKpiValueStyle = (token: GlobalToken): CSSProperties => ({
  fontSize: token.fontSizeHeading4,
  fontWeight: token.fontWeightStrong,
});

export const getDashboardTrendStatTileStyle = (token: GlobalToken): CSSProperties => ({
  height: "100%",
  minHeight: 92,
  padding: token.paddingSM,
  border: `1px solid ${token.colorBorderSecondary}`,
  borderRadius: token.borderRadiusLG,
  backgroundColor: token.colorFillAlter,
});

export const getDashboardTrendStatValueStyle = (token: GlobalToken): CSSProperties => ({
  fontSize: token.fontSizeLG,
  fontWeight: token.fontWeightStrong,
});

export const visuallyHiddenStyle: CSSProperties = {
  position: "absolute",
  width: "1px",
  height: "1px",
  padding: 0,
  margin: "-1px",
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
};

export const getDashboardGranularityContainerStyle = (
  _token: GlobalToken,
  isMobile?: boolean,
): CSSProperties => ({
  display: "flex",
  width: isMobile ? "100%" : undefined,
  justifyContent: isMobile ? "center" : "flex-end",
  minWidth: 0,
});

export const getDashboardGranularityRadioStyle = (
  token: GlobalToken,
  isMobile?: boolean,
): CSSProperties => ({
  display: "flex",
  width: isMobile ? "100%" : undefined,
  flexWrap: isMobile ? undefined : "wrap",
  gap: token.marginXXS,
  justifyContent: isMobile ? undefined : "flex-end",
});

export const getDashboardGranularityOptionStyle = (
  _token: GlobalToken,
  isMobile?: boolean,
): CSSProperties =>
  isMobile
    ? {
        flex: 1,
        textAlign: "center",
      }
    : {};

