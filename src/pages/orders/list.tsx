import { List, useTable, ShowButton, getDefaultFilter } from "@refinedev/antd";
import { useTranslation, type BaseRecord, type CrudFilters } from "@refinedev/core";
import { Alert, Button, Card, Grid, List as AntdList, Radio, Table, Space, Tooltip, Select, Tag, Typography, theme } from "antd";
import type { RadioChangeEvent } from "antd";
import type { FilterDropdownProps } from "antd/es/table/interface";
import { useNavigate } from "react-router";
import { STATUS_COLORS, PAYMENT_COLORS, getStatusOptions, getPaymentOptions } from "../../constants/orders";
import { getFallbackCourierOption } from "../../constants/couriers";

const { Text } = Typography;

const formatDisplayLabel = (value: string | null | undefined) => {
  if (!value) {
    return "-";
  }

  return value
    .split(/[_-]/g)
    .filter(Boolean)
    .map((part) => (part.length <= 3 ? part.toUpperCase() : `${part.charAt(0).toUpperCase()}${part.slice(1)}`))
    .join(" ");
};

interface SelectFilterOption {
  label: string;
  value: string;
}

type OrderRecordKey = string | number;

interface OrderQuickFilter {
  key: string;
  labelKey: string;
  descriptionKey: string;
  filters: CrudFilters;
}

const ORDER_QUICK_FILTERS: OrderQuickFilter[] = [
  {
    key: "paid-unprocessed",
    labelKey: "orders.quickFilters.paidUnprocessed.label",
    descriptionKey: "orders.quickFilters.paidUnprocessed.description",
    filters: [
      { field: "payment_status", operator: "eq", value: "settlement" },
      { field: "status", operator: "eq", value: "processing" },
    ],
  },
  {
    key: "ready-to-ship",
    labelKey: "orders.quickFilters.readyToShip.label",
    descriptionKey: "orders.quickFilters.readyToShip.description",
    filters: [
      { field: "payment_status", operator: "eq", value: "settlement" },
      { field: "status", operator: "eq", value: "awaiting_shipment" },
    ],
  },
  {
    key: "shipment-tracking",
    labelKey: "orders.quickFilters.shipmentTracking.label",
    descriptionKey: "orders.quickFilters.shipmentTracking.description",
    filters: [
      { field: "payment_status", operator: "eq", value: "settlement" },
      { field: "status", operator: "in", value: ["shipped", "in_transit"] },
    ],
  },
  {
    key: "awaiting-customer",
    labelKey: "orders.quickFilters.awaitingCustomer.label",
    descriptionKey: "orders.quickFilters.awaitingCustomer.description",
    filters: [
      { field: "payment_status", operator: "eq", value: "settlement" },
      { field: "customer_completion_stage", operator: "eq", value: "awaiting_customer" },
    ],
  },
];

const ALL_ORDER_QUICK_FILTERS_VALUE = "all";
const CUSTOMER_FILTER_FIELD = "user_id";

const areQuickFilterValuesEqual = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

const isFieldFilter = (filter: CrudFilters[number]): filter is Extract<CrudFilters[number], { field: string }> =>
  "field" in filter;

const getPreservedCustomerFilters = (filters: CrudFilters | undefined): CrudFilters =>
  (filters ?? []).filter((filter) => isFieldFilter(filter) && filter.field === CUSTOMER_FILTER_FIELD);

const getFiltersWithoutCustomerFilter = (filters: CrudFilters | undefined): CrudFilters =>
  (filters ?? []).filter((filter) => !isFieldFilter(filter) || filter.field !== CUSTOMER_FILTER_FIELD);

const areQuickFilterFiltersEqual = (left: CrudFilters | undefined, right: CrudFilters): boolean => {
  if (!left || left.length !== right.length) {
    return false;
  }

  return right.every((rightFilter) =>
    left.some((leftFilter) =>
      "field" in leftFilter &&
      "field" in rightFilter &&
      leftFilter.field === rightFilter.field &&
      leftFilter.operator === rightFilter.operator &&
      areQuickFilterValuesEqual(leftFilter.value, rightFilter.value)
    )
  );
};

const getActiveOrderQuickFilterKey = (filters: CrudFilters | undefined): string | undefined => {
  const comparableFilters = getFiltersWithoutCustomerFilter(filters);

  if (comparableFilters.length === 0) {
    return ALL_ORDER_QUICK_FILTERS_VALUE;
  }

  return ORDER_QUICK_FILTERS.find((quickFilter) => areQuickFilterFiltersEqual(comparableFilters, quickFilter.filters))?.key;
};

const getOrderRecordKey = (record: BaseRecord): OrderRecordKey | undefined => {
  const { id } = record;

  return typeof id === "string" || typeof id === "number" ? id : undefined;
};

const normalizeFilterValue = (value: unknown): string[] | undefined => {
  if (Array.isArray(value)) {
    const values = value.filter((item): item is string => typeof item === "string");
    return values.length > 0 ? values : undefined;
  }

  return typeof value === "string" ? [value] : undefined;
};

const getSelectedFilterValue = (value: unknown): string | undefined => {
  return normalizeFilterValue(value)?.[0];
};

const createSelectFilterDropdown = (
  options: SelectFilterOption[],
  placeholder: string,
  applyLabel: string,
  resetLabel: string
) => ({ selectedKeys, setSelectedKeys, confirm, clearFilters }: FilterDropdownProps) => {
  const selectedValue = getSelectedFilterValue(selectedKeys);

  return (
    <Space direction="vertical" style={{ padding: 8, minWidth: 180 }}>
      <Select
        style={{ width: "100%" }}
        placeholder={placeholder}
        aria-label={placeholder}
        allowClear
        value={selectedValue}
        options={options}
        onChange={(value) => setSelectedKeys(value ? [value] : [])}
      />
      <Space>
        <Button type="primary" size="small" onClick={() => confirm()}>
          {applyLabel}
        </Button>
        <Button
          size="small"
          onClick={() => {
            clearFilters?.();
            confirm();
          }}
        >
          {resetLabel}
        </Button>
      </Space>
    </Space>
  );
};

export const OrderList: React.FC = () => {
  const { translate } = useTranslation();
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const screens = Grid.useBreakpoint();
  const isMobile = Boolean(screens.xs && !screens.sm);

  const { tableProps, tableQuery, filters, setFilters } = useTable({
    syncWithLocation: true,
    sorters: {
      initial: [
        {
          field: "created_at",
          order: "desc",
        },
      ],
    },
  });

  const STATUS_OPTIONS = getStatusOptions(translate);
  const PAYMENT_OPTIONS = getPaymentOptions(translate);
  const orderListTableLabel = translate("orders.tables.listAriaLabel");
  const activeQuickFilterKey = getActiveOrderQuickFilterKey(filters);
  const preservedCustomerFilters = getPreservedCustomerFilters(filters);
  const orderQuickFilterOptions = [
    { label: translate("orders.quickFilters.all"), value: ALL_ORDER_QUICK_FILTERS_VALUE },
    ...ORDER_QUICK_FILTERS.map((quickFilter) => ({
      label: translate(quickFilter.labelKey),
      value: quickFilter.key,
    })),
  ];
  const handleQuickFilterChange = (event: RadioChangeEvent): void => {
    const selectedFilterKey = String(event.target.value);

    if (selectedFilterKey === ALL_ORDER_QUICK_FILTERS_VALUE) {
      setFilters(preservedCustomerFilters, "replace");
      return;
    }

    const selectedQuickFilter = ORDER_QUICK_FILTERS.find((quickFilter) => quickFilter.key === selectedFilterKey);

    if (selectedQuickFilter) {
      setFilters([...preservedCustomerFilters, ...selectedQuickFilter.filters], "replace");
    }
  };

  const openOrderDetail = (id: OrderRecordKey) => {
    navigate(`/orders/show/${id}`);
  };
  const emptyOrderText = tableQuery?.isError ? (
    <Alert
      type="error"
      showIcon
      message={translate("orders.empty.listErrorTitle")}
      description={translate("orders.empty.listErrorDescription")}
    />
  ) : translate("orders.empty.list");

  return (
    <List>
      <div style={{ overflowX: "auto", display: "flex", flexWrap: "nowrap", paddingBottom: token.paddingXXS, marginBottom: token.marginMD, WebkitOverflowScrolling: "touch" }}>
        <Radio.Group
          aria-label={translate("orders.quickFilters.title")}
          optionType="button"
          buttonStyle="solid"
          size="middle"
          value={activeQuickFilterKey}
          options={orderQuickFilterOptions}
          onChange={handleQuickFilterChange}
          style={{ display: "flex", flexWrap: "nowrap", gap: token.marginXXS }}
        />
      </div>
      <div aria-label={orderListTableLabel}>
        {isMobile ? (
          <AntdList
            dataSource={tableProps.dataSource as BaseRecord[]}
            loading={tableProps.loading}
            pagination={tableProps.pagination as React.ComponentProps<typeof AntdList>["pagination"]}
            renderItem={(record: BaseRecord) => {
              const recordId = getOrderRecordKey(record);
              const status = String(record.status || "");
              const paymentStatus = String(record.payment_status || "");
              const hasBiteship = record.latest_biteship_status;
              const statusLabelKey = hasBiteship ? `biteshipStatus.${record.latest_biteship_status}` : `orderStatus.${status}`;
              const statusDisplayVal = hasBiteship ? record.latest_biteship_status : status;
              const courierCode = record.courier_code as string | undefined;

              return (
                <Card
                  key={String(recordId)}
                  size="small"
                  style={{ marginBottom: token.marginSM }}
                  title={
                    <Space style={{ justifyContent: "space-between", width: "100%" }}>
                      <Button
                        type="link"
                        style={{ padding: 0, height: "auto", fontWeight: "bold" }}
                        onClick={() => recordId !== undefined && openOrderDetail(recordId)}
                        aria-label={recordId !== undefined ? translate("orders.actions.openRowAriaLabel", { id: String(recordId) }) : undefined}
                      >
                        #{recordId}
                      </Button>
                      <Tag color={STATUS_COLORS[status] ?? "default"}>
                        {statusDisplayVal ? translate(statusLabelKey, {}, formatDisplayLabel(String(statusDisplayVal))) : "-"}
                      </Tag>
                    </Space>
                  }
                >
                  <Space direction="vertical" style={{ width: "100%" }} size="small">
                    <Space style={{ justifyContent: "space-between", width: "100%" }}>
                      <Text type="secondary">{translate("orders.fields.total")}:</Text>
                      <Text strong>{`Rp ${Number(record.total_amount || 0).toLocaleString("id-ID")}`}</Text>
                    </Space>
                    <Space style={{ justifyContent: "space-between", width: "100%" }}>
                      <Text type="secondary">{translate("orders.fields.payment")}:</Text>
                      <Tag color={PAYMENT_COLORS[paymentStatus] ?? "default"}>
                        {paymentStatus ? translate(`paymentStatus.${paymentStatus}`, {}, formatDisplayLabel(paymentStatus)) : "-"}
                      </Tag>
                    </Space>
                    {courierCode && (
                      <Space style={{ justifyContent: "space-between", width: "100%" }}>
                        <Text type="secondary">{translate("orders.fields.courierCode")}:</Text>
                        <Text>{getFallbackCourierOption(courierCode).label} {record.waybill_number ? `(${record.waybill_number})` : ""}</Text>
                      </Space>
                    )}
                    <Space style={{ justifyContent: "space-between", width: "100%" }}>
                      <Text type="secondary">{translate("orders.fields.created")}:</Text>
                      <Text type="secondary">{record.created_at ? new Date(String(record.created_at)).toLocaleDateString("id-ID") : "-"}</Text>
                    </Space>
                    <Button
                      type="primary"
                      block
                      size="small"
                      style={{ marginTop: token.marginXS }}
                      onClick={() => recordId !== undefined && openOrderDetail(recordId)}
                    >
                      {translate("orders.showDetail", {}, "Lihat Detail")}
                    </Button>
                  </Space>
                </Card>
              );
            }}
          />
        ) : (
          <Table
            {...tableProps}
            rowKey="id"
            scroll={{ x: "max-content" }}
            locale={{ emptyText: emptyOrderText }}
            onRow={(record: BaseRecord) => {
              const recordId = getOrderRecordKey(record);

              return {
                role: "button",
                tabIndex: 0,
                style: { cursor: "pointer" },
                "aria-label": recordId !== undefined
                  ? translate("orders.actions.openRowAriaLabel", { id: String(recordId) })
                  : translate("orders.actions.openRowFallbackAriaLabel"),
                onClick: () => {
                  if (recordId !== undefined) {
                    openOrderDetail(recordId);
                  }
                },
                onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
                  if (event.target !== event.currentTarget) {
                    return;
                  }
                  if (recordId === undefined || (event.key !== "Enter" && event.key !== " ")) {
                    return;
                  }

                  event.preventDefault();
                  openOrderDetail(recordId);
                },
              };
            }}
          >
            <Table.Column dataIndex="id" title={translate("orders.fields.id")} width={80} />
            <Table.Column dataIndex="total_amount" title={translate("orders.fields.total")} responsive={["sm"]} render={(v) => `Rp ${Number(v || 0).toLocaleString("id-ID")}`} />
            <Table.Column
              dataIndex="status"
              title={translate("orders.fields.status")}
              render={(v: string, record: BaseRecord) => {
                const hasBiteship = (record as Record<string, unknown>).latest_biteship_status;
                const labelKey = hasBiteship ? `biteshipStatus.${(record as Record<string, unknown>).latest_biteship_status}` : `orderStatus.${v}`;
                const displayVal = hasBiteship ? (record as Record<string, unknown>).latest_biteship_status : v;
                return (
                  <Tag color={STATUS_COLORS[v] ?? "default"}>{displayVal ? translate(labelKey, {}, formatDisplayLabel(String(displayVal))) : "-"}</Tag>
                );
              }}
              filterDropdown={createSelectFilterDropdown(
                STATUS_OPTIONS,
                translate("orders.filterStatus"),
                translate("buttons.filter", {}, "Filter"),
                translate("buttons.reset", {}, "Reset")
              )}
              defaultFilteredValue={normalizeFilterValue(getDefaultFilter("status", filters, "eq"))}
            />
            <Table.Column
              dataIndex="payment_status"
              title={translate("orders.fields.payment")}
              render={(v: string) => (
                <Tag color={PAYMENT_COLORS[v] ?? "default"}>{v ? translate(`paymentStatus.${v}`, {}, formatDisplayLabel(v)) : "-"}</Tag>
              )}
              filterDropdown={createSelectFilterDropdown(
                PAYMENT_OPTIONS,
                translate("orders.filterPayment"),
                translate("buttons.filter", {}, "Filter"),
                translate("buttons.reset", {}, "Reset")
              )}
              defaultFilteredValue={normalizeFilterValue(getDefaultFilter("payment_status", filters, "eq"))}
            />
            <Table.Column
              dataIndex="payment_type"
              title={translate("orders.fields.paymentType")}
              responsive={["lg"]}
              render={(v: string | null | undefined) => (
                v ? translate(`orders.paymentTypes.${v}`, {}, formatDisplayLabel(v)) : "-"
              )}
            />
            <Table.Column
              dataIndex="courier_code"
              title={translate("orders.fields.courierCode")}
              responsive={["md"]}
              render={(v: string | null | undefined) => (v ? getFallbackCourierOption(v).label : "-")}
            />
            <Table.Column dataIndex="waybill_number" title={translate("orders.fields.waybillNumber")} responsive={["md"]} render={(v) => v || "-"} />
            <Table.Column dataIndex="created_at" title={translate("orders.fields.created")} responsive={["lg"]} render={(v) => v ? new Date(v).toLocaleDateString("id-ID") : "-"} />
            <Table.Column
              title={translate("table.actions")}
              key="actions"
              align="center"
              width={80}
              render={(_, record: BaseRecord) => {
                const recordId = getOrderRecordKey(record);

                if (recordId === undefined) {
                  return null;
                }

                return (
                  <Space size="small" onClick={(event) => event.stopPropagation()}>
                    <Tooltip title={translate("orders.showDetail")} trigger={["hover", "focus"]}>
                      <ShowButton
                        hideText
                        size="small"
                        recordItemId={recordId}
                        resource="orders"
                        aria-label={translate("orders.actions.showDetailAriaLabel", { id: String(recordId) })}
                      />
                    </Tooltip>
                  </Space>
                );
              }}
            />
          </Table>
        )}
      </div>
    </List>
  );
};

