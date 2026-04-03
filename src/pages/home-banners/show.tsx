import { Show } from "@refinedev/antd";
import { useShow, useTranslation } from "@refinedev/core";
import { Descriptions, Image, Tag, Typography } from "antd";
import { getPublicUrlFromStoragePath, MEDIA_BUCKET } from "../../utils/storage";

interface HomeBannerRecord {
  id: string;
  placement_key: string;
  intent: string;
  title: string | null;
  body: string | null;
  media_path: string | null;
  cta_kind: string;
  cta_label: string | null;
  cta_route: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export const HomeBannerShow: React.FC = () => {
  const { translate } = useTranslation();
  const {
    result: record,
    query: { isLoading },
  } = useShow<HomeBannerRecord>({
    resource: "home_banners",
  });

  const previewUrl = record?.media_path ? getPublicUrlFromStoragePath(record.media_path, MEDIA_BUCKET) : null;

  return (
    <Show isLoading={isLoading}>
      <Descriptions bordered column={1} size="small">
        <Descriptions.Item label={translate("homeBanners.fields.placementKey")}>{record?.placement_key ? translate(`homeBanners.options.placements.${record.placement_key}`) : "-"}</Descriptions.Item>
        <Descriptions.Item label={translate("homeBanners.fields.intent")}>{record?.intent ? translate(`homeBanners.options.intents.${record.intent}`) : "-"}</Descriptions.Item>
        <Descriptions.Item label={translate("homeBanners.fields.title")}>{record?.title || "-"}</Descriptions.Item>
        <Descriptions.Item label={translate("homeBanners.fields.body")}>
          <Typography.Paragraph style={{ marginBottom: 0 }}>{record?.body || "-"}</Typography.Paragraph>
        </Descriptions.Item>
        <Descriptions.Item label={translate("homeBanners.fields.mediaPath")}>
          {record?.media_path ? (
            <Typography.Paragraph copyable style={{ marginBottom: previewUrl ? 12 : 0 }}>
              {record.media_path}
            </Typography.Paragraph>
          ) : (
            "-"
          )}
          {previewUrl ? <Image width={280} src={previewUrl} alt="Home banner media" /> : null}
        </Descriptions.Item>
        <Descriptions.Item label={translate("homeBanners.fields.ctaKind")}>{record?.cta_kind ? translate(`homeBanners.options.ctaKinds.${record.cta_kind}`) : "-"}</Descriptions.Item>
        <Descriptions.Item label={translate("homeBanners.fields.ctaLabel")}>{record?.cta_label || "-"}</Descriptions.Item>
        <Descriptions.Item label={translate("homeBanners.fields.ctaRoute")}>{record?.cta_route ? translate(`homeBanners.options.ctaRoutes.${record.cta_route}`) : "-"}</Descriptions.Item>
        <Descriptions.Item label={translate("homeBanners.fields.isActive")}>
          {record?.is_active ? <Tag color="green">{translate("homeBanners.status.active")}</Tag> : <Tag>{translate("homeBanners.status.inactive")}</Tag>}
        </Descriptions.Item>
        <Descriptions.Item label={translate("homeBanners.fields.createdAt")}>{record?.created_at ? new Date(record.created_at).toLocaleString() : "-"}</Descriptions.Item>
        <Descriptions.Item label={translate("homeBanners.fields.updatedAt")}>{record?.updated_at ? new Date(record.updated_at).toLocaleString() : "-"}</Descriptions.Item>
      </Descriptions>
    </Show>
  );
};
