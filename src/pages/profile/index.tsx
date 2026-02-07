import { useGetIdentity, useInvalidate } from "@refinedev/core";
import { Edit, useForm } from "@refinedev/antd";
import { Form, Input } from "antd";
import { AvatarUpload } from "../../components/avatar-upload";

export const Profile: React.FC = () => {
  const { data: user } = useGetIdentity<{ id: string }>();
  const invalidate = useInvalidate();
  const { formProps, saveButtonProps } = useForm({
    action: "edit",
    resource: "profiles",
    id: user?.id ?? "",
    redirect: false,
    mutationMode: "pessimistic",
    queryOptions: {
      enabled: !!user?.id,
    },
    onMutationSuccess: () => {
      invalidate({ invalidates: ["all"] });
    },
  });

  if (!user?.id) {
    return null;
  }

  return (
    <Edit
      saveButtonProps={saveButtonProps}
      title="Profil Saya"
      breadcrumb={false}
    >
      <Form {...formProps} layout="vertical">
        <Form.Item label="Nama Lengkap" name="full_name">
          <Input placeholder="Masukkan nama lengkap" />
        </Form.Item>
        <Form.Item label="Avatar" name="avatar_url">
          <AvatarUpload userId={user.id} />
        </Form.Item>
      </Form>
    </Edit>
  );
};
