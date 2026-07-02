import { useCallback } from "react";
import { message } from "antd";
import type { RcFile } from "antd/es/upload/interface";
import { supabaseClient } from "../providers/supabase-client";
import {
  getPublicUrlFromStoragePath,
  getStoragePathFromReference,
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
          const oldPath = getStoragePathFromReference(value, bucket);
          if (oldPath) {
            try {
              await supabaseClient.storage.from(bucket).remove([oldPath]);
            } catch {
              // Silent catch
            }
          }
        }

        const fileExt = rcFile.name.split('.').pop()?.toLowerCase() || 'jpg';
        const d = new Date();
        const yyyymmdd = d.getFullYear().toString() + (d.getMonth() + 1).toString().padStart(2, '0') + d.getDate().toString().padStart(2, '0');
        const randomHex = Math.random().toString(36).substring(2, 8);
        
        let prefix = 'IMG';
        if (pathPrefix.startsWith('avatars/')) prefix = 'USR';
        else if (pathPrefix.startsWith('products/')) prefix = 'PRD';
        else if (pathPrefix.startsWith('categories/')) prefix = 'CTG';
        else if (pathPrefix.startsWith('banners/')) prefix = 'BNR';

        // UUID is no longer needed in the path because we rely on the owner column in RLS
        const fileName = `${prefix}_${yyyymmdd}_${randomHex}.${fileExt}`;
        const path = `${pathPrefix}${fileName}`;

        const { error } = await supabaseClient.storage
          .from(bucket)
          .upload(path, rcFile, {
            upsert: true,
            cacheControl: "3600",
          });

        if (error) throw error;

        const publicUrl = getPublicUrlFromStoragePath(path, bucket);

        if (Array.isArray(value)) {
          (onChange as (v: string[]) => void)?.([...value, path]);
        } else {
          (onChange as (v: string | undefined) => void)?.(path);
        }

        onSuccess?.({ path, url: publicUrl });
      } catch (err) {
        onError?.(err as Error);
      }
    },
    [bucket, pathPrefix, replaceOnUpload, includeUserId, value, onChange]
  );

  const handleRemove = useCallback(
    async (url: string) => {
      const path = getStoragePathFromReference(url, bucket);
      if (path) {
        try {
          await supabaseClient.storage.from(bucket).remove([path]);
        } catch {
          // Silent catch
        }
      }

      if (Array.isArray(value)) {
        const pathToRemove = path || url;
        const next = value.filter((u) => {
          const uPath = getStoragePathFromReference(u, bucket) || u;
          return uPath !== pathToRemove;
        });
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
