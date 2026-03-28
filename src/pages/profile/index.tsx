import { useGetIdentity, useInvalidate, useUpdatePassword, useTranslation } from "@refinedev/core";
import { Edit, useForm } from "@refinedev/antd";
import { Divider, Form, Input, Button, message } from "antd";
import { LockOutlined } from "@ant-design/icons";
import { AvatarUpload } from "../../components/avatar-upload";

type IdentityUser = { id: string };

const ProfileForms: React.FC<{ userId: string }> = ({ userId }) => {
  const { translate } = useTranslation();
  const invalidate = useInvalidate();
  const [passwordForm] = Form.useForm();
  const { mutate: updatePassword, isPending: isPasswordLoading } = useUpdatePassword();

  const { formProps, saveButtonProps } = useForm({
    action: "edit",
    resource: "profiles",
    id: userId,
    redirect: false,
    mutationMode: "pessimistic",
    onMutationSuccess: () => {
      invalidate({ invalidates: ["all"] });
    },
  });

  const onPasswordFinish = (values: { password: string; confirmPassword: string }) => {
    if (values.password !== values.confirmPassword) {
      message.error(translate("profile.passwordMismatch"));
      return;
    }
    updatePassword(
      { password: values.password },
      {
        onSuccess: (data) => {
          if (data?.success === false && data?.error) {
            message.error(data.error.message ?? translate("profile.passwordError"));
            return;
          }
          message.success(translate("profile.passwordSuccess"));
          passwordForm.resetFields();
        },
        onError: (error) => {
          message.error(error?.message ?? translate("profile.passwordError"));
        },
      }
    );
  };

  return (
    <Edit
      saveButtonProps={saveButtonProps}
      title={translate("profile.title")}
      breadcrumb={false}
      contentProps={{ style: { display: "flex", flexDirection: "column", gap: 24 } }}
    >
      <Form {...formProps} layout="vertical">
        <Form.Item label={translate("profile.fields.fullName")} name="full_name">
          <Input placeholder={translate("profile.fields.fullNamePlaceholder")} />
        </Form.Item>
        <Form.Item label={translate("profile.fields.avatar")} name="avatar_url">
          <AvatarUpload />
        </Form.Item>
      </Form>

      <Divider orientation="left" plain>
        {translate("profile.changePassword")}
      </Divider>

      <Form
        form={passwordForm}
        layout="vertical"
        onFinish={onPasswordFinish}
        requiredMark={false}
        style={{ maxWidth: 400 }}
      >
        <Form.Item
          label={translate("profile.newPassword")}
          name="password"
          rules={[
            { required: true, message: translate("profile.passwordRequired") },
            { min: 8, message: translate("profile.passwordMinLength") },
          ]}
        >
          <Input.Password
            prefix={<LockOutlined />}
            placeholder={translate("profile.newPasswordPlaceholder")}
            autoComplete="new-password"
          />
        </Form.Item>
        <Form.Item
          label={translate("profile.confirmPassword")}
          name="confirmPassword"
          dependencies={["password"]}
          rules={[
            { required: true, message: translate("profile.confirmRequired") },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue("password") === value) {
                  return Promise.resolve();
                }
                return Promise.reject(new Error(translate("profile.passwordNotMatch")));
              },
            }),
          ]}
        >
          <Input.Password
            prefix={<LockOutlined />}
            placeholder={translate("profile.confirmPasswordPlaceholder")}
            autoComplete="new-password"
          />
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit" loading={isPasswordLoading}>
            {translate("profile.changePassword")}
          </Button>
        </Form.Item>
      </Form>
    </Edit>
  );
};

export const Profile: React.FC = () => {
  const { data: user } = useGetIdentity<IdentityUser>();

  if (!user?.id) {
    return null;
  }

  return <ProfileForms userId={user.id} />;
};
