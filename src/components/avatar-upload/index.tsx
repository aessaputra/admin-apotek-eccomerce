import { Upload } from "antd";
import { useSupabaseUpload } from "../../hooks/useSupabaseUpload";

const BUCKET = "avatars";

interface AvatarUploadProps {
  value?: string;
  onChange?: (url: string | undefined) => void;
  userId: string;
}

export const AvatarUpload: React.FC<AvatarUploadProps> = ({
  value,
  onChange,
  userId,
}) => {
  const fileList = value
    ? [{ uid: "-1", name: "avatar", url: value, status: "done" as const }]
    : [];

  const { beforeUpload, customRequest, handleRemove } = useSupabaseUpload(
    {
      bucket: BUCKET,
      pathPrefix: `${userId}/`,
      maxCount: 1,
      replaceOnUpload: true,
    },
    value,
    onChange
  );

  return (
    <Upload
      listType="picture-card"
      maxCount={1}
      accept="image/jpeg,image/png,image/webp,image/gif"
      fileList={fileList}
      beforeUpload={beforeUpload}
      onRemove={() => handleRemove(value!)}
      customRequest={customRequest}
    >
      {fileList.length === 0 ? "+ Upload" : null}
    </Upload>
  );
};
