import { Create, useForm } from "@refinedev/antd";
import { App, Form, message } from "antd";
import { useTranslation } from "@refinedev/core";
import {
  getHomeBannerStoragePrefix,
  isHomeBannerPlacementKey,
  isMediaPathAllowedForPlacement,
} from "../../constants/home-banners";
import { HomeBannerFormFields, type HomeBannerFormValues } from "./form";

function normalizeNullableText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeHomeBannerValues(values: HomeBannerFormValues): HomeBannerFormValues {
  if (!isHomeBannerPlacementKey(values.placement_key)) {
    throw new Error("Placement is required.");
  }

  const title = normalizeNullableText(values.title);
  const body = normalizeNullableText(values.body);
  const mediaPath = normalizeNullableText(values.media_path);
  const ctaKind = values.cta_kind ?? "none";

  if (!isMediaPathAllowedForPlacement(mediaPath, values.placement_key)) {
    throw new Error("Selected media does not match the chosen placement.");
  }

  if (!title && !body && !mediaPath) {
    throw new Error("Banner must include at least a title, body, or media.");
  }

  if (ctaKind === "route") {
    const ctaLabel = normalizeNullableText(values.cta_label);
    const ctaRoute = normalizeNullableText(values.cta_route);

    if (!ctaLabel || !ctaRoute) {
      throw new Error("CTA label and CTA route are required when CTA kind is route.");
    }

    return {
      ...values,
      title,
      body,
      media_path: mediaPath,
      cta_kind: ctaKind,
      cta_label: ctaLabel,
      cta_route: ctaRoute,
      is_active: Boolean(values.is_active),
    };
  }

  return {
    ...values,
    title,
    body,
    media_path: mediaPath,
    cta_kind: "none",
    cta_label: null,
    cta_route: null,
    is_active: Boolean(values.is_active),
  };
}

export async function confirmActivation(
  values: HomeBannerFormValues,
  modal: ReturnType<typeof App.useApp>["modal"],
  translate: ReturnType<typeof useTranslation>["translate"]
): Promise<boolean> {
  if (!values.is_active) {
    return true;
  }

  return await new Promise<boolean>((resolve) => {
    modal.confirm({
      title: translate("homeBanners.confirm.activateTitle"),
      content: translate("homeBanners.confirm.activateContent"),
      okText: translate("homeBanners.confirm.activateOk"),
      cancelText: translate("buttons.cancel"),
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}

export const HomeBannerCreate: React.FC = () => {
  const { modal } = App.useApp();
  const { translate } = useTranslation();
  const { formProps, saveButtonProps, form, onFinish } = useForm<HomeBannerFormValues>({
    resource: "home_banners",
    warnWhenUnsavedChanges: true,
  });

  const handleValuesChange = (changed: Partial<HomeBannerFormValues>, all: HomeBannerFormValues) => {
    if (changed.cta_kind === "none") {
      form.setFieldsValue({ cta_label: null, cta_route: null });
    }

    if (changed.placement_key && isHomeBannerPlacementKey(changed.placement_key)) {
      const mediaPath = typeof all.media_path === "string" ? all.media_path : null;
      const allowedPrefix = getHomeBannerStoragePrefix(changed.placement_key);
      if (mediaPath && !mediaPath.startsWith(allowedPrefix)) {
        form.setFieldValue("media_path", null);
      }
    }

    formProps.onValuesChange?.(changed, all);
  };

  const handleFinish = async (values: HomeBannerFormValues) => {
    try {
      if (!onFinish) {
        return undefined;
      }

      const confirmed = await confirmActivation(values, modal, translate);
      if (!confirmed) {
        return undefined;
      }

      return await Promise.resolve(onFinish(normalizeHomeBannerValues(values)));
    } catch (error) {
      const nextError = error instanceof Error ? error : new Error("Failed to save home banner.");
      message.error(nextError.message);
      throw nextError;
    }
  };

  return (
    <Create saveButtonProps={saveButtonProps}>
      <Form<HomeBannerFormValues>
        {...formProps}
        form={form}
        layout="vertical"
        onValuesChange={handleValuesChange}
        onFinish={handleFinish}
      >
        <HomeBannerFormFields form={form} />
      </Form>
    </Create>
  );
};

export { normalizeHomeBannerValues };
