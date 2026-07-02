import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetIdentity, useUpdatePassword, useTranslation } from "@refinedev/core";
import { Edit, useForm } from "@refinedev/antd";
import { Alert, Button, Card, Divider, Form, Input, List, Modal, Space, Tag, Typography, message, theme } from "antd";
import { LockOutlined } from "@ant-design/icons";
import { AvatarUpload } from "../../components/avatar-upload";
import { supabaseClient } from "../../providers/supabase-client";
import { getVerifiedTotpFactors, type MfaFactor } from "../../utils/mfa";

type IdentityUser = { id: string };

interface VerificationFormValues {
  code: string;
}

interface EnrollmentState {
  factorId: string | null;
  qrCode: string;
  secret: string;
  uri: string;
}

const TOTP_FACTOR_TYPE = "totp";
const VERIFIED_FACTOR_STATUS = "verified";
const VERIFICATION_CODE_PATTERN = /^\d{6}$/;

function normalizeVerificationCode(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "").slice(0, 6);
}

function isTotpFactor(factor: MfaFactor): boolean {
  return factor.factor_type === TOTP_FACTOR_TYPE;
}

function getFactorLabel(factor: MfaFactor, index: number, translate: ReturnType<typeof useTranslation>["translate"]): string {
  return factor.friendly_name?.trim() || translate("profile.mfa.factorFallback", { index: index + 1 }, `Verification app ${index + 1}`);
}

function getQrCodeSrc(qrCode: string): string {
  if (qrCode.startsWith("data:image")) {
    return qrCode;
  }

  return `data:image/svg+xml;utf8,${encodeURIComponent(qrCode)}`;
}

const emptyEnrollmentState: EnrollmentState = {
  factorId: null,
  qrCode: "",
  secret: "",
  uri: "",
};

interface MfaManagementCardProps {
  contentMaxWidth: number | string;
}

const MfaManagementCard: React.FC<MfaManagementCardProps> = ({ contentMaxWidth }) => {
  const { translate } = useTranslation();
  const { token } = theme.useToken();
  const [setupForm] = Form.useForm<VerificationFormValues>();
  const [factors, setFactors] = useState<MfaFactor[]>([]);
  const [factorsLoading, setFactorsLoading] = useState(true);
  const [factorsError, setFactorsError] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [enrollment, setEnrollment] = useState<EnrollmentState>(emptyEnrollmentState);
  const [enrolling, setEnrolling] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [resettingEnrollment, setResettingEnrollment] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [unenrollingFactorId, setUnenrollingFactorId] = useState<string | null>(null);

  const loadFactors = useCallback(async () => {
    setFactorsLoading(true);
    setFactorsError(null);

    const { data, error } = await supabaseClient.auth.mfa.listFactors();
    if (error || !data) {
      setFactorsError(translate("profile.mfa.loadError", {}, "We could not load your verification apps. Please try again."));
      setFactors([]);
      setFactorsLoading(false);
      return;
    }

    setFactors(((data.all ?? []) as MfaFactor[]).filter(isTotpFactor));
    setFactorsLoading(false);
  }, [translate]);

  useEffect(() => {
    void loadFactors();
  }, [loadFactors]);

  const verifiedFactors = useMemo(() => getVerifiedTotpFactors(factors), [factors]);
  const verifiedCount = verifiedFactors.length;
  const totalTotpCount = factors.length;
  const hasVerifiedFactor = verifiedCount > 0;

  const factorSummary = translate(
    "profile.mfa.factorSummary",
    { verified: verifiedCount, total: totalTotpCount },
    `${verifiedCount} verified · ${totalTotpCount} total verification apps`,
  );

  const setupTitle = translate("profile.mfa.setupDialogTitle", {}, "Set up verification");

  const setupCardStyle = useMemo<CSSProperties>(
    () => ({
      maxWidth: contentMaxWidth,
      width: "100%",
    }),
    [contentMaxWidth],
  );

  const setupSecretStyle = useMemo<CSSProperties>(
    () => ({
      padding: token.paddingSM,
      borderRadius: token.borderRadius,
      border: `1px solid ${token.colorBorderSecondary}`,
      backgroundColor: token.colorFillAlter,
    }),
    [token],
  );

  const clearEnrollmentState = useCallback(() => {
    setupForm.resetFields();
    setEnrollment(emptyEnrollmentState);
    setSetupError(null);
  }, [setupForm]);

  const cleanupPendingEnrollment = useCallback(async () => {
    if (!enrollment.factorId) return;

    await supabaseClient.auth.mfa.unenroll({ factorId: enrollment.factorId });
  }, [enrollment.factorId]);

  const startEnrollment = useCallback(async () => {
    setSetupOpen(true);
    setEnrolling(true);
    setSetupError(null);
    setupForm.resetFields();
    setEnrollment(emptyEnrollmentState);

    const { data, error } = await supabaseClient.auth.mfa.enroll({ factorType: "totp" });
    if (error || !data?.id || !data.totp?.qr_code || !data.totp.secret) {
      setSetupError(translate("profile.mfa.enrollError", {}, "We could not start verification setup. Please try again."));
      setEnrolling(false);
      return;
    }

    setEnrollment({
      factorId: data.id,
      qrCode: data.totp.qr_code,
      secret: data.totp.secret,
      uri: data.totp.uri ?? "",
    });
    setEnrolling(false);
  }, [setupForm, translate]);

  const closeSetupDialog = useCallback(async () => {
    if (enrolling) return;

    setResettingEnrollment(true);
    try {
      await cleanupPendingEnrollment();
      await loadFactors();
    } finally {
      setSetupOpen(false);
      setResettingEnrollment(false);
      clearEnrollmentState();
    }
  }, [cleanupPendingEnrollment, clearEnrollmentState, enrolling, loadFactors]);

  const restartEnrollment = useCallback(async () => {
    if (enrolling) return;

    setResettingEnrollment(true);
    try {
      await cleanupPendingEnrollment();
    } finally {
      setResettingEnrollment(false);
    }
    await startEnrollment();
  }, [cleanupPendingEnrollment, enrolling, startEnrollment]);

  const verifyEnrollment = async (values: VerificationFormValues) => {
    if (!enrollment.factorId) {
      setSetupError(translate("profile.mfa.enrollError", {}, "We could not start verification setup. Please try again."));
      return;
    }

    setVerifying(true);
    setSetupError(null);

    const challenge = await supabaseClient.auth.mfa.challenge({ factorId: enrollment.factorId });
    if (challenge.error || !challenge.data?.id) {
      setSetupError(translate("profile.mfa.verifyError", {}, "The verification code could not be confirmed. Check the code and try again."));
      setVerifying(false);
      return;
    }

    const verification = await supabaseClient.auth.mfa.verify({
      factorId: enrollment.factorId,
      challengeId: challenge.data.id,
      code: values.code.trim(),
    });

    if (verification.error) {
      setSetupError(translate("profile.mfa.verifyError", {}, "The verification code could not be confirmed. Check the code and try again."));
      setVerifying(false);
      return;
    }

    await supabaseClient.auth.refreshSession();
    await loadFactors();
    message.success(translate("profile.mfa.verifySuccess", {}, "Verification app verified."));
    setVerifying(false);
    setSetupOpen(false);
    clearEnrollmentState();
  };

  const removeFactor = useCallback((factor: MfaFactor, index: number) => {
    Modal.confirm({
      title: translate("profile.mfa.removeConfirmTitle", {}, "Remove verification app?"),
      content: translate(
        "profile.mfa.removeConfirmContent",
        { name: getFactorLabel(factor, index, translate) },
        "This verification app will no longer be accepted for sign-in verification.",
      ),
      okText: translate("profile.mfa.removeConfirmOk", {}, "Remove"),
      cancelText: translate("profile.mfa.cancel", {}, "Cancel"),
      okButtonProps: { danger: true },
      onOk: async () => {
        setUnenrollingFactorId(factor.id);
        try {
          const { data: aal, error: aalError } = await supabaseClient.auth.mfa.getAuthenticatorAssuranceLevel();
          if (aalError || aal?.currentLevel !== "aal2") {
            message.error(translate(
              "profile.mfa.aal2Required",
              {},
              "Log out, sign in again, and complete MFA before removing a verification app.",
            ));
            return;
          }

          const { error } = await supabaseClient.auth.mfa.unenroll({ factorId: factor.id });
          if (error) {
            message.error(translate("profile.mfa.unenrollError", {}, "We could not remove that verification app. Please try again."));
            return;
          }

          await supabaseClient.auth.refreshSession();
          await loadFactors();
          message.success(translate("profile.mfa.unenrollSuccess", {}, "Verification app removed."));
        } finally {
          setUnenrollingFactorId(null);
        }
      },
    });
  }, [loadFactors, translate]);

  return (
    <>
      <Card loading={factorsLoading} style={setupCardStyle}>
        <Space direction="vertical" size={token.marginSM} style={{ width: "100%" }}>
          <Space align="start" style={{ width: "100%", justifyContent: "space-between" }}>
            <Space direction="vertical" size={token.marginXXS}>
              <Typography.Title level={5} style={{ margin: 0 }}>
                {translate("profile.mfa.title", {}, "Two-step verification")}
              </Typography.Title>
              <Typography.Text type="secondary">
                {translate("profile.mfa.description", {}, "Use a 6-digit code after signing in with your password.")}
              </Typography.Text>
            </Space>
            <Tag color={hasVerifiedFactor ? "green" : "default"}>
              {hasVerifiedFactor
                ? translate("profile.mfa.enabled", {}, "Enabled")
                : translate("profile.mfa.disabled", {}, "Disabled")}
            </Tag>
          </Space>

          {factorsError ? <Alert type="error" showIcon message={factorsError} /> : null}

          <Typography.Text>{factorSummary}</Typography.Text>

          {!hasVerifiedFactor ? (
            <Alert
              type="info"
              showIcon
              message={translate("profile.mfa.optionalTitle", {}, "Optional but recommended")}
              description={translate("profile.mfa.optionalDescription", {}, "Set up verification when you are ready. Admins without a verified app can still sign in normally.")}
            />
          ) : null}

          <Space wrap>
            {!hasVerifiedFactor ? (
              <Button type="primary" onClick={() => void startEnrollment()}>
                {translate("profile.mfa.setupAction", {}, "Set up verification")}
              </Button>
            ) : null}
            {totalTotpCount > 0 ? (
              <Button onClick={() => setManageOpen(true)}>
                {translate("profile.mfa.manageAction", {}, "Manage verification apps")}
              </Button>
            ) : null}
            <Button onClick={() => void loadFactors()} loading={factorsLoading}>
              {translate("profile.mfa.refreshAction", {}, "Refresh")}
            </Button>
          </Space>
        </Space>
      </Card>

      <Modal
        open={setupOpen}
        title={setupTitle}
        onCancel={() => void closeSetupDialog()}
        width="90%"
        style={{ maxWidth: 640 }}
        destroyOnHidden
        maskClosable={false}
        footer={
          <Space wrap style={{ width: "100%", justifyContent: "flex-end" }}>
            <Button style={{ minHeight: 44 }} onClick={() => void closeSetupDialog()} loading={resettingEnrollment} disabled={enrolling}>
              {translate("profile.mfa.cancel", {}, "Cancel")}
            </Button>
            <Button style={{ minHeight: 44 }} onClick={() => void restartEnrollment()} loading={resettingEnrollment || enrolling} disabled={!enrollment.factorId || enrolling}>
              {translate("profile.mfa.restartAction", {}, "Restart setup")}
            </Button>
            <Button style={{ minHeight: 44 }} type="primary" onClick={() => setupForm.submit()} loading={verifying} disabled={!enrollment.factorId || enrolling}>
              {translate("profile.mfa.verifyAction", {}, "Verify setup")}
            </Button>
          </Space>
        }
      >
        <Space direction="vertical" size={token.marginMD} style={{ width: "100%" }}>
          <Typography.Paragraph style={{ margin: 0 }}>
            {translate("profile.mfa.setupInstructions", {}, "Scan the QR code with a verification app, then enter the 6-digit code it shows.")}
          </Typography.Paragraph>

          {setupError ? <Alert type="error" showIcon message={setupError} /> : null}

          {enrolling ? <Alert type="info" showIcon message={translate("profile.mfa.enrolling", {}, "Preparing verification setup...")} /> : null}

          {enrollment.qrCode ? (
            <Space direction="vertical" size={token.marginSM} style={{ width: "100%" }}>
              <div style={{ textAlign: "center" }}>
                <img
                  alt={translate("profile.mfa.qrAlt", {}, "Verification setup QR code")}
                  src={getQrCodeSrc(enrollment.qrCode)}
                  width={256}
                  height={256}
                  style={{ maxWidth: "100%", height: "auto" }}
                />
              </div>
              <div style={setupSecretStyle}>
                <Typography.Text strong>{translate("profile.mfa.manualSecretLabel", {}, "Manual setup key")}</Typography.Text>
                <Input value={enrollment.secret} readOnly aria-label={translate("profile.mfa.manualSecretLabel", {}, "Manual setup key")} />
                {enrollment.uri ? (
                  <Typography.Text type="secondary" style={{ display: "block", marginTop: token.marginXS }}>
                    {translate("profile.mfa.manualUriHint", {}, "Use this key only if QR scanning is unavailable.")}
                  </Typography.Text>
                ) : null}
              </div>
            </Space>
          ) : null}

          <Form<VerificationFormValues>
            form={setupForm}
            layout="vertical"
            requiredMark={false}
            onFinish={verifyEnrollment}
          >
            <Form.Item
              label={translate("profile.mfa.codeLabel", {}, "6-digit code")}
              name="code"
              normalize={normalizeVerificationCode}
              rules={[
                { required: true, message: translate("profile.mfa.codeRequired", {}, "Enter the 6-digit code.") },
                { pattern: VERIFICATION_CODE_PATTERN, message: translate("profile.mfa.codeInvalid", {}, "Enter exactly 6 digits.") },
              ]}
            >
              <Input
                autoComplete="one-time-code"
                inputMode="numeric"
                maxLength={6}
                placeholder={translate("profile.mfa.codePlaceholder", {}, "123456")}
              />
            </Form.Item>
          </Form>
        </Space>
      </Modal>

      <Modal
        open={manageOpen}
        title={translate("profile.mfa.manageDialogTitle", {}, "Manage verification apps")}
        onCancel={() => setManageOpen(false)}
        footer={
          <Button style={{ minHeight: 44 }} onClick={() => setManageOpen(false)}>
            {translate("profile.mfa.close", {}, "Close")}
          </Button>
        }
        width="90%"
        style={{ maxWidth: 640 }}
        destroyOnHidden
      >
        <List
          dataSource={factors}
          locale={{ emptyText: translate("profile.mfa.emptyFactors", {}, "No verification apps found.") }}
          renderItem={(factor, index) => (
            <List.Item
              actions={[
                <Button
                  key="remove"
                  danger
                  style={{ minHeight: 44 }}
                  loading={unenrollingFactorId === factor.id}
                  onClick={() => removeFactor(factor, index)}
                >
                  {translate("profile.mfa.removeAction", {}, "Remove")}
                </Button>,
              ]}
            >
              <List.Item.Meta
                title={getFactorLabel(factor, index, translate)}
                description={
                  <Space wrap size={token.marginXS}>
                    <Tag color={factor.status === VERIFIED_FACTOR_STATUS ? "green" : "gold"}>
                      {factor.status === VERIFIED_FACTOR_STATUS
                        ? translate("profile.mfa.status.verified", {}, "Verified")
                        : translate("profile.mfa.status.unverified", {}, "Unverified")}
                    </Tag>
                    <Typography.Text type="secondary" style={{ wordBreak: "break-all" }}>{factor.id}</Typography.Text>
                  </Space>
                }
              />
            </List.Item>
          )}
        />
      </Modal>
    </>
  );
};

const ProfileForms: React.FC<{ userId: string }> = ({ userId }) => {
  const { translate } = useTranslation();
  const queryClient = useQueryClient();
  const [passwordForm] = Form.useForm();
  const { token } = theme.useToken();
  const { mutate: updatePassword, isPending: isPasswordLoading } = useUpdatePassword();

  const { formProps, saveButtonProps } = useForm({
    action: "edit",
    resource: "profiles",
    id: userId,
    redirect: false,
    mutationMode: "pessimistic",
    invalidates: ["detail"],
    onMutationSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["auth", "identity"] });
    },
  });

  const onPasswordFinish = (values: { password: string; confirmPassword: string }) => {
    if (values.password !== values.confirmPassword) {
      message.error(translate("profile.passwordMismatch"));
      return;
    }
    updatePassword(
      { password: values.password },
      {
        onSuccess: (data) => {
          if (data?.success === false && data?.error) {
            message.error(data.error.message ?? translate("profile.passwordError"));
            return;
          }
          message.success(translate("profile.passwordSuccess"));
          passwordForm.resetFields();
        },
        onError: (error) => {
          message.error(error?.message ?? translate("profile.passwordError"));
        },
      }
    );
  };

  return (
    <Edit
      saveButtonProps={saveButtonProps}
      title={translate("profile.title")}
      breadcrumb={false}
      contentProps={{ style: { display: "flex", flexDirection: "column", gap: token.marginLG } }}
    >
      <Form {...formProps} layout="vertical">
        <Form.Item
          label={translate("profile.fields.fullName")}
          name="full_name"
          rules={[
            { whitespace: true, message: "Nama tidak boleh hanya spasi." },
            { min: 2, message: "Nama harus minimal 2 karakter." },
            { max: 100, message: "Nama maksimal 100 karakter." },
          ]}
        >
          <Input
            placeholder={translate("profile.fields.fullNamePlaceholder")}
            maxLength={100}
            showCount
          />
        </Form.Item>
        <Form.Item label={translate("profile.fields.avatar")} name="avatar_url">
          <AvatarUpload />
        </Form.Item>
      </Form>

      <Divider orientation="left" plain>
        {translate("profile.changePassword")}
      </Divider>

      <Form
        form={passwordForm}
        layout="vertical"
        onFinish={onPasswordFinish}
        requiredMark={false}
        style={{ maxWidth: token.screenXS, width: "100%" }}
      >
        <Form.Item
          label={translate("profile.newPassword")}
          name="password"
          rules={[
            { required: true, message: translate("profile.passwordRequired") },
            { min: 8, message: translate("profile.passwordMinLength") },
          ]}
        >
          <Input.Password
            prefix={<LockOutlined />}
            placeholder={translate("profile.newPasswordPlaceholder")}
            autoComplete="new-password"
          />
        </Form.Item>
        <Form.Item
          label={translate("profile.confirmPassword")}
          name="confirmPassword"
          dependencies={["password"]}
          rules={[
            { required: true, message: translate("profile.confirmRequired") },
            ({ getFieldValue }) => ({
              validator(_rule, value) {
                if (!value || getFieldValue("password") === value) {
                  return Promise.resolve();
                }
                return Promise.reject(new Error(translate("profile.passwordNotMatch")));
              },
            }),
          ]}
        >
          <Input.Password
            prefix={<LockOutlined />}
            placeholder={translate("profile.confirmPasswordPlaceholder")}
            autoComplete="new-password"
          />
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit" loading={isPasswordLoading}>
            {translate("profile.changePassword")}
          </Button>
        </Form.Item>
      </Form>

      <Divider orientation="left" plain>
        {translate("profile.mfa.title", {}, "Two-step verification")}
      </Divider>

      <MfaManagementCard contentMaxWidth={token.screenSM} />
    </Edit>
  );
};

export const Profile: React.FC = () => {
  const identity = useGetIdentity<IdentityUser>();
  const user = identity?.data;

  if (!user?.id) {
    return null;
  }

  return <ProfileForms userId={user.id} />;
};
