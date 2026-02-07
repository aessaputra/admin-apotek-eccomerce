import { Upload } from "antd";
import type { RcFile } from "antd/es/upload/interface";
import { supabaseClient } from "../../providers/supabase-client";
import { PRODUCT_IMAGES_BUCKET } from "../../utils/storage";

interface ProductImageUploadProps {
  value?: string[];
  onChange?: (urls: string[]) => void;
}

export const ProductImageUpload: React.FC<ProductImageUploadProps> = ({
  value = [],
  onChange,
}) => {
  const fileList = (Array.isArray(value) ? value : []).map((url, i) => ({
    uid: `-${i}-${url}`,
    name: `image-${i + 1}`,
    url,
    status: "done" as const,
  }));

  const handleRemove = (url: string) => {
    const next = (value || []).filter((u) => u !== url);
    onChange?.(next);
  };

  return (
    <Upload
      listType="picture-card"
      maxCount={10}
      multiple
      accept="image/*"
      fileList={fileList}
      onRemove={(file) => {
        const url = (file as { url?: string }).url;
        if (url) handleRemove(url);
      }}
      customRequest={async ({ file, onError, onSuccess }) => {
        try {
          const rcFile = file as RcFile;
          const path = `images/${Date.now()}-${rcFile.name}`;
          const { error } = await supabaseClient.storage
            .from(PRODUCT_IMAGES_BUCKET)
            .upload(path, rcFile, {
              upsert: true,
              cacheControl: "3600",
            });

          if (error) throw error;

          const { data } = supabaseClient.storage
            .from(PRODUCT_IMAGES_BUCKET)
            .getPublicUrl(path);

          onChange?.([...(value || []), data.publicUrl]);
          onSuccess?.({ url: data.publicUrl });
        } catch (err) {
          onError?.(err as Error);
        }
      }}
    >
      {fileList.length < 10 ? "+ Upload" : null}
    </Upload>
  );
};
