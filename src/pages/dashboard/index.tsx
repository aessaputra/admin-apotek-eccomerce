import { useList, useTranslation } from "@refinedev/core";
import { Card, Col, Row, Statistic } from "antd";
import { ShoppingCartOutlined, UserOutlined, InboxOutlined } from "@ant-design/icons";

export const Dashboard: React.FC = () => {
  const { translate } = useTranslation();
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
