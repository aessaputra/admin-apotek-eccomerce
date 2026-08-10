import React from "react";
import dayjs from "dayjs";
import isSameOrBefore from "dayjs/plugin/isSameOrBefore";
import { useShow, useTranslation } from "@refinedev/core";
import { Show, NumberField } from "@refinedev/antd";
import { Typography, Image, Tag, Space, Row, Col, Card } from "antd";
import { MEDIA_BUCKET, resolveStoragePublicUrl } from "../../utils/storage";

dayjs.extend(isSameOrBefore);

const { Title, Text, Paragraph } = Typography;

interface ProductImage {
  id: string;
  url: string;
  sort_order?: number;
}

interface ProductRecord {
  id: string;
  name: string;
  sku?: string;
  slug: string;
  description?: string | null;
  price: string | number;
  stock?: number | null;
  weight?: number | null;
  batch_number?: string | null;
  expiry_date?: string | null;
  is_active?: boolean | null;
  category_id?: string | null;
  created_at?: string;
  updated_at?: string;
  product_images?: ProductImage[];
  categories?: { name: string } | null;
}

export const ProductShow: React.FC = () => {
  const { translate } = useTranslation();
  const {
    result: record,
    query: { isLoading },
  } = useShow<ProductRecord>({
    meta: { select: "*, product_images(*), categories(name)" },
  });

  const images = (record?.product_images ?? [])
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  const today = dayjs();
  const expDate = record?.expiry_date ? dayjs(record.expiry_date) : null;
  const isExpired = expDate ? expDate.isSameOrBefore(today, "day") : false;
  const isNearExpiry = !isExpired && expDate ? expDate.diff(today, "day") <= 30 : false;

  return (
    <Show isLoading={isLoading}>
      <Row gutter={[24, 24]}>
        <Col xs={24} md={10}>
          <Card title={translate("products.fields.image")}>
            {images.length > 0 ? (
              <Space wrap size="middle">
                {images.map((img) => {
                  const previewUrl = resolveStoragePublicUrl(img.url, MEDIA_BUCKET);

                  return previewUrl ? (
                    <Image
                      key={img.id}
                      src={previewUrl}
                      alt=""
                      width={120}
                      height={120}
                      style={{ objectFit: "cover", borderRadius: 8 }}
                    />
                  ) : null;
                })}
              </Space>
            ) : (
              <Text type="secondary">-</Text>
            )}
          </Card>
        </Col>
        <Col xs={24} md={14}>
          <Card>
            <Title level={5}>{translate("products.fields.name")}</Title>
            <Text>{record?.name ?? "-"}</Text>

            <Title level={5}>{translate("products.fields.sku")}</Title>
            <Text>{record?.sku ?? "-"}</Text>

            <Title level={5}>{translate("products.fields.slug")}</Title>
            <Text>{record?.slug ?? "-"}</Text>

            <Title level={5}>{translate("products.fields.description")}</Title>
            <Paragraph style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>
              {record?.description || "-"}
            </Paragraph>

            <Title level={5}>{translate("products.fields.price")}</Title>
            <NumberField
              value={record?.price}
              options={{ style: "currency", currency: "IDR" }}
            />

            <Title level={5}>{translate("products.fields.stock")}</Title>
            <Text>{record?.stock ?? 0}</Text>

            <Title level={5}>{translate("products.fields.weight")}</Title>
            <Text>{record?.weight != null ? `${record.weight} gram` : "-"}</Text>

            <Title level={5}>{translate("products.fields.category")}</Title>
            <Text>{record?.categories?.name ?? "-"}</Text>

            <Title level={5}>{translate("products.fields.expiryDate", "Tanggal Kedaluwarsa")}</Title>
            {expDate?.isValid() ? (
              <Space wrap>
                {isExpired && (
                  <Tag color="error" bordered={false} style={{ fontWeight: 500 }}>
                    {translate("products.expiryStatus.expired", "Kedaluwarsa")}
                  </Tag>
                )}
                {isNearExpiry && (
                  <Tag color="warning" bordered={false} style={{ fontWeight: 500 }}>
                    {translate("products.expiryStatus.nearExpiry", "Mendekati ED")}
                  </Tag>
                )}
                <Text
                  type={isExpired ? "danger" : undefined}
                  style={{
                    fontWeight: isExpired || isNearExpiry ? 500 : "normal",
                    color: isNearExpiry ? "#d48806" : undefined,
                  }}
                >
                  {expDate.format("DD MMM YYYY")}
                </Text>
              </Space>
            ) : (
              <Text type="secondary">-</Text>
            )}

            <Title level={5}>{translate("products.fields.batchNumber", "Nomor Batch")}</Title>
            <Text>{record?.batch_number ? <Text code>{record.batch_number}</Text> : "-"}</Text>

            <Title level={5}>{translate("products.fields.active")}</Title>
            <Tag color={record?.is_active ? "green" : "default"} bordered={false} style={{ fontWeight: 500 }}>
              {record?.is_active ? translate("products.status.active") : translate("products.status.inactive")}
            </Tag>

            {record?.created_at && (
              <>
                <Title level={5}>{translate("products.fields.created")}</Title>
                <Text>{new Date(record.created_at).toLocaleString("id-ID")}</Text>
              </>
            )}
          </Card>
        </Col>
      </Row>
    </Show>
  );
};
