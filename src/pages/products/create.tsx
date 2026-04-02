import { Create, useForm, useSelect } from "@refinedev/antd";
import { useTranslation } from "@refinedev/core";
import { Form, Input, InputNumber, Select, message } from "antd";
import { ProductImageUpload } from "../../components/product-image-upload";
import { slugify } from "../../utils/slugify";
import { supabaseClient } from "../../providers/supabase-client";

const PRODUCT_WEIGHT_RULES = [
  { required: true, message: "Product weight is required for shipping" },
  {
    type: "number" as const,
    min: 1,
    message: "Product weight must be greater than 0 gram",
  },
];

export const ProductCreate: React.FC = () => {
  const { translate } = useTranslation();
  const { formProps, saveButtonProps, form } = useForm();
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
    formProps.onValuesChange?.(changed, all);
  };

  const handleFinish = async (values: Record<string, unknown>) => {
    const { images = [], ...productValues } = values;
    const result = (await formProps.onFinish?.({ ...productValues })) as
      | { data?: { id?: string } }
      | undefined;
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
        <Form.Item label={translate("products.fields.stock")} name="stock" initialValue={0}>
          <InputNumber style={{ width: "100%" }} min={0} />
        </Form.Item>
        <Form.Item
          label={translate("products.fields.weight")}
          name="weight"
          rules={PRODUCT_WEIGHT_RULES}
          extra="Required for shipping rates and Biteship order creation."
        >
          <InputNumber style={{ width: "100%" }} min={1} addonAfter="gram" />
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
