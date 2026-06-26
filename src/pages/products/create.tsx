import { useRef } from "react";
import { Create, useForm, useSelect } from "@refinedev/antd";
import { useTranslation } from "@refinedev/core";
import { Form, Input, InputNumber, Select, message } from "antd";
import { ProductImageUpload } from "../../components/product-image-upload";
import { DescriptionEditorModal } from "../../components/description-editor-modal";
import { ProductWeightInput } from "../../components/product-weight-input";
import { useProductSkuField } from "../../hooks/useProductSkuField";
import { slugify } from "../../utils/slugify";
import { generateSkuCandidate } from "../../utils/sku";
import { supabaseClient } from "../../providers/supabase-client";

const PRODUCT_WEIGHT_RULES = [
  { required: true, message: "Product weight is required for shipping" },
  {
    type: "number" as const,
    min: 1,
    message: "Product weight must be greater than 0 gram",
  },
];

type ProductFormValues = Record<string, unknown>;

interface SelectOption {
  label?: unknown;
  value?: unknown;
  options?: SelectOption[];
}

function getOptionLabel(options: unknown, value: unknown): string {
  if (!Array.isArray(options)) return "";

  for (const option of options as SelectOption[]) {
    if (option.value === value) {
      return typeof option.label === "string" || typeof option.label === "number"
        ? String(option.label)
        : "";
    }

    const nestedLabel = getOptionLabel(option.options, value);
    if (nestedLabel) return nestedLabel;
  }

  return "";
}

export const ProductCreate: React.FC = () => {
  const { translate } = useTranslation();
  const { formProps, saveButtonProps, form } = useForm();
  const skuTouchedRef = useRef(false);
  const {
    handleDuplicateSkuSubmitError,
    handleSkuBlur,
    normalizeAndValidateSku,
    skuRules,
  } = useProductSkuField({ form, translate });
  const { selectProps } = useSelect({
    resource: "categories",
    optionLabel: "name",
    optionValue: "id",
  });

  const handleValuesChange = (
    changed: Record<string, unknown>,
    all: Record<string, unknown>
  ) => {
    if ("name" in changed && changed.name != null) {
      form.setFieldValue("slug", slugify(String(changed.name)));
    }
    if ("sku" in changed) {
      skuTouchedRef.current = true;
    }
    if (!skuTouchedRef.current && ("name" in changed || "category_id" in changed)) {
      const categoryLabel = getOptionLabel(selectProps.options, all.category_id);
      form.setFieldValue("sku", generateSkuCandidate({
        categorySlugOrName: categoryLabel,
        productName: typeof all.name === "string" ? all.name : "",
      }));
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
    if (productId && Array.isArray(images) && images.length > 0) {
      const { error } = await supabaseClient.from("product_images").insert(
        (images as string[]).map((url, i) => ({
          product_id: productId,
          url,
          sort_order: i,
        }))
      );
      if (error) {
        message.error(translate("products.imagesSaveError"));
        throw error;
      }
    }
    return result;
  };

  return (
    <Create saveButtonProps={saveButtonProps}>
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
          <Input onChange={() => { skuTouchedRef.current = true; }} onBlur={handleSkuBlur} />
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
        <Form.Item label={translate("products.fields.stock")} name="stock" initialValue={0}>
          <InputNumber style={{ width: "100%" }} min={0} />
        </Form.Item>
        <Form.Item
          label={translate("products.fields.weight")}
          name="weight"
          rules={PRODUCT_WEIGHT_RULES}
          extra={translate("products.validation.weightRequired", {}, "Required for shipping rates and Biteship order creation.")}
        >
          <ProductWeightInput />
        </Form.Item>
        <Form.Item label={translate("products.fields.category")} name="category_id">
          <Select {...selectProps} />
        </Form.Item>
        <Form.Item label={translate("products.fields.images")} name="images">
          <ProductImageUpload />
        </Form.Item>
        <Form.Item label={translate("products.fields.active")} name="is_active" initialValue={true}>
          <Select options={[{ value: true, label: translate("products.active.yes") }, { value: false, label: translate("products.active.no") }]} />
        </Form.Item>
      </Form>
    </Create>
  );
};
