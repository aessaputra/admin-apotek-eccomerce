import { useList } from "@refinedev/core";
import { Card, Col, Row, Statistic } from "antd";
import { ShoppingCartOutlined, UserOutlined, InboxOutlined } from "@ant-design/icons";

export const Dashboard: React.FC = () => {
  const { data: ordersData } = useList({ resource: "orders" });
  const { data: customersData } = useList({ resource: "profiles" });
  const { data: productsData } = useList({ resource: "products" });

  const totalOrders = ordersData?.total ?? 0;
  const totalCustomers = customersData?.total ?? 0;
  const totalProducts = productsData?.total ?? 0;

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
