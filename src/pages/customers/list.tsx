import {
  List,
  useTable,
  DateField,
  ShowButton,
  getDefaultSortOrder,
} from "@refinedev/antd";
import { useTranslation } from "@refinedev/core";
import { useEffect, useState } from "react";
import { Table, Space, Avatar, Input, Tooltip, Tag, Button } from "antd";
import { useBanToggle } from "../../hooks/useBanToggle";
import { buildCustomerSearchFilter } from "../../utils/customerSearch";
import { MEDIA_BUCKET, resolveStoragePublicUrl } from "../../utils/storage";

const CUSTOMER_SEARCH_DEBOUNCE_MS = 400;

const getDisplayEmail = (email: string | null | undefined, fallback: string) => {
  const trimmedEmail = email?.trim();

  return trimmedEmail || fallback;
};

export const CustomerList: React.FC = () => {
  const { translate } = useTranslation();
  const { handleBan, handleUnban, isPending } = useBanToggle();
  const [searchText, setSearchText] = useState("");
  const [debouncedSearchText, setDebouncedSearchText] = useState("");

  const { tableProps, tableQuery, sorters, setFilters, setCurrentPage } = useTable({
    syncWithLocation: true,
    meta: { select: "id, full_name, phone_number, email, avatar_url, created_at, role, is_banned" },
    filters: {
      permanent: [{ field: "role", operator: "eq" as const, value: "customer" }],
    },
  });

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearchText(searchText);
    }, CUSTOMER_SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timeoutId);
  }, [searchText]);

  useEffect(() => {
    const searchFilter = buildCustomerSearchFilter(debouncedSearchText);

    if (typeof setCurrentPage === "function") {
      setCurrentPage(1);
    }

    if (typeof setFilters === "function") {
      setFilters(searchFilter ? [searchFilter] : [], "replace");
    }
  }, [debouncedSearchText, setCurrentPage, setFilters]);

  const emailFallback = translate("customers.emailFallback");
  const searchPlaceholder = translate("customers.search.placeholder");
  const clearSearchLabel = translate("customers.search.clear");
  const loadingLabel = translate("customers.search.loading");
  const noResultsLabel = translate("customers.search.noResults");
  const errorLabel = translate("customers.search.error");

  return (
    <List>
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Input
          allowClear={{ clearIcon: <span aria-label={clearSearchLabel}>×</span> }}
          aria-label={searchPlaceholder}
          placeholder={searchPlaceholder}
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
        />
        <Table
          {...tableProps}
          rowKey="id"
          loading={{ spinning: Boolean(tableProps.loading), tip: loadingLabel }}
          locale={{ emptyText: tableQuery?.isError ? errorLabel : noResultsLabel }}
        >
          <Table.Column
            dataIndex="full_name"
            title={translate("customers.fields.customer")}
            sorter
            defaultSortOrder={getDefaultSortOrder("full_name", sorters)}
            render={(_, record: { full_name?: string; avatar_url?: string }) => (
              <Space>
                <Avatar src={resolveStoragePublicUrl(record.avatar_url ?? null, MEDIA_BUCKET) ?? undefined} size="small">
                  {record.full_name?.[0]?.toUpperCase() ?? "?"}
                </Avatar>
                <span>{record.full_name || "-"}</span>
              </Space>
            )}
          />
          <Table.Column
            dataIndex="phone_number"
            title={translate("customers.fields.phone")}
            render={(v) => v || "-"}
          />
          <Table.Column
            dataIndex="email"
            title={translate("customers.fields.email")}
            render={(value: string | null | undefined) => getDisplayEmail(value, emailFallback)}
          />
          <Table.Column
            dataIndex="created_at"
            title={translate("customers.fields.joined")}
            sorter
            defaultSortOrder={getDefaultSortOrder("created_at", sorters)}
            render={(value) => <DateField value={value} format="LL" />}
          />
          <Table.Column
            dataIndex="is_banned"
            title={translate("customers.fields.status")}
            render={(v: boolean) => (
              <Tag color={v ? "red" : "green"}>
                {v ? translate("customers.statusBanned") : translate("customers.statusActive")}
              </Tag>
            )}
          />
          <Table.Column
            title={translate("table.actions")}
            dataIndex="actions"
            key="actions"
            align="center"
            width={180}
            fixed="right"
            render={(_, record: { id: string; is_banned?: boolean; full_name?: string }) => (
              <Space size="small">
                <Tooltip title={translate("customers.showDetail")}>
                  <span>
                    <ShowButton hideText size="small" recordItemId={record.id} resource="profiles" />
                  </span>
                </Tooltip>
                {record.is_banned ? (
                  <Tooltip title={translate("customers.unbanTooltip")}>
                    <Button
                      type="primary"
                      size="small"
                      loading={isPending}
                      onClick={() => handleUnban(record)}
                    >
                      {translate("customers.unban")}
                    </Button>
                  </Tooltip>
                ) : (
                  <Tooltip title={translate("customers.banTooltip")}>
                    <Button
                      danger
                      size="small"
                      loading={isPending}
                      onClick={() => handleBan(record)}
                    >
                      {translate("customers.ban")}
                    </Button>
                  </Tooltip>
                )}
              </Space>
            )}
          />
        </Table>
      </Space>
    </List>
  );
};
