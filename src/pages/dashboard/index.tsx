import { useList, useTranslation, useNavigation } from "@refinedev/core";
import { Card, Col, Row, Statistic, Table, Tag, Typography, Button, Empty } from "antd";
import {
  ShoppingCartOutlined,
  UserOutlined,
  InboxOutlined,
  DollarOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { STATUS_COLORS } from "../../constants/orders";

const { Text } = Typography;

export const Dashboard: React.FC = () => {
  const { translate } = useTranslation();
  const { list: navigateList } = useNavigation();

  // Count-only queries (fetch 1 row, get exact count)
  const { result: ordersResult } = useList({
    resource: "orders",
    pagination: { currentPage: 1, pageSize: 1 },
    meta: { count: "exact" },
  });
  const { result: customersResult } = useList({
    resource: "profiles",
    pagination: { currentPage: 1, pageSize: 1 },
    meta: { count: "exact" },
    filters: [{ field: "role", operator: "eq", value: "customer" }],
  });
  const { result: productsResult } = useList({
    resource: "products",
    pagination: { currentPage: 1, pageSize: 1 },
    meta: { count: "exact" },
  });

  // Revenue: sum of delivered orders
  const { result: revenueResult } = useList({
    resource: "orders",
    pagination: { mode: "off" },
    filters: [{ field: "status", operator: "eq", value: "delivered" }],
    meta: { select: "total_amount" },
  });

  // Recent 5 orders
  const { result: recentOrdersResult, query: recentOrdersQuery } = useList({
    resource: "orders",
    pagination: { currentPage: 1, pageSize: 5 },
    sorters: [{ field: "created_at", order: "desc" }],
  });

  // Low stock products (stock < 10, active only)
  const { result: lowStockResult, query: lowStockQuery } = useList({
    resource: "products",
    pagination: { currentPage: 1, pageSize: 10 },
    sorters: [{ field: "stock", order: "asc" }],
    filters: [
      { field: "stock", operator: "lt", value: 10 },
      { field: "is_active", operator: "eq", value: true },
    ],
  });

  const totalOrders = ordersResult?.total ?? 0;
  const totalCustomers = customersResult?.total ?? 0;
  const totalProducts = productsResult?.total ?? 0;

  const totalRevenue = (revenueResult?.data ?? []).reduce(
    (sum, o) => sum + Number((o as { total_amount?: string | number }).total_amount || 0),
    0,
  );

  const recentOrders = (recentOrdersResult?.data ?? []) as {
    id: string;
    total_amount: string | number;
    status: string;
    created_at: string;
  }[];

  const lowStockProducts = (lowStockResult?.data ?? []) as {
    id: string;
    name: string;
    stock: number;
  }[];

  return (
    <>
      {/* Stat cards */}
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title={translate("dashboard.totalOrders")}
              value={totalOrders}
              prefix={<ShoppingCartOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title={translate("dashboard.totalCustomers")}
              value={totalCustomers}
              prefix={<UserOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title={translate("dashboard.totalProducts")}
              value={totalProducts}
              prefix={<InboxOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title={translate("dashboard.totalRevenue")}
              value={totalRevenue}
              prefix={<DollarOutlined />}
              formatter={(v) => `Rp ${Number(v).toLocaleString("id-ID")}`}
            />
          </Card>
        </Col>
      </Row>

      {/* Recent orders + Low stock */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={14}>
          <Card
            title={translate("dashboard.recentOrders")}
            extra={
              <Button type="link" size="small" onClick={() => navigateList("orders")}>
                {translate("dashboard.viewAll")}
              </Button>
            }
          >
            <Table
              dataSource={recentOrders}
              rowKey="id"
              pagination={false}
              size="small"
              loading={recentOrdersQuery?.isLoading}
              locale={{ emptyText: <Empty description={translate("dashboard.noRecentOrders")} /> }}
            >
              <Table.Column dataIndex="id" title="ID" width={80} />
              <Table.Column
                dataIndex="total_amount"
                title={translate("dashboard.orderTotal")}
                render={(v) => `Rp ${Number(v || 0).toLocaleString("id-ID")}`}
              />
              <Table.Column
                dataIndex="status"
                title={translate("dashboard.orderStatus")}
                render={(v: string) => (
                  <Tag color={STATUS_COLORS[v] ?? "default"}>{v ? translate(`orderStatus.${v}`) : "-"}</Tag>
                )}
              />
              <Table.Column
                dataIndex="created_at"
                title={translate("dashboard.orderDate")}
                render={(v) => (v ? new Date(v).toLocaleDateString("id-ID") : "-")}
              />
            </Table>
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card
            title={
              <>
                <WarningOutlined style={{ color: "#faad14", marginRight: 8 }} />
                {translate("dashboard.lowStockAlerts")}
              </>
            }
            extra={
              <Button type="link" size="small" onClick={() => navigateList("products")}>
                {translate("dashboard.viewAll")}
              </Button>
            }
          >
            <Table
              dataSource={lowStockProducts}
              rowKey="id"
              pagination={false}
              size="small"
              loading={lowStockQuery?.isLoading}
              locale={{ emptyText: <Empty description={translate("dashboard.noLowStock")} /> }}
            >
              <Table.Column dataIndex="name" title={translate("dashboard.productName")} />
              <Table.Column
                dataIndex="stock"
                title={translate("dashboard.currentStock")}
                width={80}
                render={(v: number) => (
                  <Text type={v === 0 ? "danger" : "warning"} strong>
                    {v}
                  </Text>
                )}
              />
            </Table>
          </Card>
        </Col>
      </Row>
    </>
  );
};
