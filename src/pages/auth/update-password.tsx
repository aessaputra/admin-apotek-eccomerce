import { useState } from "react";
import { useUpdatePassword, useTranslation } from "@refinedev/core";
import { useNavigate } from "react-router";
import { Alert, Button, Card, Input, Space, Typography } from "antd";
import { AuthTitle } from "../../components/layout/auth-title";

export function UpdatePassword() {
  const { translate } = useTranslation();
  const navigate = useNavigate();
  const { mutateAsync: updatePassword } = useUpdatePassword();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);

    if (password !== confirmPassword) {
      setError(translate("profile.passwordMismatch", {}, "Passwords do not match."));
      return;
    }

    if (password.length < 8) {
      setError(translate("profile.passwordMinLength", {}, "Password must be at least 8 characters."));
      return;
    }

    setLoading(true);

    try {
      const result = await updatePassword({ password });

      if (result?.success === false) {
        setError(result.error?.message ?? translate("auth.updatePasswordFailed", {}, "Failed to update password."));
        return;
      }

      // Automatically navigate to dashboard on success
      navigate("/", { replace: true });
    } catch {
      setError(translate("auth.updatePasswordFailed", {}, "Failed to update password."));
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
            {translate("profile.changePassword", {}, "Set New Password")}
          </Typography.Title>
          <Typography.Paragraph style={{ margin: 0 }}>
            {translate("profile.newPasswordDescription", {}, "Please enter a strong password to secure your account.")}
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
                <span>{translate("profile.newPassword", {}, "New Password")}</span>
                <Input.Password
                  autoComplete="new-password"
                  name="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={translate("profile.newPasswordPlaceholder", {}, "••••••••")}
                  required
                />
              </label>

              <label>
                <span>{translate("profile.confirmPassword", {}, "Confirm Password")}</span>
                <Input.Password
                  autoComplete="new-password"
                  name="confirmPassword"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder={translate("profile.confirmPasswordPlaceholder", {}, "••••••••")}
                  required
                />
              </label>

              <Button htmlType="submit" type="primary" loading={loading} style={{ width: "100%", marginTop: 8 }}>
                {translate("profile.changePassword", {}, "Set New Password")}
              </Button>
            </Space>
          </form>
        </Space>
      </Card>
    </div>
  );
}
