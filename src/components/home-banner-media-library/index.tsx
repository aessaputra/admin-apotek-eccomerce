import { useCallback, useEffect, useState } from "react";
import { App, Button, Card, Empty, Flex, Image, List, Modal, Popconfirm, Space, Spin, Typography, message } from "antd";
import { DeleteOutlined, EyeOutlined, ReloadOutlined } from "@ant-design/icons";
import { useTranslation } from "@refinedev/core";
import { getHomeBannerStoragePrefix, isHomeBannerPlacementKey, type HomeBannerPlacementKey } from "../../constants/home-banners";
import { supabaseClient } from "../../providers/supabase-client";
import { getPublicUrlFromStoragePath, MEDIA_BUCKET } from "../../utils/storage";

interface StoredObject {
  name: string;
  id: string;
  updated_at: string;
  created_at: string;
  last_accessed_at: string;
  metadata: Record<string, unknown>;
}

interface MediaLibraryProps {
  placementKey: string | null;
  onSelect: (path: string | null) => void;
  selectedPath: string | null;
}

function getObjectLabel(path: string): string {
  const segments = path.split("/");
  return segments[segments.length - 1] || path;
}

function formatDate(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return isoString;
  }
}

export const HomeBannerMediaLibrary: React.FC<MediaLibraryProps> = ({
  placementKey,
  onSelect,
  selectedPath,
}) => {
  const { translate } = useTranslation();
  const { modal } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [objects, setObjects] = useState<StoredObject[]>([]);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const resolvedPlacementKey = isHomeBannerPlacementKey(placementKey) ? placementKey : null;

  const loadObjects = useCallback(async () => {
    if (!resolvedPlacementKey) {
      setObjects([]);
      return;
    }

    setLoading(true);
    const prefix = getHomeBannerStoragePrefix(resolvedPlacementKey);

    const { data, error } = await supabaseClient.storage
      .from(MEDIA_BUCKET)
      .list(prefix, {
        limit: 100,
        sortBy: { column: "created_at", order: "desc" },
      });

    setLoading(false);

    if (error) {
      message.error(error.message);
      setObjects([]);
      return;
    }

    setObjects((data ?? []) as StoredObject[]);
  }, [resolvedPlacementKey]);

  useEffect(() => {
    void loadObjects();
  }, [loadObjects]);

  const handlePreview = (objectPath: string) => {
    const url = getPublicUrlFromStoragePath(objectPath, MEDIA_BUCKET);
    setPreviewPath(objectPath);
    setPreviewUrl(url);
  };

  const checkMediaReferences = async (mediaPath: string): Promise<boolean> => {
    const { data, error } = await supabaseClient
      .from("home_banners")
      .select("id")
      .eq("media_path", mediaPath);

    if (error) {
      throw error;
    }

    return Array.isArray(data) && data.length > 0;
  };

  const handleDelete = async (objectPath: string) => {
    setDeleting(objectPath);

    try {
      const hasReferences = await checkMediaReferences(objectPath);

      if (hasReferences) {
        modal.error({
          title: translate("homeBanners.mediaLibrary.deleteBlockedTitle"),
          content: translate("homeBanners.mediaLibrary.deleteBlockedContent"),
        });
        setDeleting(null);
        return;
      }

      const { error } = await supabaseClient.storage
        .from(MEDIA_BUCKET)
        .remove([objectPath]);

      if (error) {
        throw error;
      }

      message.success(translate("homeBanners.mediaLibrary.deleteSuccess"));
      await loadObjects();

      if (selectedPath === objectPath) {
        onSelect(null as unknown as string);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Delete failed";
      message.error(errorMsg);
    } finally {
      setDeleting(null);
    }
  };

  const showDeleteConfirm = (objectPath: string) => {
    modal.confirm({
      title: translate("homeBanners.mediaLibrary.deleteConfirmTitle"),
      content: translate("homeBanners.mediaLibrary.deleteConfirmContent", {
        filename: getObjectLabel(objectPath),
      }),
      okText: translate("homeBanners.mediaLibrary.deleteConfirmOk"),
      okButtonProps: { danger: true },
      cancelText: translate("buttons.cancel"),
      onOk: () => handleDelete(objectPath),
    });
  };

  if (!resolvedPlacementKey) {
    return (
      <Typography.Text type="secondary">
        {translate("homeBanners.mediaLibrary.selectPlacementHint")}
      </Typography.Text>
    );
  }

    return (
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Flex justify="flex-end" align="center">
        <Button
          icon={<ReloadOutlined />}
          onClick={() => void loadObjects()}
          loading={loading}
          size="small"
        >
          {translate("homeBanners.mediaLibrary.refresh")}
        </Button>
      </Flex>

      {loading ? (
        <Spin />
      ) : objects.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={translate("homeBanners.mediaLibrary.noAssets")}
        />
      ) : (
        <List
          dataSource={objects}
          renderItem={(item) => {
            const objectPath = `${getHomeBannerStoragePrefix(resolvedPlacementKey)}${item.name}`;
            const publicUrl = getPublicUrlFromStoragePath(objectPath, MEDIA_BUCKET);
            const isSelected = selectedPath === objectPath;
            const isDeleting = deleting === objectPath;

            return (
              <List.Item>
                <Card
                  size="small"
                  hoverable
                  style={{ width: "100%" }}
                  styles={{ body: { padding: 12 } }}
                  onClick={() => onSelect(objectPath)}
                >
                  <Flex gap={12} align="center">
                    <Image
                      src={publicUrl ?? undefined}
                      alt={item.name}
                      width={64}
                      height={64}
                      style={{ objectFit: "cover", borderRadius: 4 }}
                      preview={false}
                      fallback="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64'%3E%3Crect fill='%23f0f0f0' width='64' height='64'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%23999' font-size='10'%3ENo preview%3C/text%3E%3C/svg%3E"
                    />
                    <Flex vertical style={{ flex: 1, minWidth: 0 }}>
                      <Typography.Text
                        ellipsis
                        strong={isSelected}
                        style={{ color: isSelected ? "#1890ff" : undefined }}
                      >
                        {getObjectLabel(objectPath)}
                      </Typography.Text>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {translate("homeBanners.mediaLibrary.uploadedOn", {
                          date: formatDate(item.created_at),
                        })}
                      </Typography.Text>
                    </Flex>
                    <Space>
                      <Button
                        size="small"
                        icon={<EyeOutlined />}
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePreview(objectPath);
                        }}
                      >
                        {translate("homeBanners.mediaLibrary.preview")}
                      </Button>
                      <Popconfirm
                        title={translate("homeBanners.mediaLibrary.deleteConfirmTitle")}
                        description={translate("homeBanners.mediaLibrary.deleteConfirmContent", {
                          filename: getObjectLabel(objectPath),
                        })}
                        onConfirm={(e) => {
                          e?.stopPropagation();
                          void handleDelete(objectPath);
                        }}
                        onCancel={(e) => e?.stopPropagation()}
                        okText={translate("homeBanners.mediaLibrary.deleteConfirmOk")}
                        cancelText={translate("buttons.cancel")}
                        okButtonProps={{ danger: true, loading: isDeleting }}
                      >
                        <Button
                          size="small"
                          danger
                          icon={<DeleteOutlined />}
                          loading={isDeleting}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {translate("homeBanners.mediaLibrary.delete")}
                        </Button>
                      </Popconfirm>
                    </Space>
                  </Flex>
                </Card>
              </List.Item>
            );
          }}
        />
      )}

      <Modal
        open={previewUrl !== null}
        footer={null}
        onCancel={() => {
          setPreviewPath(null);
          setPreviewUrl(null);
        }}
        title={previewPath ? getObjectLabel(previewPath) : null}
        width={720}
      >
        {previewUrl ? (
          <div style={{ textAlign: "center" }}>
            <img
              src={previewUrl}
              alt={translate("homeBanners.media.previewAlt")}
              style={{ maxWidth: "100%", maxHeight: "60vh", objectFit: "contain" }}
            />
            <Typography.Text type="secondary" style={{ display: "block", marginTop: 8 }}>
              {previewPath}
            </Typography.Text>
          </div>
        ) : null}
      </Modal>
    </Space>
  );
};
