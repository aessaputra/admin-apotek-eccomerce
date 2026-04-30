import { List, useTable, ShowButton, getDefaultFilter } from "@refinedev/antd";
import { useTranslation } from "@refinedev/core";
import { Button, Table, Space, Tooltip, Select, Tag } from "antd";
import type { FilterDropdownProps } from "antd/es/table/interface";
import { STATUS_COLORS, PAYMENT_COLORS, getStatusOptions, getPaymentOptions } from "../../constants/orders";
import { getFallbackCourierOption } from "../../constants/couriers";

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
  const { tableProps, filters } = useTable({
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

  return (
    <List>
      <Table {...tableProps} rowKey="id">
        <Table.Column dataIndex="id" title={translate("orders.fields.id")} width={80} />
        <Table.Column dataIndex="total_amount" title={translate("orders.fields.total")} render={(v) => `Rp ${Number(v || 0).toLocaleString("id-ID")}`} />
        <Table.Column
          dataIndex="status"
          title={translate("orders.fields.status")}
          render={(v: string) => (
            <Tag color={STATUS_COLORS[v] ?? "default"}>{v ? translate(`orderStatus.${v}`, {}, formatDisplayLabel(v)) : "-"}</Tag>
          )}
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
          render={(v: string | null | undefined) => (
            v ? translate(`orders.paymentTypes.${v}`, {}, formatDisplayLabel(v)) : "-"
          )}
        />
        <Table.Column
          dataIndex="courier_code"
          title={translate("orders.fields.courierCode")}
          render={(v: string | null | undefined) => (v ? getFallbackCourierOption(v).label : "-")}
        />
        <Table.Column dataIndex="waybill_number" title={translate("orders.fields.waybillNumber")} render={(v) => v || "-"} />
        <Table.Column dataIndex="created_at" title={translate("orders.fields.created")} render={(v) => v ? new Date(v).toLocaleDateString() : "-"} />
        <Table.Column
          title={translate("table.actions")}
          key="actions"
          align="center"
          width={80}
          render={(_, record: { id: string }) => (
            <Space size="small">
              <Tooltip title={translate("orders.showDetail")}>
                <ShowButton hideText size="small" recordItemId={record.id} resource="orders" />
              </Tooltip>
            </Space>
          )}
        />
      </Table>
    </List>
  );
};
