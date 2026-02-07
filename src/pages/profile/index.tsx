import { useGetIdentity, useInvalidate, useUpdatePassword } from "@refinedev/core";
import { Edit, useForm } from "@refinedev/antd";
import { Divider, Form, Input, Button, message } from "antd";
import { LockOutlined } from "@ant-design/icons";
import { AvatarUpload } from "../../components/avatar-upload";

export const Profile: React.FC = () => {
  const { data: user } = useGetIdentity<{ id: string }>();
  const invalidate = useInvalidate();
  const [passwordForm] = Form.useForm();
  const { mutate: updatePassword, isLoading: isPasswordLoading } = useUpdatePassword();

  const { formProps, saveButtonProps } = useForm({
    action: "edit",
    resource: "profiles",
    id: user?.id ?? "",
    redirect: false,
    mutationMode: "pessimistic",
    queryOptions: { enabled: !!user?.id },
    onMutationSuccess: () => {
      invalidate({ invalidates: ["all"] });
    },
  });

  const onPasswordFinish = (values: { password: string; confirmPassword: string }) => {
    if (values.password !== values.confirmPassword) {
      message.error("Konfirmasi password tidak cocok.");
      return;
    }
    updatePassword(
      { password: values.password },
      {
        onSuccess: (data) => {
          if (data?.success === false && data?.error) {
            message.error(data.error.message ?? "Gagal mengubah password.");
            return;
          }
          message.success("Password berhasil diubah.");
          passwordForm.resetFields();
        },
        onError: (error) => {
          message.error(error?.message ?? "Gagal mengubah password.");
        },
      }
    );
  };

  if (!user?.id) {
    return null;
  }

  return (
    <Edit
      saveButtonProps={saveButtonProps}
      title="Profil Saya"
      breadcrumb={false}
      contentProps={{ style: { display: "flex", flexDirection: "column", gap: 24 } }}
    >
      <Form {...formProps} layout="vertical">
        <Form.Item label="Nama Lengkap" name="full_name">
          <Input placeholder="Masukkan nama lengkap" />
        </Form.Item>
        <Form.Item label="Avatar" name="avatar_url">
          <AvatarUpload userId={user.id} />
        </Form.Item>
      </Form>

      <Divider orientation="left" plain>
        Ganti Password
      </Divider>

      <Form
        form={passwordForm}
        layout="vertical"
        onFinish={onPasswordFinish}
        requiredMark={false}
        style={{ maxWidth: 400 }}
      >
        <Form.Item
          label="Password Baru"
          name="password"
          rules={[
            { required: true, message: "Masukkan password baru" },
            { min: 6, message: "Password minimal 6 karakter" },
          ]}
        >
          <Input.Password
            prefix={<LockOutlined />}
            placeholder="Masukkan password baru"
            autoComplete="new-password"
          />
        </Form.Item>
        <Form.Item
          label="Konfirmasi Password"
          name="confirmPassword"
          dependencies={["password"]}
          rules={[
            { required: true, message: "Konfirmasi password" },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue("password") === value) {
                  return Promise.resolve();
                }
                return Promise.reject(new Error("Password tidak cocok"));
              },
            }),
          ]}
        >
          <Input.Password
            prefix={<LockOutlined />}
            placeholder="Ulangi password baru"
            autoComplete="new-password"
          />
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit" loading={isPasswordLoading}>
            Ganti Password
          </Button>
        </Form.Item>
      </Form>
    </Edit>
  );
};
