import React from "react";
import { Card, Image, Tag, Typography, Space, Button, Dropdown } from "antd";
import { MoreOutlined } from "@ant-design/icons";
import { ShowButton, EditButton, DeleteButton } from "@refinedev/antd";
import { useTranslation } from "@refinedev/core";
import dayjs from "dayjs";
import isSameOrBefore from "dayjs/plugin/isSameOrBefore";
import { MEDIA_BUCKET, resolveStoragePublicUrl } from "../../../utils/storage";

dayjs.extend(isSameOrBefore);

interface ProductImage {
  url: string;
}

export interface ProductRecord {
  id: string;
  name?: string;
  sku?: string;
  slug?: string;
  price?: number | string;
  stock?: number | null;
  weight?: number | null;
  batch_number?: string;
  expiry_date?: string;
  is_active?: boolean;
  product_images?: ProductImage[];
  categories?: { name: string } | null;
}

interface ProductCardProps {
  record: ProductRecord;
  onDeactivate?: (id: string) => void;
}

export const ProductCard: React.FC<ProductCardProps> = ({ record }) => {
  const { translate } = useTranslation();
  const previewUrl = resolveStoragePublicUrl(record.product_images?.[0]?.url ?? null, MEDIA_BUCKET);

  const today = dayjs();
  const expDate = record.expiry_date ? dayjs(record.expiry_date) : null;
  const isExpired = expDate ? expDate.isSameOrBefore(today, "day") : false;
  const isNearExpiry = !isExpired && expDate ? expDate.diff(today, "day") <= 30 : false;

  const showTag = isExpired || isNearExpiry;
  const tagColor = isExpired ? "error" : "warning";
  const tagLabel = isExpired
    ? translate("products.expiryStatus.expired", "Kedaluwarsa")
    : translate("products.expiryStatus.nearExpiry", "Mendekati ED");

  const actionItems = [
    {
      key: "show",
      label: <ShowButton hideText={false} size="small" recordItemId={record.id} />,
    },
    {
      key: "edit",
      label: <EditButton hideText={false} size="small" recordItemId={record.id} />,
    },
    {
      key: "delete",
      label: <DeleteButton hideText={false} size="small" recordItemId={record.id} />,
    },
  ];

  return (
    <Card size="small" hoverable style={{ borderRadius: 8, marginBottom: 12 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <div style={{ flexShrink: 0 }}>
          {previewUrl ? (
            <Image src={previewUrl} alt="" width={72} height={72} style={{ objectFit: "cover", borderRadius: 6 }} />
          ) : (
            <div
              style={{
                width: 72,
                height: 72,
                background: "#f0f0f0",
                borderRadius: 6,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#999",
                fontSize: 12,
              }}
            >
              No Img
            </div>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <Typography.Text strong ellipsis style={{ fontSize: 14 }}>
              {record.name || "-"}
            </Typography.Text>
            <Dropdown menu={{ items: actionItems }} trigger={["click"]}>
              <Button type="text" icon={<MoreOutlined />} size="small" />
            </Dropdown>
          </div>
          <Space size={4} wrap style={{ marginTop: 4 }}>
            {record.sku && (
              <Typography.Text type="secondary" code style={{ fontSize: 11 }}>
                {record.sku}
              </Typography.Text>
            )}
            {showTag && (
              <Tag color={tagColor} bordered={false} style={{ fontSize: 10, margin: 0, fontWeight: 500 }}>
                {tagLabel}
              </Tag>
            )}
            {expDate?.isValid() && (
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                {showTag ? `• ${expDate.format("DD MMM YYYY")}` : expDate.format("DD MMM YYYY")}
              </Typography.Text>
            )}
          </Space>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
            <Typography.Text type="danger" style={{ fontWeight: 600 }}>
              Rp {Number(record.price || 0).toLocaleString("id-ID")}
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Stok: {record.stock ?? 0}
            </Typography.Text>
          </div>
        </div>
      </div>
    </Card>
  );
};
