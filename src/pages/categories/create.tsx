import { Create, useForm } from "@refinedev/antd";
import { Form, Input } from "antd";
import { CategoryLogoUpload } from "../../components/category-logo-upload";
import { slugify } from "../../utils/slugify";

export const CategoryCreate: React.FC = () => {
  const { formProps, saveButtonProps, form } = useForm();

  const handleValuesChange = (
    changed: Record<string, unknown>,
    all: Record<string, unknown>
  ) => {
    if ("name" in changed && changed.name != null) {
      form.setFieldValue("slug", slugify(String(changed.name)));
    }
    formProps.onValuesChange?.(changed, all);
  };

  return (
    <Create saveButtonProps={saveButtonProps}>
      <Form
        {...formProps}
        layout="vertical"
        onValuesChange={handleValuesChange}
      >
        <Form.Item label="Name" name="name" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item label="Slug" name="slug" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item label="Logo" name="logo_url">
          <CategoryLogoUpload />
        </Form.Item>
      </Form>
    </Create>
  );
};
