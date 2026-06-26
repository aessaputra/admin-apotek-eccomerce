import { useState } from "react";
import { useTranslation, useForgotPassword } from "@refinedev/core";
import { Link } from "react-router";
import { Alert, Button, Card, Input, Space, Typography } from "antd";
import { AuthTitle } from "../../components/layout/auth-title";

export function ForgotPassword() {
  const { translate } = useTranslation();
  const { mutateAsync: forgotPassword } = useForgotPassword();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit() {
    setError(null);
    setSuccess(false);

    if (!email) {
      setError(translate("forgotPassword.errors.requiredEmail", {}, "Email is required"));
      return;
    }

    setLoading(true);

    try {
      const result = await forgotPassword({ email });

      if (result?.success === false) {
        setError(result.error?.message ?? translate("auth.forgotPasswordFailed", {}, "Failed to send reset instructions."));
        return;
      }

      setSuccess(true);
      setEmail("");
    } catch {
      setError(translate("auth.forgotPasswordFailed", {}, "Failed to send reset instructions."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <Card style={{ width: "100%", maxWidth: 480 }}>
        <Space direction="vertical" size={24} style={{ width: "100%" }}>
          <AuthTitle />
          <Typography.Title level={3} style={{ margin: 0 }}>
            {translate("pages.forgotPassword.title", {}, "Forgot Password?")}
          </Typography.Title>
          <Typography.Paragraph style={{ margin: 0 }}>
            {translate("pages.forgotPassword.description", {}, "Enter your email address and we'll send you instructions to reset your password.")}
          </Typography.Paragraph>

          {error && <Alert type="error" showIcon message={error} />}
          {success && (
            <Alert
              type="success"
              showIcon
              message={translate("pages.forgotPassword.success", {}, "Password reset instructions have been sent to your email.")}
            />
          )}

          <form
            onSubmit={(event) => {
              event.preventDefault();
              void handleSubmit();
            }}
          >
            <Space direction="vertical" size={16} style={{ width: "100%" }}>
              <label>
                <span>{translate("pages.forgotPassword.fields.email", {}, "Email")}</span>
                <Input
                  autoComplete="email"
                  name="email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="admin@example.com"
                  required
                />
              </label>

              <Button htmlType="submit" type="primary" loading={loading} style={{ width: "100%", marginTop: 8 }}>
                {translate("pages.forgotPassword.buttons.submit", {}, "Send Reset Instructions")}
              </Button>

              <div style={{ textAlign: "center", marginTop: 8 }}>
                <span>{translate("pages.forgotPassword.buttons.haveAccount", {}, "Already have an account? ")}</span>
                <Link to="/login">{translate("pages.forgotPassword.signin", {}, "Sign in")}</Link>
              </div>
            </Space>
          </form>
        </Space>
      </Card>
    </div>
  );
}
