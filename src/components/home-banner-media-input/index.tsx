import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Empty, Flex, Image, Modal, Radio, Select, Space, Typography, Upload, message } from "antd";
import { EyeOutlined, FolderOutlined } from "@ant-design/icons";
import type { RcFile } from "antd/es/upload/interface";
import { useTranslation } from "@refinedev/core";
import {
  getHomeBannerAspectRatioDifferencePercent,
  getHomeBannerMediaSpec,
  getHomeBannerStoragePrefix,
  HOME_BANNER_ALLOWED_IMAGE_TYPES,
  isHomeBannerPlacementKey,
} from "../../constants/home-banners";
import { supabaseClient } from "../../providers/supabase-client";
import {
  getPublicUrlFromStoragePath,
  MEDIA_BUCKET,
  sanitizeFilename,
  validateImageFile,
} from "../../utils/storage";

type MediaInputMode = "upload" | "existing";

interface HomeBannerMediaInputProps {
  value?: string | null;
  onChange?: (value: string | null) => void;
  placementKey?: string | null;
  intent?: string | null;
}

interface ExistingObjectOption {
  label: string;
  value: string;
}

function getObjectLabel(path: string): string {
  const segments = path.split("/");
  return segments[segments.length - 1] || path;
}

export const HomeBannerMediaInput: React.FC<HomeBannerMediaInputProps> = ({
  value,
  onChange,
  placementKey,
  intent,
}) => {
  const { translate } = useTranslation();
  const [mode, setMode] = useState<MediaInputMode>(value ? "existing" : "upload");
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [existingOptions, setExistingOptions] = useState<ExistingObjectOption[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);

  const resolvedPlacementKey = isHomeBannerPlacementKey(placementKey) ? placementKey : null;
  const previewUrl = value ? getPublicUrlFromStoragePath(value, MEDIA_BUCKET) : null;
  const mediaSpec = resolvedPlacementKey ? getHomeBannerMediaSpec(resolvedPlacementKey) : null;

  useEffect(() => {
    if (!value) {
      setMode("upload");
      setWarnings([]);
    }
  }, [value]);

  const loadExistingObjects = useCallback(async () => {
    if (!resolvedPlacementKey) {
      setExistingOptions([]);
      return;
    }

    setLoadingExisting(true);

    const prefix = getHomeBannerStoragePrefix(resolvedPlacementKey);
    const { data, error } = await supabaseClient.storage.from(MEDIA_BUCKET).list(prefix, {
      limit: 100,
      sortBy: { column: "name", order: "desc" },
    });

    setLoadingExisting(false);

    if (error) {
      message.error(error.message);
      setExistingOptions([]);
      return;
    }

    const nextOptions = (data ?? [])
      .filter((item) => typeof item.name === "string" && item.name.length > 0)
      .map((item) => {
        const objectPath = `${prefix}${item.name}`;
        return { label: getObjectLabel(objectPath), value: objectPath };
      });

    setExistingOptions(nextOptions);
  }, [resolvedPlacementKey]);

  useEffect(() => {
    if (mode !== "existing") {
      return;
    }

    void loadExistingObjects();
  }, [loadExistingObjects, mode]);

  const existingSelectOptions = useMemo(() => {
    if (!value || existingOptions.some((option) => option.value === value)) {
      return existingOptions;
    }

    return [{ label: getObjectLabel(value), value }, ...existingOptions];
  }, [existingOptions, value]);

  const beforeUpload = useCallback((file: RcFile) => {
    const { valid, error } = validateImageFile(file);
    if (!valid) {
      message.error(error);
      return false;
    }

    if (!resolvedPlacementKey) {
      message.error(translate("homeBanners.media.selectPlacementFirst"));
      return false;
    }

    if (!HOME_BANNER_ALLOWED_IMAGE_TYPES.includes(file.type.toLowerCase() as (typeof HOME_BANNER_ALLOWED_IMAGE_TYPES)[number])) {
      message.error(translate("homeBanners.media.invalidFormat"));
      return false;
    }

    return true;
  }, [resolvedPlacementKey, translate]);

  const analyzeFileWarnings = useCallback(async (file: RcFile) => {
    if (!resolvedPlacementKey) {
      return [] as string[];
    }

    const nextWarnings: string[] = [];
    const spec = getHomeBannerMediaSpec(resolvedPlacementKey);
    const fileType = file.type.toLowerCase();

    if (fileType === "image/jpeg") {
      nextWarnings.push(translate("homeBanners.warnings.jpegFallback"));
    }

    if (fileType === "image/png") {
      nextWarnings.push(translate("homeBanners.warnings.pngConditional"));
    }

    if (file.size > spec.recommendedMaxFileSizeKb * 1024) {
      nextWarnings.push(
        translate("homeBanners.warnings.fileTooLarge", {
          maxSizeKb: spec.recommendedMaxFileSizeKb,
        })
      );
    }

    const imageUrl = URL.createObjectURL(file);

    try {
      const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
        const image = new window.Image();
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = () => reject(new Error("Failed to inspect image dimensions."));
        image.src = imageUrl;
      });

      const ratioDifference = getHomeBannerAspectRatioDifferencePercent(
        resolvedPlacementKey,
        dimensions.width,
        dimensions.height
      );

      if (ratioDifference > spec.tolerancePercent) {
        nextWarnings.push(
          translate("homeBanners.warnings.ratioMismatch", {
            ratio: `${spec.aspectRatio}:1`,
            width: spec.recommendedWidth,
            height: spec.recommendedHeight,
          })
        );
      }
    } finally {
      URL.revokeObjectURL(imageUrl);
    }

    return nextWarnings;
  }, [resolvedPlacementKey, translate]);

  const customRequest = useCallback(async (options: {
    file: unknown;
    onError?: (error: Error) => void;
    onSuccess?: (body: unknown) => void;
  }) => {
    if (!resolvedPlacementKey) {
      options.onError?.(new Error("Placement is required before uploading."));
      return;
    }

    try {
      const file = options.file as RcFile;
      const nextWarnings = await analyzeFileWarnings(file);
      const safeName = sanitizeFilename(file.name);
      const path = `${getHomeBannerStoragePrefix(resolvedPlacementKey)}${Date.now()}-${safeName}`;

      const { error } = await supabaseClient.storage.from(MEDIA_BUCKET).upload(path, file, {
        upsert: true,
        cacheControl: "3600",
      });

      if (error) {
        throw error;
      }

      setWarnings(nextWarnings);
      onChange?.(path);
      options.onSuccess?.({ path });
      message.success(translate("homeBanners.media.uploadSuccess"));
    } catch (error) {
      const uploadError = error instanceof Error ? error : new Error("Upload failed.");
      options.onError?.(uploadError);
      message.error(uploadError.message);
    }
  }, [analyzeFileWarnings, onChange, resolvedPlacementKey, translate]);

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Radio.Group
        optionType="button"
        buttonStyle="solid"
        options={[
          { label: translate("homeBanners.media.actions.upload"), value: "upload" },
          { label: translate("homeBanners.media.actions.pickExisting"), value: "existing" },
        ]}
        value={mode}
        onChange={(event) => setMode(event.target.value as MediaInputMode)}
      />

      {!resolvedPlacementKey ? (
        <Typography.Text type="secondary">
          {translate("homeBanners.media.selectPlacementHint")}
        </Typography.Text>
      ) : null}

      {mediaSpec ? (
        <Alert
          type="info"
          showIcon
          message={translate(`homeBanners.media.specs.${resolvedPlacementKey}`, {
            ratio: `${mediaSpec.aspectRatio}:1`,
            width: mediaSpec.recommendedWidth,
            height: mediaSpec.recommendedHeight,
            maxSizeKb: mediaSpec.recommendedMaxFileSizeKb,
          })}
        />
      ) : null}

      {mode === "upload" ? (
        <Upload
          accept="image/webp,image/jpeg,image/png"
          beforeUpload={beforeUpload}
          customRequest={customRequest}
          showUploadList={false}
          maxCount={1}
          disabled={!resolvedPlacementKey}
        >
          <Button disabled={!resolvedPlacementKey}>{translate("homeBanners.media.actions.uploadMedia")}</Button>
        </Upload>
      ) : (
        <Space direction="vertical" size="small" style={{ width: "100%" }}>
          <Flex gap={8} wrap="wrap">
            <Select
              allowClear
              showSearch
              placeholder={resolvedPlacementKey ? translate("homeBanners.media.selectExistingPlaceholder") : translate("homeBanners.media.selectPlacementPlaceholder")}
              style={{ minWidth: 280, flex: 1 }}
              disabled={!resolvedPlacementKey}
              loading={loadingExisting}
              options={existingSelectOptions}
              value={value ?? undefined}
              onChange={(nextValue) => onChange?.(nextValue ?? null)}
              filterOption={(input, option) =>
                typeof option?.label === "string" && option.label.toLowerCase().includes(input.toLowerCase())
              }
            />
            <Button onClick={() => void loadExistingObjects()} disabled={!resolvedPlacementKey}>
              {translate("homeBanners.media.actions.refresh")}
            </Button>
          </Flex>

          {!loadingExisting && existingSelectOptions.length === 0 && resolvedPlacementKey ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={translate("homeBanners.media.noExistingAssets")} />
          ) : null}
        </Space>
      )}

      {value ? (
        <Flex gap={8}>
          <Button
            icon={<EyeOutlined />}
            onClick={() => setPreviewOpen(true)}
          >
            {translate("homeBanners.media.actions.preview")}
          </Button>
          <Button danger onClick={() => onChange?.(null)}>
            {translate("homeBanners.media.actions.clearSelection")}
          </Button>
        </Flex>
      ) : null}

      {intent === "branding" && !value ? (
        <Alert
          type="warning"
          showIcon
          message={translate("homeBanners.warnings.brandingWithoutImage")}
        />
      ) : null}

      {warnings.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          message={translate("homeBanners.warnings.title")}
          description={
            <Space direction="vertical" size={4}>
              {warnings.map((warning) => (
                <Typography.Text key={warning}>{warning}</Typography.Text>
              ))}
            </Space>
          }
        />
      ) : null}

      <Modal
        open={previewOpen}
        footer={null}
        onCancel={() => setPreviewOpen(false)}
        title={translate("homeBanners.media.previewTitle")}
        width={720}
      >
        {previewUrl ? (
          <div style={{ textAlign: "center" }}>
            <Image
              src={previewUrl}
              alt={translate("homeBanners.media.previewAlt")}
              style={{ maxWidth: "100%", maxHeight: "60vh", objectFit: "contain" }}
            />
            <Typography.Text type="secondary" style={{ display: "block", marginTop: 8 }}>
              {value}
            </Typography.Text>
          </div>
        ) : null}
      </Modal>
    </Space>
  );
};