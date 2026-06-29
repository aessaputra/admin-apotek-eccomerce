import { Upload } from "antd";
import { useTranslation } from "@refinedev/core";
import { useSupabaseUpload } from "../../hooks/useSupabaseUpload";
import { MEDIA_BUCKET, resolveStoragePublicUrl } from "../../utils/storage";

interface ProductImageUploadProps {
  value?: string[];
  onChange?: (urls: string[]) => void;
}

export const ProductImageUpload: React.FC<ProductImageUploadProps> = ({
  value = [],
  onChange,
}) => {
  const { translate } = useTranslation();
  const fileList = (Array.isArray(value) ? value : []).map((url, i) => ({
    uid: `-${i}-${url}`,
    name: `image-${i + 1}`,
    url: resolveStoragePublicUrl(url, MEDIA_BUCKET) ?? url,
    status: "done" as const,
  }));

  const { beforeUpload, customRequest, handleRemove } = useSupabaseUpload(
    {
      bucket: MEDIA_BUCKET,
      pathPrefix: "products/",
      maxCount: 10,
      replaceOnUpload: false,
    },
    value,
    onChange
  );

  return (
    <Upload
      listType="picture-card"
      maxCount={10}
      multiple
      accept="image/jpeg,image/png,image/webp,image/gif"
      fileList={fileList}
      beforeUpload={beforeUpload}
      onRemove={(file) => {
        const url = (file as { url?: string }).url;
        if (url) handleRemove(url);
      }}
      customRequest={customRequest}
    >
      {fileList.length < 10 ? translate("buttons.upload", "+ Upload") : null}
    </Upload>
  );
};
