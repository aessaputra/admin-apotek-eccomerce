import { Edit, useForm } from "@refinedev/antd";
import { App, Form, message } from "antd";
import { useTranslation } from "@refinedev/core";
import {
  getHomeBannerStoragePrefix,
  isHomeBannerPlacementKey,
} from "../../constants/home-banners";
import { HomeBannerFormFields, type HomeBannerFormValues } from "./form";
import { confirmActivation, normalizeHomeBannerValues } from "./create";

export const HomeBannerEdit: React.FC = () => {
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
      const nextError = error instanceof Error ? error : new Error("Failed to update home banner.");
      message.error(nextError.message);
      throw nextError;
    }
  };

  return (
    <Edit saveButtonProps={saveButtonProps}>
      <Form<HomeBannerFormValues>
        {...formProps}
        form={form}
        layout="vertical"
        onValuesChange={handleValuesChange}
        onFinish={handleFinish}
      >
        <HomeBannerFormFields form={form} />
      </Form>
    </Edit>
  );
};
