import { Create, useForm, useSelect } from "@refinedev/antd";
import { Form, Input, InputNumber, Select } from "antd";
import { ProductImageUpload } from "../../components/product-image-upload";
import { slugify } from "../../utils/slugify";
import { supabaseClient } from "../../providers/supabase-client";

export const ProductCreate: React.FC = () => {
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
      await supabaseClient.from("product_images").insert(
        (images as string[]).map((url, i) => ({
          product_id: productId,
          url,
          sort_order: i,
        }))
      );
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
        <Form.Item label="Name" name="name" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item label="Slug" name="slug" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item label="Description" name="description">
          <Input.TextArea />
        </Form.Item>
        <Form.Item label="Price" name="price" rules={[{ required: true }]}>
          <InputNumber style={{ width: "100%" }} min={0} />
        </Form.Item>
        <Form.Item label="Stock" name="stock" initialValue={0}>
          <InputNumber style={{ width: "100%" }} min={0} />
        </Form.Item>
        <Form.Item label="Category" name="category_id">
          <Select {...selectProps} />
        </Form.Item>
        <Form.Item label="Images" name="images">
          <ProductImageUpload />
        </Form.Item>
        <Form.Item label="Active" name="is_active" initialValue={true}>
          <Select options={[{ value: true, label: "Yes" }, { value: false, label: "No" }]} />
        </Form.Item>
      </Form>
    </Create>
  );
};
