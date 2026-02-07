import { Upload } from "antd";
import type { RcFile } from "antd/es/upload/interface";
import { supabaseClient } from "../../providers/supabase-client";
import { getStoragePathFromPublicUrl } from "../../utils/storage";

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

  return (
    <Upload
      listType="picture-card"
      maxCount={1}
      accept="image/*"
      fileList={fileList}
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
              await supabaseClient.storage.from(BUCKET).remove([oldPath]);
            }
          }

          const rcFile = file as RcFile;
          const path = `${userId}/${Date.now()}-${rcFile.name}`;
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
