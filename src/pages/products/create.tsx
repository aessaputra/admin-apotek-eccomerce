import { useRef } from "react";
import dayjs from "dayjs";
import { Create, useForm, useSelect } from "@refinedev/antd";
import { useTranslation } from "@refinedev/core";
import { Form, Input, InputNumber, Select, DatePicker, message } from "antd";
import { ProductImageUpload } from "../../components/product-image-upload";
import { DescriptionEditorModal } from "../../components/description-editor-modal";
import { ProductWeightInput } from "../../components/product-weight-input";
import { useProductSkuField } from "../../hooks/useProductSkuField";
import { slugify } from "../../utils/slugify";
import { generateSkuCandidate } from "../../utils/sku";
import { supabaseClient } from "../../providers/supabase-client";



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
        <Form.Item
          label={translate("products.fields.name")}
          name="name"
          rules={[
            { required: true, message: translate("products.validation.nameRequired") },
            { max: 120, message: translate("products.validation.nameMax") },
          ]}
        >
          <Input maxLength={120} showCount />
        </Form.Item>
        <Form.Item
          label={translate("products.fields.sku")}
          name="sku"
          rules={skuRules}
        >
          <Input onChange={() => { skuTouchedRef.current = true; }} onBlur={handleSkuBlur} />
        </Form.Item>
        <Form.Item
          label={translate("products.fields.slug")}
          name="slug"
          rules={[
            { required: true, message: translate("products.validation.slugRequired") },
            { max: 75, message: "Slug produk maksimal 75 karakter." },
          ]}
        >
          <Input maxLength={75} showCount />
        </Form.Item>
        <Form.Item label={translate("products.fields.description")} name="description" getValueFromEvent={(val: string) => val}>
          <DescriptionEditorModal maxLength={500} />
        </Form.Item>
        <Form.Item label={translate("products.fields.price")} name="price" rules={[{ required: true, message: translate("products.validation.priceRequired") }]}>
          <InputNumber style={{ width: "100%" }} min={0} />
        </Form.Item>
        <Form.Item
          label={translate("products.fields.stock")}
          name="stock"
          initialValue={0}
          rules={[
            { type: "number", min: 0, message: translate("products.validation.stockMin", {}, "Stock cannot be negative.") },
            { type: "number", max: 99999, message: translate("products.validation.stockMax") },
          ]}
        >
          <InputNumber style={{ width: "100%" }} min={0} max={99999} />
        </Form.Item>
        <Form.Item
          label={translate("products.fields.weight")}
          name="weight"
          rules={[
            { required: true, message: translate("products.validation.weightRequiredRule") },
            {
              type: "number",
              min: 1,
              message: translate("products.validation.weightMin"),
            },
            {
              type: "number",
              max: 20000,
              message: translate("products.validation.weightMax"),
            },
          ]}
          extra={translate("products.validation.weightRequired", {}, "Required for shipping rates and Biteship order creation.")}
        >
          <ProductWeightInput />
        </Form.Item>
        <Form.Item
          label={translate("products.fields.expiryDate", "Tanggal Kedaluwarsa")}
          name="expiry_date"
          getValueProps={(value) => ({
            value: value ? dayjs(value) : undefined,
          })}
          getValueFromEvent={(date: unknown) =>
            date && typeof (date as { format?: unknown }).format === "function"
              ? (date as { format: (f: string) => string }).format("YYYY-MM-DD")
              : null
          }
        >
          <DatePicker
            style={{ width: "100%" }}
            format="YYYY-MM-DD"
            placeholder={translate("products.placeholder.expiryDate", "Pilih tanggal ED")}
          />
        </Form.Item>
        <Form.Item
          label={translate("products.fields.batchNumber", "Nomor Batch")}
          name="batch_number"
        >
          <Input
            placeholder={translate("products.placeholder.batchNumber", "Opsional (misal: BCH-2026-0801)")}
            allowClear
          />
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
