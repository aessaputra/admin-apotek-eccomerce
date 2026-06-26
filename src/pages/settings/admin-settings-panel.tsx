import { useState } from "react";
import { Form, Input, Button, Card, Typography, Row, Col, Space, Divider } from "antd";
import { MailOutlined, UserAddOutlined, SecurityScanOutlined } from "@ant-design/icons";
import { useNotification, useTranslation } from "@refinedev/core";
import { supabaseClient } from "../../providers/supabase-client";

const { Title, Text, Paragraph } = Typography;

interface InviteAdminFormValues {
  email: string;
}

export const AdminSettingsPanel: React.FC = () => {
  const [form] = Form.useForm<InviteAdminFormValues>();
  const [isInviting, setIsInviting] = useState(false);
  const { open } = useNotification();
  const { translate } = useTranslation();

  const handleInvite = async (values: InviteAdminFormValues) => {
    setIsInviting(true);
    try {
      const { data, error } = await supabaseClient.functions.invoke("invite-admin", {
        body: { email: values.email },
      });

      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      open?.({
        type: "success",
        message: translate("settings.admin.inviteSuccess", {}, "Admin Invited Successfully"),
        description: translate(
          "settings.admin.inviteSuccessDescription",
          {},
          `An invitation has been securely dispatched to ${values.email}.`
        ),
      });
      form.resetFields();
    } catch (error: any) {
      open?.({
        type: "error",
        message: translate("settings.admin.inviteError", {}, "Invitation Failed"),
        description: error.message || translate("settings.admin.inviteErrorDescription", {}, "Unable to process the request."),
      });
    } finally {
      setIsInviting(false);
    }
  };

  return (
    <Card 
      bordered={false} 
      style={{ 
        boxShadow: "0 10px 40px -10px rgba(0,0,0,0.08)", 
        borderRadius: 16,
        overflow: "hidden" 
      }}
      bodyStyle={{ padding: 0 }}
    >
      <Row>
        {/* Left Side: Visual & Context */}
        <Col xs={24} md={10} style={{ 
          background: "linear-gradient(145deg, #f6f8fb 0%, #e9eef5 100%)", 
          padding: "48px 32px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center"
        }}>
          <Space direction="vertical" size="large">
            <div style={{ 
              width: 56, 
              height: 56, 
              borderRadius: 16, 
              background: "#1890ff", 
              display: "flex", 
              alignItems: "center", 
              justifyContent: "center",
              boxShadow: "0 8px 20px rgba(24, 144, 255, 0.3)"
            }}>
              <SecurityScanOutlined style={{ fontSize: 28, color: "#fff" }} />
            </div>
            
            <div>
              <Title level={3} style={{ marginTop: 0, marginBottom: 8, letterSpacing: "-0.5px" }}>
                {translate("settings.admin.title", {}, "Elevate Access")}
              </Title>
              <Paragraph style={{ color: "#5c6b7f", fontSize: 15, lineHeight: 1.6 }}>
                {translate(
                  "settings.admin.description",
                  {},
                  "Empower your team by inviting a new administrator. They will receive an exclusive invitation link with full administrative privileges instantly assigned upon registration."
                )}
              </Paragraph>
            </div>
            
            <Divider style={{ margin: "12px 0", borderColor: "rgba(0,0,0,0.06)" }} />
            
            <Space size="middle">
              <UserAddOutlined style={{ color: "#1890ff", fontSize: 18 }} />
              <Text strong style={{ color: "#334054" }}>Instant Role Assignment</Text>
            </Space>
          </Space>
        </Col>

        {/* Right Side: Form */}
        <Col xs={24} md={14} style={{ padding: "48px 40px" }}>
          <div style={{ maxWidth: 400 }}>
            <Title level={4} style={{ marginBottom: 24, fontWeight: 600 }}>
              {translate("settings.admin.formTitle", {}, "Send Invitation")}
            </Title>
            
            <Form
              form={form}
              layout="vertical"
              onFinish={handleInvite}
              requiredMark="optional"
            >
              <Form.Item
                label={
                  <Text strong style={{ color: "#475467" }}>
                    {translate("settings.admin.email", {}, "Administrator Email")}
                  </Text>
                }
                name="email"
                rules={[
                  { required: true, message: translate("settings.validation.emailRequired", {}, "Please enter an email address") },
                  { type: "email", message: translate("settings.validation.emailInvalid", {}, "Please enter a valid email") },
                ]}
              >
                <Input 
                  size="large" 
                  prefix={<MailOutlined style={{ color: "#98a2b3", marginRight: 4 }} />} 
                  placeholder="colleague@pharmacy.com" 
                  style={{ borderRadius: 8, padding: "8px 12px" }}
                />
              </Form.Item>
              
              <Form.Item style={{ marginTop: 32, marginBottom: 0 }}>
                <Button 
                  type="primary" 
                  htmlType="submit" 
                  size="large" 
                  loading={isInviting}
                  icon={<UserAddOutlined />}
                  style={{ 
                    borderRadius: 8, 
                    height: 48, 
                    fontWeight: 600,
                    width: "100%",
                    boxShadow: "0 4px 12px rgba(24, 144, 255, 0.25)"
                  }}
                >
                  {translate("settings.admin.inviteButton", {}, "Send Secure Invitation")}
                </Button>
              </Form.Item>
            </Form>
          </div>
        </Col>
      </Row>
    </Card>
  );
};
