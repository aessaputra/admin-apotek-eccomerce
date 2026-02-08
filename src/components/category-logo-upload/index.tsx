import { message, Upload } from "antd";
import type { RcFile } from "antd/es/upload/interface";
import { supabaseClient } from "../../providers/supabase-client";
import { getStoragePathFromPublicUrl, sanitizeFilename, validateImageFile } from "../../utils/storage";

const BUCKET = "category-logos";

interface CategoryLogoUploadProps {
  value?: string;
  onChange?: (url: string | undefined) => void;
}

export const CategoryLogoUpload: React.FC<CategoryLogoUploadProps> = ({
  value,
  onChange,
}) => {
  const fileList = value
    ? [{ uid: "-1", name: "logo", url: value, status: "done" as const }]
    : [];

  const beforeUpload = (file: RcFile) => {
    const { valid, error } = validateImageFile(file);
    if (!valid) {
      message.error(error);
      return false;
    }
    return true;
  };

  return (
    <Upload
      listType="picture-card"
      maxCount={1}
      accept="image/jpeg,image/png,image/webp,image/gif"
      fileList={fileList}
      beforeUpload={beforeUpload}
      onRemove={async () => {
        if (value) {
          const oldPath = getStoragePathFromPublicUrl(value, BUCKET);
          if (oldPath) {
            try {
              await supabaseClient.storage.from(BUCKET).remove([oldPath]);
            } catch {
              // Continue even if delete fails
            }
          }
        }
        onChange?.(undefined);
      }}
      customRequest={async ({ file, onError, onSuccess }) => {
        try {
          if (value) {
            const oldPath = getStoragePathFromPublicUrl(value, BUCKET);
            if (oldPath) {
              try {
                await supabaseClient.storage.from(BUCKET).remove([oldPath]);
              } catch {
                // Continue even if delete fails
              }
            }
          }

          const rcFile = file as RcFile;
          const safeName = sanitizeFilename(rcFile.name);
          const path = `logos/${Date.now()}-${safeName}`;
          const { error } = await supabaseClient.storage
            .from(BUCKET)
            .upload(path, rcFile, {
              upsert: true,
              cacheControl: "3600",
            });

          if (error) throw error;

          const { data } = supabaseClient.storage
            .from(BUCKET)
            .getPublicUrl(path);

          onChange?.(data.publicUrl);
          onSuccess?.({ url: data.publicUrl });
        } catch (err) {
          onError?.(err as Error);
        }
      }}
    >
      {fileList.length === 0 ? "+ Upload" : null}
    </Upload>
  );
};
