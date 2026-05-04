import { useState } from "react";
import { useTranslation } from "@refinedev/core";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Alert, Button, Card, Input, Space, Typography } from "antd";
import { AuthTitle } from "../../components/layout/auth-title";
import authProvider from "../../providers/auth";
import { MFA_VERIFY_ROUTE, sanitizeMfaReturnTo } from "../../utils/mfa";

function getRedirectTarget(resultRedirectTo: string | undefined, returnTo: string | null): string {
  if (resultRedirectTo === MFA_VERIFY_ROUTE) return MFA_VERIFY_ROUTE;
  return sanitizeMfaReturnTo(returnTo) ?? resultRedirectTo ?? "/";
}

export function Login() {
  const { translate } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setLoading(true);
    setError(null);

    try {
      const result = await authProvider.login({ email, password, to: searchParams.get("to") ?? undefined });

      if (!result.success) {
        setError(result.error?.message ?? translate("auth.loginFailed", {}, "Login failed"));
        return;
      }

      navigate(getRedirectTarget(result.redirectTo, searchParams.get("to")), { replace: true });
    } catch {
      setError(translate("auth.loginFailed", {}, "Login failed"));
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
            {translate("auth.login.title", {}, "Sign in")}
          </Typography.Title>
          <Typography.Paragraph style={{ margin: 0 }}>
            {translate("auth.login.description", {}, "Use your email and password to access the admin panel.")}
          </Typography.Paragraph>

          {error && <Alert type="error" showIcon message={error} />}

          <form
            onSubmit={(event) => {
              event.preventDefault();
              void handleSubmit();
            }}
          >
            <Space direction="vertical" size={16} style={{ width: "100%" }}>
              <label>
                <span>{translate("auth.email", {}, "Email")}</span>
                <Input
                  autoComplete="email"
                  name="email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="admin@example.com"
                />
              </label>

              <label>
                <span>{translate("auth.password", {}, "Password")}</span>
                <Input.Password
                  autoComplete="current-password"
                  name="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="••••••••"
                />
              </label>

              <Button htmlType="submit" type="primary" loading={loading}>
                {translate("auth.login.submit", {}, "Login")}
              </Button>

              <div style={{ textAlign: "right" }}>
                <Link to="/forgot-password">{translate("auth.login.forgotPassword", {}, "Forgot password?")}</Link>
              </div>
            </Space>
          </form>
        </Space>
      </Card>
    </div>
  );
};
