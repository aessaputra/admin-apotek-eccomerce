import { useCallback } from "react";
import { message } from "antd";
import type { RcFile } from "antd/es/upload/interface";
import { supabaseClient } from "../providers/supabase-client";
import {
  getStoragePathFromPublicUrl,
  sanitizeFilename,
  validateImageFile,
} from "../utils/storage";

interface UseSupabaseUploadOptions {
  bucket: string;
  pathPrefix: string; // e.g. "logos/", "images/", or dynamic like `${userId}/`
  maxCount?: number; // default 1
  replaceOnUpload?: boolean; // true for avatar/category (remove old before uploading new), false for product (append)
  includeUserId?: boolean; // true for avatar uploads to comply with RLS policy (e.g., 'avatars/{userId}-{timestamp}-{filename}')
}

interface UseSupabaseUploadReturn {
  beforeUpload: (file: RcFile) => boolean;
  customRequest: (options: {
    file: unknown;
    onError?: (err: Error) => void;
    onSuccess?: (body: unknown) => void;
  }) => void;
  handleRemove: (url: string) => void;
}

export function useSupabaseUpload(
  options: UseSupabaseUploadOptions,
  value: string | string[] | undefined,
  onChange:
    | ((v: string | undefined) => void)
    | ((v: string[]) => void)
    | undefined
): UseSupabaseUploadReturn {
  const { bucket, pathPrefix, replaceOnUpload = false, includeUserId = false } = options;

  const beforeUpload = useCallback((file: RcFile) => {
    const { valid, error } = validateImageFile(file);
    if (!valid) {
      message.error(error);
      return false;
    }
    return true;
  }, []);

  const customRequest = useCallback(
    async ({
      file,
      onError,
      onSuccess,
    }: {
      file: unknown;
      onError?: (err: Error) => void;
      onSuccess?: (body: unknown) => void;
    }) => {
      try {
        const rcFile = file as RcFile;

        // Handle replacement if needed
        if (replaceOnUpload && typeof value === "string" && value) {
          const oldPath = getStoragePathFromPublicUrl(value, bucket);
          if (oldPath) {
            try {
              await supabaseClient.storage.from(bucket).remove([oldPath]);
            } catch {
              // Silent catch
            }
          }
        }

        const safeName = sanitizeFilename(rcFile.name);
        // Get current user ID if includeUserId is enabled (required for avatar RLS policy)
        const { data: { user } } = await supabaseClient.auth.getUser();
        const userIdPrefix = includeUserId && user ? `${user.id}-` : '';
        const path = `${pathPrefix}${userIdPrefix}${Date.now()}-${safeName}`;

        const { error } = await supabaseClient.storage
          .from(bucket)
          .upload(path, rcFile, {
            upsert: true,
            cacheControl: "3600",
          });

        if (error) throw error;

        const { data } = supabaseClient.storage.from(bucket).getPublicUrl(path);

        if (Array.isArray(value)) {
          (onChange as (v: string[]) => void)?.([...value, data.publicUrl]);
        } else {
          (onChange as (v: string | undefined) => void)?.(data.publicUrl);
        }

        onSuccess?.({ url: data.publicUrl });
      } catch (err) {
        onError?.(err as Error);
      }
    },
    [bucket, pathPrefix, replaceOnUpload, includeUserId, value, onChange]
  );

  const handleRemove = useCallback(
    async (url: string) => {
      const path = getStoragePathFromPublicUrl(url, bucket);
      if (path) {
        try {
          await supabaseClient.storage.from(bucket).remove([path]);
        } catch {
          // Silent catch
        }
      }

      if (Array.isArray(value)) {
        const next = value.filter((u) => u !== url);
        (onChange as (v: string[]) => void)?.(next);
      } else {
        (onChange as (v: string | undefined) => void)?.(undefined);
      }
    },
    [bucket, value, onChange]
  );

  return {
    beforeUpload,
    customRequest,
    handleRemove,
  };
}
