import { useEffect, useState, useRef } from "react";
import {
  List,
  useTable,
  EditButton,
  ShowButton,
  DeleteButton,
} from "@refinedev/antd";
import { useTranslation } from "@refinedev/core";
import { Table, Image, Space, Tooltip, Input, Row, Col } from "antd";
import { MEDIA_BUCKET, resolveStoragePublicUrl } from "../../utils/storage";
import { buildCategorySearchFilter } from "../../utils/categorySearch";

export const CategoryList: React.FC = () => {
  const { translate } = useTranslation();
  const { tableProps, setFilters, setCurrentPage } = useTable({
    syncWithLocation: true,
  });

  const [searchText, setSearchText] = useState("");
  const [debouncedSearchText, setDebouncedSearchText] = useState("");
  const hasFilterChangedRef = useRef(false);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearchText(searchText);
    }, 400);

    return () => clearTimeout(handler);
  }, [searchText]);

  useEffect(() => {
    if (!hasFilterChangedRef.current) return;

    const searchFilter = buildCategorySearchFilter(debouncedSearchText);
    const newFilters = searchFilter ? [searchFilter] : [];

    setCurrentPage(1);
    setFilters(newFilters, "replace");
  }, [debouncedSearchText, setFilters, setCurrentPage]);

  const handleSearchTextChange = (value: string) => {
    hasFilterChangedRef.current = true;
    setSearchText(value);
  };

  return (
    <List>
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={24} md={12}>
            <Input
              allowClear
              placeholder={translate("categories.search.placeholder", "Cari nama atau slug kategori...")}
              value={searchText}
              onChange={(e) => handleSearchTextChange(e.target.value)}
            />
          </Col>
        </Row>
        <Table {...tableProps} rowKey="id">
          <Table.Column
            dataIndex="logo_url"
            title={translate("categories.fields.logo")}
            width={80}
            render={(value: string) => {
              const previewUrl = resolveStoragePublicUrl(value, MEDIA_BUCKET);

              return previewUrl ? (
                <Image src={previewUrl} alt="" width={40} height={40} style={{ objectFit: "cover" }} />
              ) : (
                "-"
              );
            }}
          />
          <Table.Column dataIndex="name" title={translate("categories.fields.name")} />
          <Table.Column dataIndex="slug" title={translate("categories.fields.slug")} />
          <Table.Column
            title={translate("table.actions")}
            dataIndex="actions"
            key="actions"
            align="center"
            width={100}
            fixed="right"
            render={(_, record: { id: string }) => (
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
