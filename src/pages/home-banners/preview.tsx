import { Alert, Button, Card, Space, Tag, Typography } from "antd";
import { useTranslation } from "@refinedev/core";
import {
  getHomeBannerMediaSpec,
  isHomeBannerPlacementKey,
  type HomeBannerCtaKind,
} from "../../constants/home-banners";
import { getPublicUrlFromStoragePath, MEDIA_BUCKET } from "../../utils/storage";

interface HomeBannerPreviewProps {
  placementKey?: string | null;
  title?: string | null;
  body?: string | null;
  mediaPath?: string | null;
  ctaKind?: HomeBannerCtaKind;
  ctaLabel?: string | null;
}

export const HomeBannerPreview: React.FC<HomeBannerPreviewProps> = ({
  placementKey,
  title,
  body,
  mediaPath,
  ctaKind,
  ctaLabel,
}) => {
  const { translate } = useTranslation();

  if (!isHomeBannerPlacementKey(placementKey)) {
    return null;
  }

  const spec = getHomeBannerMediaSpec(placementKey);
  const previewUrl = mediaPath ? getPublicUrlFromStoragePath(mediaPath, MEDIA_BUCKET) : null;
  const hasText = Boolean(title?.trim() || body?.trim());
  const hasCta = ctaKind === "route" && Boolean(ctaLabel?.trim());
  const isImageOnly = !hasText && !hasCta && Boolean(mediaPath);

  return (
    <Card size="small">
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Alert
          type="info"
          showIcon
          message={translate("homeBanners.preview.description")}
          description={translate(`homeBanners.preview.safeArea.${placementKey}`)}
        />

        <div
          style={{
            position: "relative",
            width: "100%",
            maxWidth: 360,
            aspectRatio: `${spec.recommendedWidth} / ${spec.recommendedHeight}`,
            borderRadius: 16,
            overflow: "hidden",
            backgroundColor: "#f5f5f5",
            backgroundImage: previewUrl
              ? `linear-gradient(180deg, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.45) 100%), url(${previewUrl})`
              : "linear-gradient(135deg, #f0f5ff 0%, #d6e4ff 100%)",
            backgroundPosition: "center",
            backgroundSize: "cover",
            border: "1px solid #d9d9d9",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 16,
              right: 16,
              bottom: 16,
              display: "flex",
              flexDirection: "column",
              gap: 8,
              alignItems: "flex-start",
            }}
          >
            <Tag color={isImageOnly ? "purple" : "blue"}>
              {isImageOnly ? translate("homeBanners.preview.imageOnly") : translate("homeBanners.preview.contentBanner")}
            </Tag>

            {title ? (
              <Typography.Text strong style={{ color: "#fff", fontSize: 16 }}>
                {title}
              </Typography.Text>
            ) : null}

            {body ? (
              <Typography.Text style={{ color: "#fff" }}>
                {body}
              </Typography.Text>
            ) : null}

            {hasCta ? (
              <Button size="small" type="primary">
                {ctaLabel}
              </Button>
            ) : null}

            {!previewUrl ? (
              <Typography.Text style={{ color: "rgba(255,255,255,0.92)" }}>
                {translate("homeBanners.preview.noImageSelected")}
              </Typography.Text>
            ) : null}
          </div>
        </div>
      </Space>
    </Card>
  );
};
