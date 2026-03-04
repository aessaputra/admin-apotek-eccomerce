import { useEffect } from "react";
import { Edit, useForm, useSelect } from "@refinedev/antd";
import { useTranslation } from "@refinedev/core";
import { Form, Input, InputNumber, Select, message } from "antd";
import { ProductImageUpload } from "../../components/product-image-upload";
import { slugify } from "../../utils/slugify";
import { supabaseClient } from "../../providers/supabase-client";
import {
  getStoragePathFromPublicUrl,
  PRODUCT_IMAGES_BUCKET,
} from "../../utils/storage";

interface ProductImage { id: string; url: string; sort_order: number }

export const ProductEdit: React.FC = () => {
  const { translate } = useTranslation();
  const { formProps, saveButtonProps, form, query } = useForm({
    meta: { select: "*, product_images(*)" },
  });
  const { selectProps } = useSelect({
    resource: "categories",
    optionLabel: "name",
    optionValue: "id",
  });

  const data = query?.data?.data as { product_images?: ProductImage[] } | undefined;

  useEffect(() => {
    if (data?.product_images && Array.isArray(data.product_images)) {
      const urls = [...data.product_images]
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map((p) => p.url);
      form.setFieldsValue({ images: urls });
    }
  }, [data?.product_images, form]);

  const handleValuesChange = (
    changed: Record<string, unknown>,
    all: Record<string, unknown>
  ) => {
    if ("name" in changed && changed.name != null) {
      form.setFieldValue("slug", slugify(String(changed.name)));
    }
    formProps.onValuesChange?.(changed, all);
  };

  const handleFinish = async (values: Record<string, unknown>) => {
    const { images = [], ...productValues } = values;
    const result = (await formProps.onFinish?.({ ...productValues })) as
      | { data?: { id?: string } }
      | undefined;
    const productId = result?.data?.id;
    if (!productId) return result;

    const currentUrls = Array.isArray(images) ? (images as string[]) : [];
    const original = (data?.product_images ?? []) as ProductImage[];

    try {
      const removed = original.filter((o) => !currentUrls.includes(o.url));
      const removedResults = await Promise.allSettled(
        removed.map(async (img) => {
          const path = getStoragePathFromPublicUrl(img.url, PRODUCT_IMAGES_BUCKET);
          if (path) {
            await supabaseClient.storage.from(PRODUCT_IMAGES_BUCKET).remove([path]);
          }
          const { error: deleteError } = await supabaseClient
            .from("product_images")
            .delete()
            .eq("id", img.id);
          if (deleteError) throw deleteError;
        })
      );

      const firstRemovedError = removedResults.find((r) => r.status === "rejected");
      if (firstRemovedError) throw (firstRemovedError as PromiseRejectedResult).reason;

      const updateResults = await Promise.allSettled(
        currentUrls.map(async (url, i) => {
          const existing = original.find((o) => o.url === url);
          if (existing) {
            const { error: updateError } = await supabaseClient
              .from("product_images")
              .update({ sort_order: i })
              .eq("id", existing.id);
            if (updateError) throw updateError;
          } else {
            const { error: insertError } = await supabaseClient
              .from("product_images")
              .insert({
                product_id: productId,
                url,
                sort_order: i,
              });
            if (insertError) throw insertError;
          }
        })
      );

      const firstUpdateError = updateResults.find((r) => r.status === "rejected");
      if (firstUpdateError) throw (firstUpdateError as PromiseRejectedResult).reason;
    } catch (err) {
      message.error(translate("products.imagesSaveError"));
      throw err;
    }

    return result;
  };

  return (
    <Edit saveButtonProps={saveButtonProps}>
      <Form
        {...formProps}
        layout="vertical"
        onValuesChange={handleValuesChange}
        onFinish={handleFinish}
      >
        <Form.Item label={translate("products.fields.name")} name="name" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item label={translate("products.fields.slug")} name="slug" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item label={translate("products.fields.description")} name="description">
          <Input.TextArea />
        </Form.Item>
        <Form.Item label={translate("products.fields.price")} name="price" rules={[{ required: true }]}>
          <InputNumber style={{ width: "100%" }} min={0} />
        </Form.Item>
        <Form.Item label={translate("products.fields.stock")} name="stock">
          <InputNumber style={{ width: "100%" }} min={0} />
        </Form.Item>
        <Form.Item label={translate("products.fields.weight")} name="weight">
          <InputNumber style={{ width: "100%" }} min={0} addonAfter="gram" />
        </Form.Item>
        <Form.Item label={translate("products.fields.category")} name="category_id">
          <Select {...selectProps} />
        </Form.Item>
        <Form.Item label={translate("products.fields.images")} name="images">
          <ProductImageUpload />
        </Form.Item>
        <Form.Item label={translate("products.fields.active")} name="is_active">
          <Select options={[{ value: true, label: translate("products.active.yes") }, { value: false, label: translate("products.active.no") }]} />
        </Form.Item>
      </Form>
    </Edit>
  );
};
