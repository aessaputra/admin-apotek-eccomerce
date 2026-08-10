import { useEffect } from "react";
import dayjs from "dayjs";
import { Edit, useForm, useSelect } from "@refinedev/antd";
import { useTranslation } from "@refinedev/core";
import { Form, Input, InputNumber, Select, DatePicker, message, Row, Col, Card } from "antd";
import { ProductImageUpload } from "../../components/product-image-upload";
import { DescriptionEditorModal } from "../../components/description-editor-modal";
import { ProductWeightInput } from "../../components/product-weight-input";
import { useProductSkuField } from "../../hooks/useProductSkuField";
import { slugify } from "../../utils/slugify";
import { supabaseClient } from "../../providers/supabase-client";
import {
  getStoragePathFromReference,
  MEDIA_BUCKET,
} from "../../utils/storage";



interface ProductImage { id: string; url: string; sort_order: number }

interface ProductData {
  id?: string;
  product_images?: ProductImage[];
}

type ProductFormValues = Record<string, unknown>;

function normalizeProductImageValue(value: string): string {
  return getStoragePathFromReference(value, MEDIA_BUCKET) ?? value;
}

export const ProductEdit: React.FC = () => {
  const { translate } = useTranslation();
  const { formProps, saveButtonProps, form, query } = useForm({
    meta: { select: "*, product_images(*)" },
  });
  const { selectProps } = useSelect({
    resource: "categories",
    optionLabel: "name",
    optionValue: "id",
  });

  const data = query?.data?.data as ProductData | undefined;
  const {
    handleDuplicateSkuSubmitError,
    handleSkuBlur,
    normalizeAndValidateSku,
    skuRules,
  } = useProductSkuField({ form, translate, currentProductId: data?.id });

  useEffect(() => {
    if (data?.product_images && Array.isArray(data.product_images)) {
      const urls = [...data.product_images]
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map((p) => normalizeProductImageValue(p.url));
      form.setFieldsValue({ images: urls });
    }
  }, [data?.product_images, form]);

  const handleValuesChange = (
    changed: Record<string, unknown>,
    all: Record<string, unknown>
  ) => {
    if ("name" in changed && changed.name != null) {
      form.setFieldValue("slug", slugify(String(changed.name)));
    }
    formProps.onValuesChange?.(changed, all);
  };

  const handleFinish = async (values: ProductFormValues) => {
    const { images = [], ...productValues } = values;
    const sku = await normalizeAndValidateSku(productValues.sku);
    let result: { data?: { id?: string } } | undefined;

    try {
      result = (await formProps.onFinish?.({ ...productValues, sku })) as
        | { data?: { id?: string } }
        | undefined;
    } catch (error) {
      handleDuplicateSkuSubmitError(error);
      throw error;
    }
    const productId = result?.data?.id;
    if (!productId) return result;

    const currentUrls = Array.isArray(images) ? (images as string[]) : [];
    const original = (data?.product_images ?? []) as ProductImage[];

    try {
      const normalizedOriginal = original.map((item) => ({
        ...item,
        normalizedUrl: normalizeProductImageValue(item.url),
      }));

      const removed = normalizedOriginal.filter((o) => !currentUrls.includes(o.normalizedUrl));
      const removedResults = await Promise.allSettled(
        removed.map(async (img) => {
          const path = getStoragePathFromReference(img.normalizedUrl, MEDIA_BUCKET);
          if (path) {
            await supabaseClient.storage.from(MEDIA_BUCKET).remove([path]);
          }
          const { error: deleteError } = await supabaseClient
            .from("product_images")
            .delete()
            .eq("id", img.id);
          if (deleteError) throw deleteError;
        })
      );

      const firstRemovedError = removedResults.find((r) => r.status === "rejected");
      if (firstRemovedError) throw (firstRemovedError as PromiseRejectedResult).reason;

      const updateResults = await Promise.allSettled(
        currentUrls.map(async (url, i) => {
          const existing = normalizedOriginal.find((o) => o.normalizedUrl === url);
          if (existing) {
            const { error: updateError } = await supabaseClient
              .from("product_images")
              .update({ sort_order: i, url })
              .eq("id", existing.id);
            if (updateError) throw updateError;
          } else {
            const { error: insertError } = await supabaseClient
              .from("product_images")
              .insert({
                product_id: productId,
                url,
                sort_order: i,
              });
            if (insertError) throw insertError;
          }
        })
      );

      const firstUpdateError = updateResults.find((r) => r.status === "rejected");
      if (firstUpdateError) throw (firstUpdateError as PromiseRejectedResult).reason;
    } catch (err) {
      message.error(translate("products.imagesSaveError"));
      throw err;
    }

    return result;
  };

  return (
    <Edit saveButtonProps={saveButtonProps}>
      <Form
        {...formProps}
        form={form}
        layout="vertical"
        onValuesChange={handleValuesChange}
        onFinish={handleFinish}
      >
        <Row gutter={[24, 24]}>
          <Col xs={24} md={16}>
            <Form.Item
              label={translate("products.fields.name")}
              name="name"
              rules={[
                { required: true, message: translate("products.validation.nameRequired") },
                { max: 120, message: translate("products.validation.nameMax") },
              ]}
            >
              <Input maxLength={120} showCount />
            </Form.Item>
            <Form.Item
              label={translate("products.fields.sku")}
              name="sku"
              rules={skuRules}
            >
              <Input onBlur={handleSkuBlur} />
            </Form.Item>
            <Form.Item
              label={translate("products.fields.slug")}
              name="slug"
              rules={[
                { required: true, message: translate("products.validation.slugRequired") },
                { max: 75, message: "Slug produk maksimal 75 karakter." },
              ]}
            >
              <Input maxLength={75} showCount />
            </Form.Item>
            <Form.Item label={translate("products.fields.category")} name="category_id">
              <Select {...selectProps} />
            </Form.Item>
            <Form.Item label={translate("products.fields.description")} name="description" getValueFromEvent={(val: string) => val}>
              <DescriptionEditorModal maxLength={500} />
            </Form.Item>
            <Form.Item
              label={translate("products.fields.expiryDate", "Tanggal Kedaluwarsa")}
              name="expiry_date"
              getValueProps={(value) => ({
                value: value ? dayjs(value) : undefined,
              })}
              getValueFromEvent={(date: unknown) =>
                date && typeof (date as { format?: unknown }).format === "function"
                  ? (date as { format: (f: string) => string }).format("YYYY-MM-DD")
                  : null
              }
            >
              <DatePicker
                style={{ width: "100%" }}
                format="YYYY-MM-DD"
                placeholder={translate("products.placeholder.expiryDate", "Pilih tanggal ED")}
              />
            </Form.Item>
            <Form.Item
              label={translate("products.fields.batchNumber", "Nomor Batch")}
              name="batch_number"
            >
              <Input
                placeholder={translate("products.placeholder.batchNumber", "Opsional (misal: BCH-2026-0801)")}
                allowClear
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Card size="small" style={{ position: "sticky", top: 16 }}>
              <Form.Item label={translate("products.fields.images")} name="images">
                <ProductImageUpload />
              </Form.Item>
              <Form.Item label={translate("products.fields.price")} name="price" rules={[{ required: true, message: translate("products.validation.priceRequired") }]}>
                <InputNumber style={{ width: "100%" }} min={0} />
              </Form.Item>
              <Form.Item
                label={translate("products.fields.stock")}
                name="stock"
                rules={[
                  { type: "number", min: 0, message: translate("products.validation.stockMin", {}, "Stock cannot be negative.") },
                  { type: "number", max: 99999, message: translate("products.validation.stockMax") },
                ]}
              >
                <InputNumber style={{ width: "100%" }} min={0} max={99999} />
              </Form.Item>
              <Form.Item
                label={translate("products.fields.weight")}
                name="weight"
                rules={[
                  { required: true, message: translate("products.validation.weightRequiredRule") },
                  {
                    type: "number",
                    min: 1,
                    message: translate("products.validation.weightMin"),
                  },
                  {
                    type: "number",
                    max: 20000,
                    message: translate("products.validation.weightMax"),
                  },
                ]}
                extra={translate("products.validation.weightRequired", {}, "Required for shipping rates and Biteship order creation.")}
              >
                <ProductWeightInput />
              </Form.Item>
              <Form.Item label={translate("products.fields.active")} name="is_active">
                <Select options={[{ value: true, label: translate("products.active.yes") }, { value: false, label: translate("products.active.no") }]} />
              </Form.Item>
            </Card>
          </Col>
        </Row>
      </Form>
    </Edit>
  );
};
