import { Edit, useForm } from "@refinedev/antd";
import { useTranslation } from "@refinedev/core";
import { Form, Input } from "antd";
import { CategoryLogoUpload } from "../../components/category-logo-upload";
import { slugify } from "../../utils/slugify";

export const CategoryEdit: React.FC = () => {
  const { translate } = useTranslation();
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
    <Edit saveButtonProps={saveButtonProps}>
      <Form
        {...formProps}
        form={form}
        layout="vertical"
        onValuesChange={handleValuesChange}
      >
        <Form.Item label={translate("categories.fields.name")} name="name" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item label={translate("categories.fields.slug")} name="slug" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item label={translate("categories.fields.logo")} name="logo_url">
          <CategoryLogoUpload />
        </Form.Item>
      </Form>
    </Edit>
  );
};
