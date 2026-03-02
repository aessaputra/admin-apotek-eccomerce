import { useList, useTranslation } from "@refinedev/core";
import { Card, Col, Row, Statistic } from "antd";
import { ShoppingCartOutlined, UserOutlined, InboxOutlined } from "@ant-design/icons";

export const Dashboard: React.FC = () => {
  const { translate } = useTranslation();
  const { result: ordersResult } = useList({ resource: "orders", pagination: { mode: "off" }, meta: { count: "exact" } });
  const { result: customersResult } = useList({ resource: "profiles", pagination: { mode: "off" }, meta: { count: "exact" }, filters: [{ field: "role", operator: "eq", value: "customer" }] });
  const { result: productsResult } = useList({ resource: "products", pagination: { mode: "off" }, meta: { count: "exact" } });

  const totalOrders = ordersResult?.total ?? 0;
  const totalCustomers = customersResult?.total ?? 0;
  const totalProducts = productsResult?.total ?? 0;

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} sm={12} lg={8}>
        <Card>
          <Statistic
            title={translate("dashboard.totalOrders")}
            value={totalOrders}
            prefix={<ShoppingCartOutlined />}
          />
        </Card>
      </Col>
      <Col xs={24} sm={12} lg={8}>
        <Card>
          <Statistic
            title={translate("dashboard.totalCustomers")}
            value={totalCustomers}
            prefix={<UserOutlined />}
          />
        </Card>
      </Col>
      <Col xs={24} sm={12} lg={8}>
        <Card>
          <Statistic
            title={translate("dashboard.totalProducts")}
            value={totalProducts}
            prefix={<InboxOutlined />}
          />
        </Card>
      </Col>
    </Row>
  );
};
