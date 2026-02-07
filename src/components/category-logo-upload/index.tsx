import { Upload } from "antd";
import type { RcFile } from "antd/es/upload/interface";
import { supabaseClient } from "../../providers/supabase-client";

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

  return (
    <Upload
      listType="picture-card"
      maxCount={1}
      accept="image/*"
      fileList={fileList}
      onRemove={() => onChange?.(undefined)}
      customRequest={async ({ file, onError, onSuccess }) => {
        try {
          const rcFile = file as RcFile;
          const path = `logos/${Date.now()}-${rcFile.name}`;
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
