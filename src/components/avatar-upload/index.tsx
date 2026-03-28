import { Upload } from "antd";
import { useSupabaseUpload } from "../../hooks/useSupabaseUpload";
import { MEDIA_BUCKET } from "../../utils/storage";

interface AvatarUploadProps {
  value?: string;
  onChange?: (url: string | undefined) => void;
}

export const AvatarUpload: React.FC<AvatarUploadProps> = ({
  value,
  onChange,
}) => {
  const fileList = value
    ? [{ uid: "-1", name: "avatar", url: value, status: "done" as const }]
    : [];

  const { beforeUpload, customRequest, handleRemove } = useSupabaseUpload(
    {
      bucket: MEDIA_BUCKET,
      pathPrefix: "avatars/",
      maxCount: 1,
      replaceOnUpload: true,
      includeUserId: true,
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
