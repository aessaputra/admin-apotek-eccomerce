import { useEffect } from "react";
import { Edit, useForm, useSelect } from "@refinedev/antd";
import { useTranslation } from "@refinedev/core";
import { Form, Input, InputNumber, Select, message } from "antd";
import { ProductImageUpload } from "../../components/product-image-upload";
import { DescriptionEditorModal } from "../../components/description-editor-modal";
import { ProductWeightInput } from "../../components/product-weight-input";
import { useProductSkuField } from "../../hooks/useProductSkuField";
import { slugify } from "../../utils/slugify";
import { supabaseClient } from "../../providers/supabase-client";
import {
  getStoragePathFromReference,
  MEDIA_BUCKET,
} from "../../utils/storage";

const PRODUCT_WEIGHT_RULES = [
  { required: true, message: "Product weight is required for shipping" },
  {
    type: "number" as const,
    min: 1,
    message: "Product weight must be greater than 0 gram",
  },
];

interface ProductImage { id: string; url: string; sort_order: number }

interface ProductData {
  id?: string;
  product_images?: ProductImage[];
}

type ProductFormValues = Record<string, unknown>;

function normalizeProductImageValue(value: string): string {
  return getStoragePathFromReference(value, MEDIA_BUCKET) ?? value;
}

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

  const data = query?.data?.data as ProductData | undefined;
  const {
    handleDuplicateSkuSubmitError,
    handleSkuBlur,
    normalizeAndValidateSku,
    skuRules,
  } = useProductSkuField({ form, translate, currentProductId: data?.id });

  useEffect(() => {
    if (data?.product_images && Array.isArray(data.product_images)) {
      const urls = [...data.product_images]
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map((p) => normalizeProductImageValue(p.url));
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

  const handleFinish = async (values: ProductFormValues) => {
    const { images = [], ...productValues } = values;
    const sku = await normalizeAndValidateSku(productValues.sku);
    let result: { data?: { id?: string } } | undefined;

    try {
      result = (await formProps.onFinish?.({ ...productValues, sku })) as
        | { data?: { id?: string } }
        | undefined;
    } catch (error) {
      handleDuplicateSkuSubmitError(error);
      throw error;
    }
    const productId = result?.data?.id;
    if (!productId) return result;

    const currentUrls = Array.isArray(images) ? (images as string[]) : [];
    const original = (data?.product_images ?? []) as ProductImage[];

    try {
      const normalizedOriginal = original.map((item) => ({
        ...item,
        normalizedUrl: normalizeProductImageValue(item.url),
      }));

      const removed = normalizedOriginal.filter((o) => !currentUrls.includes(o.normalizedUrl));
      const removedResults = await Promise.allSettled(
        removed.map(async (img) => {
          const path = getStoragePathFromReference(img.normalizedUrl, MEDIA_BUCKET);
          if (path) {
            await supabaseClient.storage.from(MEDIA_BUCKET).remove([path]);
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
          const existing = normalizedOriginal.find((o) => o.normalizedUrl === url);
          if (existing) {
            const { error: updateError } = await supabaseClient
              .from("product_images")
              .update({ sort_order: i, url })
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
        form={form}
        layout="vertical"
        onValuesChange={handleValuesChange}
        onFinish={handleFinish}
      >
        <Form.Item label={translate("products.fields.name")} name="name" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item
          label={translate("products.fields.sku")}
          name="sku"
          rules={skuRules}
        >
          <Input onBlur={handleSkuBlur} />
        </Form.Item>
        <Form.Item label={translate("products.fields.slug")} name="slug" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item label={translate("products.fields.description")} name="description" getValueFromEvent={(val: string) => val}>
          <DescriptionEditorModal maxLength={5000} />
        </Form.Item>
        <Form.Item label={translate("products.fields.price")} name="price" rules={[{ required: true }]}>
          <InputNumber style={{ width: "100%" }} min={0} />
        </Form.Item>
        <Form.Item label={translate("products.fields.stock")} name="stock">
          <InputNumber style={{ width: "100%" }} min={0} />
        </Form.Item>
        <Form.Item
          label={translate("products.fields.weight")}
          name="weight"
          rules={PRODUCT_WEIGHT_RULES}
          extra="Required for shipping rates and Biteship order creation."
        >
          <ProductWeightInput />
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
