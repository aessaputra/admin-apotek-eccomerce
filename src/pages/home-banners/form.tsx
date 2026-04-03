import type { FormInstance, Rule } from "antd/es/form";
import { Alert, Button, Flex, Form, Input, Modal, Select, Switch } from "antd";
import { EyeOutlined, FolderOutlined } from "@ant-design/icons";
import { useState } from "react";
import { useTranslation } from "@refinedev/core";
import { type HomeBannerCtaKind, HOME_BANNER_CTA_ROUTES, HOME_BANNER_CTA_KINDS, HOME_BANNER_INTENTS, HOME_BANNER_PLACEMENTS } from "../../constants/home-banners";
import { HomeBannerMediaInput } from "../../components/home-banner-media-input";
import { HomeBannerMediaLibrary } from "../../components/home-banner-media-library";
import { HomeBannerPreview } from "./preview";

export interface HomeBannerFormValues {
  placement_key?: string;
  intent?: string;
  title?: string | null;
  body?: string | null;
  media_path?: string | null;
  cta_kind?: HomeBannerCtaKind;
  cta_label?: string | null;
  cta_route?: string | null;
  is_active?: boolean;
}

interface HomeBannerFormFieldsProps {
  form: FormInstance<HomeBannerFormValues>;
}

function requiredRule(message: string): Rule {
  return { required: true, message };
}

export const HomeBannerFormFields: React.FC<HomeBannerFormFieldsProps> = ({ form }) => {
  const { translate } = useTranslation();
  const placementKey = Form.useWatch("placement_key", form);
  const ctaKind = Form.useWatch("cta_kind", form);
  const intent = Form.useWatch("intent", form);
  const title = Form.useWatch("title", form);
  const body = Form.useWatch("body", form);
  const mediaPath = Form.useWatch("media_path", form);
  const ctaLabel = Form.useWatch("cta_label", form);
  const isActive = Form.useWatch("is_active", form);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);

  const selectedMediaPath: string | null = mediaPath ?? null;
  const selectedPlacementKey: string | null = placementKey ?? null;

  const titleWarning = typeof title === "string" && title.trim().length > 60
    ? translate("homeBanners.warnings.titleTooLong")
    : undefined;
  const bodyWarning = typeof body === "string" && body.trim().length > 140
    ? translate("homeBanners.warnings.bodyTooLong")
    : undefined;

  return (
    <>
      <Form.Item
        label={translate("homeBanners.fields.placementKey")}
        name="placement_key"
        rules={[requiredRule(translate("homeBanners.validation.placementRequired"))]}
      >
        <Select
          placeholder={translate("homeBanners.helpers.placement")}
          options={HOME_BANNER_PLACEMENTS.map((value) => ({
            value,
            label: translate(`homeBanners.options.placements.${value}`),
          }))}
        />
      </Form.Item>

      <Form.Item
        label={translate("homeBanners.fields.intent")}
        name="intent"
        rules={[requiredRule(translate("homeBanners.validation.intentRequired"))]}
      >
        <Select
          placeholder={translate("homeBanners.helpers.intent")}
          options={HOME_BANNER_INTENTS.map((value) => ({
            value,
            label: translate(`homeBanners.options.intents.${value}`),
          }))}
        />
      </Form.Item>

      <Form.Item
        label={translate("homeBanners.fields.title")}
        name="title"
        validateStatus={titleWarning ? "warning" : undefined}
        help={titleWarning}
      >
        <Input placeholder={translate("homeBanners.helpers.title")} maxLength={120} />
      </Form.Item>

      <Form.Item
        label={translate("homeBanners.fields.body")}
        name="body"
        validateStatus={bodyWarning ? "warning" : undefined}
        help={bodyWarning}
      >
        <Input.TextArea placeholder={translate("homeBanners.helpers.body")} rows={3} maxLength={500} />
      </Form.Item>

      <Form.Item label={translate("homeBanners.fields.mediaPath")} name="media_path">
        <HomeBannerMediaInput placementKey={placementKey} intent={intent} />
      </Form.Item>

      <Form.Item>
        <Flex gap={8}>
          <Button
            icon={<FolderOutlined />}
            onClick={() => setLibraryOpen(true)}
            disabled={!placementKey}
          >
            {translate("homeBanners.mediaLibrary.openAction")}
          </Button>
          <Button
            icon={<EyeOutlined />}
            onClick={() => setPreviewOpen(true)}
          >
            {translate("homeBanners.preview.openAction")}
          </Button>
        </Flex>
      </Form.Item>

      <Form.Item
        label={translate("homeBanners.fields.ctaKind")}
        name="cta_kind"
        rules={[requiredRule(translate("homeBanners.validation.ctaKindRequired"))]}
        initialValue={HOME_BANNER_CTA_KINDS[0]}
      >
        <Select
          placeholder={translate("homeBanners.helpers.cta")}
          options={HOME_BANNER_CTA_KINDS.map((value) => ({
            value,
            label: translate(`homeBanners.options.ctaKinds.${value}`),
          }))}
        />
      </Form.Item>

      <Form.Item
        label={translate("homeBanners.fields.ctaLabel")}
        name="cta_label"
        rules={ctaKind === "route" ? [requiredRule(translate("homeBanners.validation.ctaLabelRequired"))] : []}
        hidden={ctaKind !== "route"}
      >
        <Input placeholder={translate("homeBanners.helpers.ctaLabel")} maxLength={60} />
      </Form.Item>

      <Form.Item
        label={translate("homeBanners.fields.ctaRoute")}
        name="cta_route"
        rules={ctaKind === "route" ? [requiredRule(translate("homeBanners.validation.ctaRouteRequired"))] : []}
        hidden={ctaKind !== "route"}
      >
        <Select
          placeholder={translate("homeBanners.helpers.ctaRoute")}
          options={HOME_BANNER_CTA_ROUTES.map((value) => ({
            value,
            label: translate(`homeBanners.options.ctaRoutes.${value}`),
          }))}
        />
      </Form.Item>

      <Form.Item
        label={translate("homeBanners.fields.isActive")}
        name="is_active"
        valuePropName="checked"
        initialValue={false}
      >
        <Switch checkedChildren={translate("homeBanners.status.active")} unCheckedChildren={translate("homeBanners.status.inactive")} />
      </Form.Item>

      {isActive ? (
        <Alert type="warning" showIcon message={translate("homeBanners.warnings.activation")}/>
      ) : null}

      <Modal
        open={previewOpen}
        onCancel={() => setPreviewOpen(false)}
        footer={null}
        title={translate("homeBanners.preview.title")}
        width={480}
      >
        <HomeBannerPreview
          placementKey={placementKey}
          title={title}
          body={body}
          mediaPath={mediaPath}
          ctaKind={ctaKind}
          ctaLabel={ctaLabel}
        />
      </Modal>

      <Modal
        open={libraryOpen}
        onCancel={() => setLibraryOpen(false)}
        footer={null}
        title={translate("homeBanners.mediaLibrary.title")}
        width={640}
      >
        <HomeBannerMediaLibrary
          placementKey={selectedPlacementKey}
          selectedPath={selectedMediaPath}
          onSelect={(path) => {
            form.setFieldValue("media_path", path ?? null);
            setLibraryOpen(false);
          }}
        />
      </Modal>
    </>
  );
};
