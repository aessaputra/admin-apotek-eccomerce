import { useList } from "@refinedev/core";
import { Card, Col, Row, Statistic } from "antd";
import { ShoppingCartOutlined, UserOutlined, InboxOutlined } from "@ant-design/icons";

export const Dashboard: React.FC = () => {
  const { result: ordersResult } = useList({ resource: "orders" });
  const { result: customersResult } = useList({ resource: "profiles" });
  const { result: productsResult } = useList({ resource: "products" });

  const totalOrders = ordersResult?.total ?? 0;
  const totalCustomers = customersResult?.total ?? 0;
  const totalProducts = productsResult?.total ?? 0;

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} sm={12} lg={8}>
        <Card>
          <Statistic
            title="Total Orders"
            value={totalOrders}
            prefix={<ShoppingCartOutlined />}
          />
        </Card>
      </Col>
      <Col xs={24} sm={12} lg={8}>
        <Card>
          <Statistic
            title="Total Customers"
            value={totalCustomers}
            prefix={<UserOutlined />}
          />
        </Card>
      </Col>
      <Col xs={24} sm={12} lg={8}>
        <Card>
          <Statistic
            title="Total Products"
            value={totalProducts}
            prefix={<InboxOutlined />}
          />
        </Card>
      </Col>
    </Row>
  );
};
