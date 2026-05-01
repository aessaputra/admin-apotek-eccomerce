import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "@refinedev/core";
import { Alert, Button, Card, Form, Input, Select, Space, Typography, theme } from "antd";
import { AuthTitle } from "../../components/layout/auth-title";
import { supabaseClient } from "../../providers/supabase-client";
import {
  clearAllPendingMfaState,
  clearPendingMfaStateForUser,
  getPendingMfaStateForUser,
  getVerifiedTotpFactors,
  type MfaFactor,
  type VerifiedTotpFactor,
} from "../../utils/mfa";

interface VerificationFormValues {
  code: string;
}

interface StatusErrorState {
  canRetry: boolean;
  fallback: string;
  key: string;
}

const VERIFICATION_CODE_PATTERN = /^\d{6}$/;

function getFactorLabel(factor: VerifiedTotpFactor, index: number, translate: ReturnType<typeof useTranslation>["translate"]): string {
  return factor.friendly_name?.trim() || translate("auth.mfa.factorFallback", { index: index + 1 }, `Authenticator app ${index + 1}`);
}

function normalizeVerificationCode(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "").slice(0, 6);
}

export const MfaVerify: React.FC = () => {
  const { translate } = useTranslation();
  const navigate = useNavigate();
  const { token } = theme.useToken();
  const [form] = Form.useForm<VerificationFormValues>();
  const [userId, setUserId] = useState<string | null>(null);
  const [factors, setFactors] = useState<VerifiedTotpFactor[]>([]);
  const [selectedFactorId, setSelectedFactorId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [statusError, setStatusError] = useState<StatusErrorState | null>(null);
  const isMountedRef = useRef(true);

  const logMfaOperationError = useCallback((operation: string, error: unknown) => {
    if (!import.meta.env.DEV) {
      return;
    }

    if (!error || typeof error !== "object") {
      console.warn("[MFA verify]", operation, { message: String(error) });
      return;
    }

    const typedError = error as {
      code?: unknown;
      message?: unknown;
      name?: unknown;
      status?: unknown;
    };

    const safeMetadata: Record<string, string | number> = {};

    if (typeof typedError.name === "string") {
      safeMetadata.name = typedError.name;
    }

    if (typeof typedError.status === "number") {
      safeMetadata.status = typedError.status;
    }

    if (typeof typedError.code === "string" || typeof typedError.code === "number") {
      safeMetadata.code = typedError.code;
    }

    if (typeof typedError.message === "string") {
      safeMetadata.message = typedError.message;
    }

    console.warn("[MFA verify]", operation, safeMetadata);
  }, []);

  const initializeMfaVerification = useCallback(async () => {
    setLoading(true);
    setStatusError(null);
    setFactors([]);
    setSelectedFactorId(undefined);

    const { data: userData } = await supabaseClient.auth.getUser();
    const currentUser = userData?.user;

    if (!isMountedRef.current) {
      return;
    }

    if (!currentUser) {
      clearAllPendingMfaState();
      navigate("/login", { replace: true });
      return;
    }

    setUserId(currentUser.id);

    const { data: assuranceLevel, error: assuranceLevelError } =
      await supabaseClient.auth.mfa.getAuthenticatorAssuranceLevel();

    if (!isMountedRef.current) {
      return;
    }

    if (assuranceLevelError || !assuranceLevel) {
      logMfaOperationError("getAuthenticatorAssuranceLevel", assuranceLevelError);
      setStatusError({
        canRetry: true,
        fallback: "We could not check your verification status. Please try again.",
        key: "auth.mfa.loadError",
      });
      setLoading(false);
      return;
    }

    if (assuranceLevel.currentLevel === "aal2" || assuranceLevel.nextLevel === "aal1") {
      clearPendingMfaStateForUser(currentUser.id);
      navigate("/", { replace: true });
      return;
    }

    const { data: factorData, error: factorError } = await supabaseClient.auth.mfa.listFactors();

    if (!isMountedRef.current) {
      return;
    }

    if (factorError || !factorData) {
      logMfaOperationError("listFactors", factorError);
      setStatusError({
        canRetry: true,
        fallback: "We could not load your verification methods. Please try again.",
        key: "auth.mfa.loadError",
      });
      setLoading(false);
      return;
    }

    const verifiedTotpFactors = getVerifiedTotpFactors((factorData.all ?? []) as MfaFactor[]);
    setFactors(verifiedTotpFactors);
    setSelectedFactorId(verifiedTotpFactors[0]?.id);
    setLoading(false);
  }, [logMfaOperationError, navigate]);

  useEffect(() => {
    isMountedRef.current = true;
    void initializeMfaVerification();

    return () => {
      isMountedRef.current = false;
    };
  }, [initializeMfaVerification]);

  const factorOptions = useMemo(
    () => factors.map((factor, index) => ({ label: getFactorLabel(factor, index, translate), value: factor.id })),
    [factors, translate],
  );

  async function handleVerify(values: VerificationFormValues) {
    const factorId = selectedFactorId;
    if (!factorId || !userId) {
      setStatusError({
        canRetry: false,
        fallback: "No verified authenticator app is available. Sign in again or contact another administrator for recovery.",
        key: "auth.mfa.noFactorsDescription",
      });
      return;
    }

    setVerifying(true);
    setStatusError(null);

    const challenge = await supabaseClient.auth.mfa.challenge({ factorId });
    if (challenge.error || !challenge.data?.id) {
      logMfaOperationError("challenge", challenge.error);
      setStatusError({
        canRetry: false,
        fallback: "We could not start verification. Please try again.",
        key: "auth.mfa.challengeError",
      });
      setVerifying(false);
      return;
    }

    const verification = await supabaseClient.auth.mfa.verify({
      factorId,
      challengeId: challenge.data.id,
      code: values.code.trim(),
    });

    if (verification.error) {
      logMfaOperationError("verify", verification.error);
      setStatusError({
        canRetry: false,
        fallback: "The verification code could not be confirmed. Check the code and try again.",
        key: "auth.mfa.invalidCode",
      });
      setVerifying(false);
      return;
    }

    const { error: refreshError } = await supabaseClient.auth.refreshSession();
    if (refreshError) {
      logMfaOperationError("refreshSession", refreshError);
      setStatusError({
        canRetry: false,
        fallback: "We could not finish verification. Please try again.",
        key: "auth.mfa.refreshError",
      });
      setVerifying(false);
      return;
    }

    const returnTo = getPendingMfaStateForUser(userId)?.returnTo ?? "/";
    clearPendingMfaStateForUser(userId);
    navigate(returnTo, { replace: true });
  }

  async function handleBackToLogin() {
    setSigningOut(true);
    clearAllPendingMfaState();
    await supabaseClient.auth.signOut();
    navigate("/login", { replace: true });
  }

  const hasNoVerifiedFactors = !loading && !statusError && factors.length === 0;
  const statusErrorMessage = statusError
    ? translate(statusError.key, {}, statusError.fallback)
    : null;

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: token.paddingLG,
      }}
    >
      <Card style={{ width: "100%", maxWidth: token.screenXS }} loading={loading}>
        <Space direction="vertical" size={token.marginLG} style={{ width: "100%" }}>
          <AuthTitle />

          <Space direction="vertical" size={token.marginXS} style={{ width: "100%" }}>
            <Typography.Title level={3} style={{ margin: 0 }}>
              {translate("auth.mfa.title", {}, "Verify your sign-in")}
            </Typography.Title>
            <Typography.Paragraph style={{ margin: 0 }}>
              {translate("auth.mfa.description", {}, "Enter the verification code from your authenticator app to continue.")}
            </Typography.Paragraph>
          </Space>

          {statusError && (
            <Alert
              type="error"
              showIcon
              message={statusErrorMessage}
              action={
                statusError.canRetry ? (
                  <Space wrap>
                    <Button size="small" onClick={initializeMfaVerification} loading={loading}>
                      {translate("auth.mfa.retryAction", {}, "Retry")}
                    </Button>
                    <Button size="small" onClick={handleBackToLogin} loading={signingOut}>
                      {translate("auth.mfa.secondaryAction", {}, "Back to login")}
                    </Button>
                  </Space>
                ) : undefined
              }
            />
          )}

          {hasNoVerifiedFactors ? (
            <Alert
              type="warning"
              showIcon
              message={translate("auth.mfa.noFactorsTitle", {}, "No verified authenticator app found")}
              description={translate("auth.mfa.noFactorsDescription", {}, "No verified authenticator app is available. Sign in again or contact another administrator for recovery.")}
              action={
                <Button size="small" onClick={handleBackToLogin} loading={signingOut}>
                  {translate("auth.mfa.secondaryAction", {}, "Back to login")}
                </Button>
              }
            />
          ) : (
            <Form<VerificationFormValues>
              form={form}
              layout="vertical"
              requiredMark={false}
              onFinish={handleVerify}
            >
              {factors.length > 1 && (
                <Form.Item label={translate("auth.mfa.factorLabel", {}, "Authenticator app")}>
                  <Select
                    value={selectedFactorId}
                    options={factorOptions}
                    onChange={setSelectedFactorId}
                    aria-label={translate("auth.mfa.factorLabel", {}, "Authenticator app")}
                  />
                </Form.Item>
              )}

              <Form.Item
                label={translate("auth.mfa.codeLabel", {}, "6-digit code")}
                name="code"
                normalize={normalizeVerificationCode}
                rules={[
                  { required: true, message: translate("auth.mfa.codeRequired", {}, "Enter your 6-digit code.") },
                  { pattern: VERIFICATION_CODE_PATTERN, message: translate("auth.mfa.codeInvalid", {}, "Enter exactly 6 digits.") },
                ]}
              >
                <Input
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder={translate("auth.mfa.codePlaceholder", {}, "123456")}
                />
              </Form.Item>

              <Space wrap>
                <Button type="primary" htmlType="submit" loading={verifying} disabled={!selectedFactorId}>
                  {translate("auth.mfa.primaryAction", {}, "Verify")}
                </Button>
                <Button onClick={handleBackToLogin} loading={signingOut}>
                  {translate("auth.mfa.secondaryAction", {}, "Back to login")}
                </Button>
              </Space>
            </Form>
          )}
        </Space>
      </Card>
    </div>
  );
};
