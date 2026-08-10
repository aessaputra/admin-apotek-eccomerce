import {
  List,
  useTable,
  EditButton,
  ShowButton,
  DeleteButton,
  useSelect,
} from "@refinedev/antd";
import { useTranslation, CrudFilter, CrudFilters, useUpdate } from "@refinedev/core";
import { useEffect, useRef, useState } from "react";
import { Table, Image, Space, Tooltip, Input, Select, Row, Col, Tag, Typography, Popconfirm, Button, Grid } from "antd";
import dayjs from "dayjs";
import isSameOrBefore from "dayjs/plugin/isSameOrBefore";
import { MEDIA_BUCKET, resolveStoragePublicUrl } from "../../utils/storage";
import { buildProductSearchFilter } from "../../utils/productSearch";
import { ProductCard } from "./components/ProductCard";

dayjs.extend(isSameOrBefore);

const PRODUCT_SEARCH_DEBOUNCE_MS = 400;

interface ProductImage {
  url: string;
}

interface ProductRecord {
  id: string;
  name?: string;
  sku?: string;
  slug?: string;
  product_images?: ProductImage[];
  categories?: { name: string } | null;
  batch_number?: string;
  expiry_date?: string;
  is_active?: boolean;
}

type TranslateFn = ReturnType<typeof useTranslation>["translate"];

function buildExpiryFilters(status: string | null): CrudFilter[] {
  if (!status) return [];

  const todayStr = dayjs().format("YYYY-MM-DD");
  const thirtyDaysStr = dayjs().add(30, "day").format("YYYY-MM-DD");

  switch (status) {
    case "expired":
      return [{ field: "expiry_date", operator: "lte", value: todayStr }];
    case "nearExpiry":
      return [
        { field: "expiry_date", operator: "gt", value: todayStr },
        { field: "expiry_date", operator: "lte", value: thirtyDaysStr },
      ];
    case "safe":
      return [{ field: "expiry_date", operator: "gt", value: thirtyDaysStr }];
    default:
      return [];
  }
}

function renderExpiryStatusCell(dateStr: string | undefined, translate: TranslateFn) {
  if (!dateStr) return "-";

  const today = dayjs();
  const expDate = dayjs(dateStr);
  const isExpired = expDate.isSameOrBefore(today, "day");
  const isNearExpiry = !isExpired && expDate.diff(today, "day") <= 30;

  const tagColor = isExpired ? "error" : isNearExpiry ? "warning" : "success";
  const tagLabelKey = isExpired
    ? "products.expiryStatus.expired"
    : isNearExpiry
    ? "products.expiryStatus.nearExpiry"
    : "products.expiryStatus.safe";

  return (
    <Space direction="vertical" size={2}>
      <Tag color={tagColor}>{translate(tagLabelKey)}</Tag>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {dateStr}
      </Typography.Text>
    </Space>
  );
}

export const ProductList: React.FC = () => {
  const { translate } = useTranslation();
  const { mutate: updateProduct } = useUpdate();

  const [searchText, setSearchText] = useState("");
  const [debouncedSearchText, setDebouncedSearchText] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [isActive, setIsActive] = useState<boolean | null>(null);
  const [expiryStatus, setExpiryStatus] = useState<string | null>(null);

  const hasFilterChangedRef = useRef(false);

  const { tableProps, setCurrentPage, setFilters, sorters, setSorters } = useTable({
    syncWithLocation: true,
    meta: { select: "*, product_images(*), categories(name)" },
    sorters: {
      initial: [{ field: "created_at", order: "desc" }],
    },
  });

  const currentSortOrder = sorters?.find((s) => s.field === "created_at")?.order ?? null;

  const handleSortChange = (value: "desc" | "asc" | null) => {
    setSorters(value ? [{ field: "created_at", order: value }] : []);
  };

  const { selectProps: categorySelectProps } = useSelect({
    resource: "categories",
    optionLabel: "name",
    optionValue: "id",
  });

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearchText(searchText);
    }, PRODUCT_SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timeoutId);
  }, [searchText]);

  useEffect(() => {
    if (!hasFilterChangedRef.current) return;

    const filters: CrudFilters = [];

    const searchFilter = buildProductSearchFilter(debouncedSearchText);
    if (searchFilter) {
      filters.push(searchFilter);
    }

    if (categoryId) {
      filters.push({ field: "category_id", operator: "eq", value: categoryId });
    }

    if (isActive !== null && isActive !== undefined) {
      filters.push({ field: "is_active", operator: "eq", value: isActive });
    }

    filters.push(...buildExpiryFilters(expiryStatus));

    if (typeof setCurrentPage === "function") {
      setCurrentPage(1);
    }

    if (typeof setFilters === "function") {
      setFilters(filters, "replace");
    }
  }, [debouncedSearchText, categoryId, isActive, expiryStatus, setCurrentPage, setFilters]);

  const handleSearchTextChange = (value: string) => {
    hasFilterChangedRef.current = true;
    setSearchText(value);
  };

  const handleCategoryChange = (value: string) => {
    hasFilterChangedRef.current = true;
    setCategoryId(value);
  };

  const handleIsActiveChange = (value: boolean) => {
    hasFilterChangedRef.current = true;
    setIsActive(value);
  };

  const handleExpiryStatusChange = (value: string | null) => {
    hasFilterChangedRef.current = true;
    setExpiryStatus(value);
  };

  const handleDeactivateProduct = (productId: string) => {
    updateProduct({
      resource: "products",
      id: productId,
      values: { is_active: false },
    });
  };

  const screens = Grid.useBreakpoint();
  const isMobile = screens.md === false;

  return (
    <List>
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Row gutter={[12, 12]}>
          <Col xs={24} sm={12} md={5}>
            <Input
              allowClear
              placeholder={translate("products.search.namePlaceholder", "Cari nama produk...")}
              value={searchText}
              onChange={(e) => handleSearchTextChange(e.target.value)}
            />
          </Col>
          <Col xs={24} sm={12} md={5}>
            <Select
              options={categorySelectProps.options}
              loading={categorySelectProps.loading}
              onSearch={categorySelectProps.onSearch}
              showSearch
              filterOption={false}
              placeholder={translate("products.search.categoryPlaceholder", "Semua Kategori")}
              allowClear
              style={{ width: "100%" }}
              value={categoryId}
              onChange={handleCategoryChange}
            />
          </Col>
          <Col xs={24} sm={12} md={4}>
            <Select
              placeholder={translate("products.search.statusPlaceholder", "Status Aktif")}
              allowClear
              style={{ width: "100%" }}
              value={isActive}
              onChange={handleIsActiveChange}
              options={[
                { label: translate("products.active.yes", "Yes"), value: true },
                { label: translate("products.active.no", "No"), value: false },
              ]}
            />
          </Col>
          <Col xs={24} sm={12} md={5}>
            <Select
              placeholder={translate("products.search.expiryPlaceholder", "Status Kedaluwarsa")}
              allowClear
              style={{ width: "100%" }}
              value={expiryStatus}
              onChange={handleExpiryStatusChange}
              options={[
                { label: translate("products.expiryStatus.all", "Semua"), value: null },
                { label: translate("products.expiryStatus.expired", "Kedaluwarsa"), value: "expired" },
                { label: translate("products.expiryStatus.nearExpiry", "Mendekati ED (<30 Hari)"), value: "nearExpiry" },
                { label: translate("products.expiryStatus.safe", "Aman"), value: "safe" },
              ]}
            />
          </Col>
          <Col xs={24} sm={12} md={5}>
            <Select
              placeholder={translate("products.search.sortPlaceholder", "Urutkan...")}
              allowClear
              style={{ width: "100%" }}
              value={currentSortOrder}
              onChange={handleSortChange}
              options={[
                { label: translate("products.sort.newest", "Terbaru"), value: "desc" },
                { label: translate("products.sort.oldest", "Terlama"), value: "asc" },
              ]}
            />
          </Col>
        </Row>
        {isMobile ? (
          <Space direction="vertical" style={{ width: "100%" }}>
            {(tableProps.dataSource as ProductRecord[] | undefined)?.map((record) => (
              <ProductCard key={record.id} record={record} onDeactivate={handleDeactivateProduct} />
            ))}
          </Space>
        ) : (
          <Table {...tableProps} rowKey="id" scroll={{ x: "max-content" }}>
            <Table.Column
              dataIndex={["product_images", 0, "url"]}
              title={translate("products.fields.image")}
              width={80}
              render={(_, record: ProductRecord) => {
                const previewUrl = resolveStoragePublicUrl(record.product_images?.[0]?.url ?? null, MEDIA_BUCKET);
                return previewUrl ? (
                  <Image src={previewUrl} alt="" width={40} height={40} style={{ objectFit: "cover" }} />
                ) : (
                  "-"
                );
              }}
            />
            <Table.Column dataIndex="name" title={translate("products.fields.name")} />
            <Table.Column dataIndex="sku" title={translate("products.fields.sku")} />
            <Table.Column dataIndex="slug" title={translate("products.fields.slug")} />
            <Table.Column
              dataIndex="batch_number"
              title={translate("products.fields.batchNumber", "Nomor Batch")}
              render={(v) => (v ? <Typography.Text code>{v}</Typography.Text> : "-")}
            />
            <Table.Column
              dataIndex="expiry_date"
              title={translate("products.fields.expiryDate", "Tanggal ED")}
              render={(v) => renderExpiryStatusCell(v, translate)}
            />
            <Table.Column
              dataIndex={["categories", "name"]}
              title={translate("products.fields.category")}
              render={(_, record: ProductRecord) => record.categories?.name ?? "-"}
            />
            <Table.Column dataIndex="price" title={translate("products.fields.price")} render={(v) => `Rp ${Number(v || 0).toLocaleString("id-ID")}`} />
            <Table.Column dataIndex="stock" title={translate("products.fields.stock")} />
            <Table.Column dataIndex="weight" title={translate("products.fields.weight")} render={(v) => (v != null ? `${v} g` : "-")} />
            <Table.Column dataIndex="is_active" title={translate("products.fields.active")} render={(v) => (v ? translate("products.active.yes") : translate("products.active.no"))} />
            <Table.Column
              title={translate("table.actions")}
              dataIndex="actions"
              key="actions"
              align="center"
              width={140}
              fixed="right"
              render={(_, record: ProductRecord) => {
                const isEligibleForDeactivation =
                  record.is_active &&
                  record.expiry_date &&
                  dayjs(record.expiry_date).diff(dayjs(), "day") <= 30;

                return (
                  <Space size="small">
                    <Tooltip title={translate("actions.show")}>
                      <span>
                        <ShowButton hideText size="small" recordItemId={record.id} />
                      </span>
                    </Tooltip>
                    <Tooltip title={translate("actions.edit")}>
                      <span>
                        <EditButton hideText size="small" recordItemId={record.id} />
                      </span>
                    </Tooltip>
                    <Tooltip title={translate("actions.delete")}>
                      <span>
                        <DeleteButton hideText size="small" recordItemId={record.id} />
                      </span>
                    </Tooltip>
                    {isEligibleForDeactivation && (
                      <Popconfirm
                        title={translate("products.expiryActions.deactivateConfirm", "Nonaktifkan produk ini?")}
                        onConfirm={() => handleDeactivateProduct(record.id)}
                        okText={translate("products.expiryActions.deactivate", "Nonaktifkan")}
                        cancelText="Batal"
                      >
                        <Tooltip title={translate("products.expiryActions.deactivate", "Nonaktifkan")}>
                          <Button danger size="small" type="text" style={{ fontSize: 12 }}>
                            OFF
                          </Button>
                        </Tooltip>
                      </Popconfirm>
                    )}
                  </Space>
                );
              }}
            />
          </Table>
        )}
      </Space>
    </List>
  );
};
