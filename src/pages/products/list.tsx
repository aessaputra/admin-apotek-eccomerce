import {
  List,
  useTable,
  EditButton,
  ShowButton,
  DeleteButton,
  useSelect,
} from "@refinedev/antd";
import { useTranslation, CrudFilters } from "@refinedev/core";
import { useEffect, useRef, useState } from "react";
import { Table, Image, Space, Tooltip, Input, Select, Row, Col } from "antd";
import { MEDIA_BUCKET, resolveStoragePublicUrl } from "../../utils/storage";
import { buildProductSearchFilter } from "../../utils/productSearch";

const PRODUCT_SEARCH_DEBOUNCE_MS = 400;

interface ProductImage { url: string }
interface ProductRecord {
  id: string;
  sku?: string;
  product_images?: ProductImage[];
  categories?: { name: string } | null;
}

export const ProductList: React.FC = () => {
  const { translate } = useTranslation();

  const [searchText, setSearchText] = useState("");
  const [debouncedSearchText, setDebouncedSearchText] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [isActive, setIsActive] = useState<boolean | null>(null);

  const hasFilterChangedRef = useRef(false);

  const { tableProps, setCurrentPage, setFilters, sorters, setSorters } = useTable({
    syncWithLocation: true,
    meta: { select: "*, product_images(*), categories(name)" },
    sorters: {
      initial: [
        {
          field: "created_at",
          order: "desc",
        },
      ],
    },
  });

  const currentSortOrder = sorters?.find((s) => s.field === "created_at")?.order ?? null;

  const handleSortChange = (value: "desc" | "asc" | null) => {
    if (value) {
      setSorters([{ field: "created_at", order: value }]);
    } else {
      setSorters([]);
    }
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
    if (!hasFilterChangedRef.current) {
      return;
    }

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

    if (typeof setCurrentPage === "function") {
      setCurrentPage(1);
    }

    if (typeof setFilters === "function") {
      setFilters(filters, "replace");
    }
  }, [debouncedSearchText, categoryId, isActive, setCurrentPage, setFilters]);

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

  return (
    <List>
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={12} md={6}>
            <Input
              allowClear
              placeholder={translate("products.search.namePlaceholder", "Cari nama produk...")}
              value={searchText}
              onChange={(e) => handleSearchTextChange(e.target.value)}
            />
          </Col>
          <Col xs={24} sm={12} md={6}>
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
          <Col xs={24} sm={12} md={6}>
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
          <Col xs={24} sm={12} md={6}>
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
        <Table {...tableProps} rowKey="id">
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
            dataIndex={["categories", "name"]}
            title={translate("products.fields.category")}
            render={(_, record: ProductRecord) => record.categories?.name ?? "-"}
          />
          <Table.Column dataIndex="price" title={translate("products.fields.price")} render={(v) => `Rp ${Number(v || 0).toLocaleString("id-ID")}`} />
          <Table.Column dataIndex="stock" title={translate("products.fields.stock")} />
          <Table.Column dataIndex="weight" title={translate("products.fields.weight")} render={(v) => v != null ? `${v} g` : "-"} />
          <Table.Column dataIndex="is_active" title={translate("products.fields.active")} render={(v) => (v ? translate("products.active.yes") : translate("products.active.no"))} />
          <Table.Column
            title={translate("table.actions")}
            dataIndex="actions"
            key="actions"
            align="center"
            width={100}
            fixed="right"
            render={(_, record: ProductRecord) => (
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
              </Space>
            )}
          />
        </Table>
      </Space>
    </List>
  );
};
