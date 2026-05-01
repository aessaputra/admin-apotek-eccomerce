import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Profile } from "..";
import enCommon from "../../../locales/en/common.json";
import idCommon from "../../../locales/id/common.json";

const translations: Record<string, string> = {
  "profile.title": "My Profile",
  "profile.fields.fullName": "Full Name",
  "profile.fields.fullNamePlaceholder": "Enter full name",
  "profile.fields.avatar": "Avatar",
  "profile.changePassword": "Change Password",
  "profile.newPassword": "New Password",
  "profile.confirmPassword": "Confirm Password",
  "profile.newPasswordPlaceholder": "Enter new password",
  "profile.confirmPasswordPlaceholder": "Repeat new password",
  "profile.mfa.title": "Two-step verification",
  "profile.mfa.description": "Use a 6-digit code after signing in with your password.",
  "profile.mfa.enabled": "Enabled",
  "profile.mfa.disabled": "Disabled",
  "profile.mfa.factorSummary": "{{verified}} verified · {{total}} total verification apps",
  "profile.mfa.factorFallback": "Verification app {{index}}",
  "profile.mfa.optionalTitle": "Optional but recommended",
  "profile.mfa.optionalDescription": "Set up verification when you are ready.",
  "profile.mfa.setupAction": "Set up verification",
  "profile.mfa.manageAction": "Manage verification apps",
  "profile.mfa.refreshAction": "Refresh",
  "profile.mfa.setupDialogTitle": "Set up verification",
  "profile.mfa.setupInstructions": "Scan the QR code with a verification app, then enter the 6-digit code it shows.",
  "profile.mfa.enrolling": "Preparing verification setup...",
  "profile.mfa.verifySuccess": "Verification app verified.",
  "profile.mfa.qrAlt": "Verification setup QR code",
  "profile.mfa.manualSecretLabel": "Manual setup key",
  "profile.mfa.manualUriHint": "Use this key only if QR scanning is unavailable.",
  "profile.mfa.codeLabel": "6-digit code",
  "profile.mfa.codePlaceholder": "123456",
  "profile.mfa.verifyAction": "Verify setup",
  "profile.mfa.restartAction": "Restart setup",
  "profile.mfa.cancel": "Cancel setup",
  "profile.mfa.close": "Close",
  "profile.mfa.manageDialogTitle": "Manage verification apps",
  "profile.mfa.emptyFactors": "No verification apps found.",
  "profile.mfa.removeAction": "Remove",
  "profile.mfa.removeConfirmTitle": "Remove verification app?",
  "profile.mfa.removeConfirmContent": "{{name}} will no longer be accepted for sign-in verification.",
  "profile.mfa.removeConfirmOk": "Remove verification app",
  "profile.mfa.aal2Required": "Log out, sign in again, and complete MFA before removing a verification app.",
  "profile.mfa.unenrollSuccess": "Verification app removed.",
  "profile.mfa.status.verified": "Verified",
  "profile.mfa.status.unverified": "Unverified",
};

type Factor = {
  id: string;
  factor_type: string;
  status: string;
  friendly_name?: string;
};

const verifiedTotpFactor = (id: string, friendlyName: string): Factor => ({
  id,
  factor_type: "totp",
  status: "verified",
  friendly_name: friendlyName,
});

const unverifiedTotpFactor = (id: string, friendlyName: string): Factor => ({
  id,
  factor_type: "totp",
  status: "unverified",
  friendly_name: friendlyName,
});

const mocks = vi.hoisted(() => {
  const translate = vi.fn((key: string, paramsOrFallback?: Record<string, unknown> | string, fallback?: string) => {
    const template = translations[key] ?? (typeof paramsOrFallback === "string" ? paramsOrFallback : fallback ?? key);
    const params = typeof paramsOrFallback === "object" && paramsOrFallback !== null ? paramsOrFallback : {};
    return Object.entries(params).reduce(
      (result, [name, value]) => result.replace(`{{${name}}}`, String(value)),
      template,
    );
  });
  const useGetIdentity = vi.fn(() => ({ data: { id: "admin-1" } }));
  const invalidate = vi.fn();
  const updatePassword = vi.fn();
  const useForm = vi.fn(() => ({ formProps: {}, saveButtonProps: {} }));
  const resetFields = vi.fn();
  const formCode = { current: "" };
  const lastOnFinish = { current: undefined as undefined | ((values: { code: string }) => void | Promise<void>) };
  const messageError = vi.fn();
  const messageSuccess = vi.fn();
  const modalConfirm = vi.fn((options: { content?: React.ReactNode; onOk?: () => void | Promise<void> }) => {
    void Promise.resolve(options.onOk?.()).catch(() => undefined);
  });
  const enroll = vi.fn();
  const challenge = vi.fn();
  const verify = vi.fn();
  const listFactors = vi.fn();
  const unenroll = vi.fn();
  const getAuthenticatorAssuranceLevel = vi.fn();
  const refreshSession = vi.fn();

  return {
    translate,
    useGetIdentity,
    invalidate,
    updatePassword,
    useForm,
    resetFields,
    formCode,
    lastOnFinish,
    messageError,
    messageSuccess,
    modalConfirm,
    enroll,
    challenge,
    verify,
    listFactors,
    unenroll,
    getAuthenticatorAssuranceLevel,
    refreshSession,
  };
});

vi.mock("@refinedev/core", () => ({
  useTranslation: () => ({ translate: mocks.translate }),
  useGetIdentity: mocks.useGetIdentity,
  useInvalidate: () => mocks.invalidate,
  useUpdatePassword: () => ({ mutate: mocks.updatePassword, isPending: false }),
}));

vi.mock("@refinedev/antd", () => ({
  Edit: ({ children, title }: { children: React.ReactNode; title?: React.ReactNode }) => <div><h1>{title}</h1>{children}</div>,
  useForm: mocks.useForm,
}));

vi.mock("../../../components/avatar-upload", () => ({
  AvatarUpload: () => <div>AvatarUpload</div>,
}));

vi.mock("../../../providers/supabase-client", () => ({
  supabaseClient: {
    auth: {
      refreshSession: mocks.refreshSession,
      mfa: {
        enroll: mocks.enroll,
        challenge: mocks.challenge,
        verify: mocks.verify,
        listFactors: mocks.listFactors,
        unenroll: mocks.unenroll,
        getAuthenticatorAssuranceLevel: mocks.getAuthenticatorAssuranceLevel,
      },
    },
  },
}));

vi.mock("@ant-design/icons", () => ({
  LockOutlined: () => <span>lock</span>,
}));

vi.mock("antd", () => {
  const FormComponent = ({
    children,
    onFinish,
  }: {
    children: React.ReactNode;
    onFinish?: (values: { code: string }) => void | Promise<void>;
  }) => {
    mocks.lastOnFinish.current = onFinish;
    return <form>{children}</form>;
  };

  const Form = Object.assign(FormComponent, {
    Item: ({
      children,
      label,
      name,
      normalize,
    }: {
      children: React.ReactNode;
      label?: React.ReactNode;
      name?: string;
      normalize?: (value: unknown) => string;
    }) => {
      if (!name || !React.isValidElement(children)) {
        return <label>{label}{children}</label>;
      }

      const childElement = children as React.ReactElement<React.InputHTMLAttributes<HTMLInputElement>>;
      return (
        <label>
          <span>{label}</span>
          {React.cloneElement(childElement, {
            name,
            "aria-label": typeof label === "string" ? label : name,
            onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
              const nextValue = normalize ? normalize(event.currentTarget.value) : event.currentTarget.value;
              event.currentTarget.value = nextValue;
              mocks.formCode.current = nextValue;
            },
          })}
        </label>
      );
    },
    useForm: () => [{
      resetFields: mocks.resetFields,
      submit: () => {
        void Promise.resolve(mocks.lastOnFinish.current?.({ code: mocks.formCode.current })).catch(() => undefined);
      },
    }],
  });

  const InputBase = ({ value, readOnly, ...props }: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input value={value} readOnly={readOnly} {...props} />
  );
  const Input = Object.assign(InputBase, {
    Password: ({ placeholder }: { placeholder?: string }) => <input aria-label={placeholder ?? "password"} type="password" />,
  });

  type MockButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
    htmlType?: "button" | "submit" | "reset";
    loading?: boolean;
    danger?: boolean;
    type?: string;
  };

  const Button = ({
    children,
    htmlType,
    loading,
    type,
    danger,
    ...props
  }: MockButtonProps) => (
    <button
      type={htmlType ?? "button"}
      disabled={props.disabled || loading}
      data-antd-type={type}
      data-danger={danger ? "true" : undefined}
      {...props}
    >
      {children}
    </button>
  );

  const ModalComponent = ({
    children,
    open,
    title,
    footer,
    onCancel,
  }: {
    children: React.ReactNode;
    open?: boolean;
    title?: React.ReactNode;
    footer?: React.ReactNode;
    onCancel?: () => void;
  }) => open ? <div role="dialog"><button type="button" aria-label="modal close" onClick={onCancel}>x</button><div>{title}</div>{children}{footer}</div> : null;
  const Modal = Object.assign(ModalComponent, { confirm: mocks.modalConfirm });

  const ListItem = ({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode[] }) => (
    <div>{children}<div>{actions}</div></div>
  );
  const List = Object.assign(
    ({ dataSource = [], renderItem, locale }: { dataSource?: Factor[]; renderItem: (item: Factor, index: number) => React.ReactNode; locale?: { emptyText?: React.ReactNode } }) => (
      <div>{dataSource.length > 0 ? dataSource.map((item, index) => <div key={item.id}>{renderItem(item, index)}</div>) : locale?.emptyText}</div>
    ),
    {
      Item: Object.assign(ListItem, {
        Meta: ({ title, description }: { title: React.ReactNode; description?: React.ReactNode }) => <div><div>{title}</div>{description}</div>,
      }),
    },
  );

  const Alert = ({ message, description }: { message: React.ReactNode; description?: React.ReactNode }) => (
    <div role="alert"><div>{message}</div>{description && <div>{description}</div>}</div>
  );
  const Space = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;
  const Card = ({ children, loading }: { children: React.ReactNode; loading?: boolean }) => <section>{loading ? <div>Loading</div> : children}</section>;
  const Tag = ({ children }: { children: React.ReactNode }) => <span>{children}</span>;
  const Divider = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;
  const Typography = {
    Title: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
    Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
    Paragraph: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  };
  const theme = {
    useToken: () => ({
      token: {
        marginXXS: 4,
        marginXS: 8,
        marginSM: 12,
        marginMD: 16,
        marginLG: 24,
        paddingSM: 12,
        borderRadius: 6,
        colorBorderSecondary: "#d9d9d9",
        colorFillAlter: "#fafafa",
        screenXS: 480,
        screenSM: 576,
      },
    }),
  };

  return {
    Alert,
    Button,
    Card,
    Divider,
    Form,
    Input,
    List,
    Modal,
    Space,
    Tag,
    Typography,
    message: { error: mocks.messageError, success: mocks.messageSuccess },
    theme,
  };
});

function arrangeProfileMfa({
  initialFactors = [],
  refreshedFactors = initialFactors,
  currentLevel = "aal2",
  enrollmentFactorId = "totp-new",
}: {
  initialFactors?: Factor[];
  refreshedFactors?: Factor[];
  currentLevel?: string;
  enrollmentFactorId?: string;
} = {}) {
  mocks.enroll.mockReset();
  mocks.challenge.mockReset();
  mocks.verify.mockReset();
  mocks.listFactors.mockReset();
  mocks.unenroll.mockReset();
  mocks.getAuthenticatorAssuranceLevel.mockReset();
  mocks.refreshSession.mockReset();

  mocks.listFactors
    .mockResolvedValueOnce({ data: { all: initialFactors }, error: null })
    .mockResolvedValue({ data: { all: refreshedFactors }, error: null });
  mocks.enroll.mockResolvedValue({
    data: {
      id: enrollmentFactorId,
      totp: {
        qr_code: "<svg>setup-qr</svg>",
        secret: `SECRET-${enrollmentFactorId}`,
        uri: "otpauth://totp/example",
      },
    },
    error: null,
  });
  mocks.challenge.mockResolvedValue({ data: { id: "challenge-1" }, error: null });
  mocks.verify.mockResolvedValue({ data: {}, error: null });
  mocks.unenroll.mockResolvedValue({ data: { id: "removed" }, error: null });
  mocks.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel, nextLevel: "aal2" }, error: null });
  mocks.refreshSession.mockResolvedValue({ data: {}, error: null });
}

type EnrollResult = {
  data: {
    id: string;
    totp: {
      qr_code: string;
      secret: string;
      uri: string;
    };
  };
  error: null;
};

function createPendingEnrollment(enrollmentFactorId = "totp-new") {
  let resolveEnrollment: (value: EnrollResult) => void = () => undefined;
  const promise = new Promise<EnrollResult>((resolve) => {
    resolveEnrollment = resolve;
  });

  return {
    promise,
    resolve: () => resolveEnrollment({
      data: {
        id: enrollmentFactorId,
        totp: {
          qr_code: "<svg>setup-qr</svg>",
          secret: `SECRET-${enrollmentFactorId}`,
          uri: "otpauth://totp/example",
        },
      },
      error: null,
    }),
  };
}

function collectLocaleStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];

  return Object.values(value).flatMap(collectLocaleStrings);
}

async function openSetupDialog(buttonName = "Set up verification") {
  fireEvent.click(await screen.findByRole("button", { name: buttonName }));
  await screen.findByRole("dialog");
  await screen.findByDisplayValue(/SECRET-/);
}

async function submitSetupCode(code = "123456") {
  fireEvent.change(screen.getByLabelText("6-digit code"), { target: { value: code } });
  fireEvent.click(screen.getByRole("button", { name: "Verify setup" }));
}

describe("Profile MFA management", () => {
  beforeEach(() => {
    mocks.translate.mockClear();
    mocks.useGetIdentity.mockClear();
    mocks.invalidate.mockReset();
    mocks.updatePassword.mockReset();
    mocks.useForm.mockClear();
    mocks.resetFields.mockReset();
    mocks.formCode.current = "";
    mocks.lastOnFinish.current = undefined;
    mocks.messageError.mockReset();
    mocks.messageSuccess.mockReset();
    mocks.modalConfirm.mockClear();
    mocks.enroll.mockReset();
    mocks.challenge.mockReset();
    mocks.verify.mockReset();
    mocks.listFactors.mockReset();
    mocks.unenroll.mockReset();
    mocks.getAuthenticatorAssuranceLevel.mockReset();
    mocks.refreshSession.mockReset();
    arrangeProfileMfa();
  });

  it("enrolls a first TOTP factor from a dialog and refreshes the factor list", async () => {
    arrangeProfileMfa({
      initialFactors: [],
      refreshedFactors: [verifiedTotpFactor("totp-primary", "Main Authenticator")],
    });

    render(<Profile />);

    await screen.findByText("Disabled");
    expect(screen.getAllByText("Two-step verification").length).toBeGreaterThan(0);
    expect(screen.getByText("Use a 6-digit code after signing in with your password.")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Set up verification" })).not.toBeNull();
    expect(screen.queryByText(/backup|cadangan/i)).toBeNull();
    expect(screen.queryByDisplayValue("SECRET-totp-new")).toBeNull();

    await openSetupDialog();
    await submitSetupCode("123456");

    await waitFor(() => expect(mocks.challenge).toHaveBeenCalledWith({ factorId: "totp-new" }));
    expect(mocks.verify).toHaveBeenCalledWith({ factorId: "totp-new", challengeId: "challenge-1", code: "123456" });
    expect(mocks.refreshSession).toHaveBeenCalledTimes(1);
    expect(mocks.listFactors).toHaveBeenCalledTimes(2);
    expect(mocks.messageSuccess).toHaveBeenCalledWith("Verification app verified.");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("hides setup actions when one verified factor already exists", async () => {
    arrangeProfileMfa({
      initialFactors: [verifiedTotpFactor("totp-primary", "Main Authenticator")],
      refreshedFactors: [verifiedTotpFactor("totp-primary", "Main Authenticator"), verifiedTotpFactor("totp-secondary", "Secondary Authenticator")],
      enrollmentFactorId: "totp-secondary",
    });

    render(<Profile />);

    await screen.findByText("Enabled");
    expect(screen.getByText("1 verified · 1 total verification apps")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Manage verification apps" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Refresh" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Set up verification" })).toBeNull();
    expect(screen.queryByRole("button", { name: /add|backup|cadangan/i })).toBeNull();
    expect(screen.queryByText(/backup|cadangan/i)).toBeNull();
    expect(mocks.enroll).not.toHaveBeenCalled();
  });

  it("keeps setup QR and manual secret out of the profile page until the setup dialog opens", async () => {
    render(<Profile />);

    await screen.findByText("Disabled");
    expect(screen.queryByAltText("Verification setup QR code")).toBeNull();
    expect(screen.queryByDisplayValue("SECRET-totp-new")).toBeNull();

    await openSetupDialog();

    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("Set up verification");
    expect(screen.getByAltText("Verification setup QR code")).not.toBeNull();
    expect(screen.getByDisplayValue("SECRET-totp-new")).not.toBeNull();
  });

  it("prevents cancel, modal close, and restart while enroll is still pending", async () => {
    const pendingEnrollment = createPendingEnrollment("totp-race");
    mocks.enroll.mockReturnValueOnce(pendingEnrollment.promise);

    render(<Profile />);

    fireEvent.click(await screen.findByRole("button", { name: "Set up verification" }));

    await screen.findByText("Preparing verification setup...");
    const cancelButton = screen.getByRole("button", { name: "Cancel setup" }) as HTMLButtonElement;
    const restartButton = screen.getByRole("button", { name: "Restart setup" }) as HTMLButtonElement;

    expect(cancelButton.disabled).toBe(true);
    expect(restartButton.disabled).toBe(true);

    fireEvent.click(cancelButton);
    fireEvent.click(restartButton);
    fireEvent.click(screen.getByRole("button", { name: "modal close" }));

    expect(screen.getByRole("dialog")).not.toBeNull();
    expect(mocks.enroll).toHaveBeenCalledTimes(1);
    expect(mocks.unenroll).not.toHaveBeenCalled();

    pendingEnrollment.resolve();

    await screen.findByDisplayValue("SECRET-totp-race");
    await waitFor(() => expect((screen.getByRole("button", { name: "Cancel setup" }) as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(screen.getByRole("button", { name: "Cancel setup" }));

    await waitFor(() => expect(mocks.unenroll).toHaveBeenCalledWith({ factorId: "totp-race" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes safely without unenroll when enrollment fails before a factor ID exists", async () => {
    mocks.enroll.mockResolvedValueOnce({ data: null, error: new Error("enroll failed") });

    render(<Profile />);

    fireEvent.click(await screen.findByRole("button", { name: "Set up verification" }));

    await screen.findByText("We could not start verification setup. Please try again.");
    fireEvent.click(screen.getByRole("button", { name: "Cancel setup" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.unenroll).not.toHaveBeenCalled();
  });

  it("unenrolls the newly created unverified factor when setup is cancelled", async () => {
    render(<Profile />);

    await openSetupDialog();
    fireEvent.click(screen.getByRole("button", { name: "Cancel setup" }));

    await waitFor(() => expect(mocks.unenroll).toHaveBeenCalledWith({ factorId: "totp-new" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("lists all TOTP factors with neutral status inside the manage dialog", async () => {
    arrangeProfileMfa({
      initialFactors: [
        verifiedTotpFactor("totp-primary", "Main Authenticator"),
        verifiedTotpFactor("totp-secondary", "Secondary Authenticator"),
        unverifiedTotpFactor("totp-draft", "Setup in progress"),
        { id: "phone-1", factor_type: "phone", status: "verified", friendly_name: "Phone" },
      ],
    });

    render(<Profile />);

    fireEvent.click(await screen.findByRole("button", { name: "Manage verification apps" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("Manage verification apps");
    expect(dialog.textContent).toContain("Main Authenticator");
    expect(dialog.textContent).toContain("Secondary Authenticator");
    expect(dialog.textContent).toContain("Setup in progress");
    expect(dialog.textContent).toContain("Verified");
    expect(dialog.textContent).toContain("Unverified");
    expect(dialog.textContent).not.toContain("Phone");
  });

  it("confirms and unenrolls a factor when the session is already AAL2", async () => {
    arrangeProfileMfa({
      initialFactors: [verifiedTotpFactor("totp-primary", "Main Authenticator")],
      refreshedFactors: [],
      currentLevel: "aal2",
    });

    render(<Profile />);

    fireEvent.click(await screen.findByRole("button", { name: "Manage verification apps" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(mocks.modalConfirm).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.getAuthenticatorAssuranceLevel).toHaveBeenCalledTimes(1));
    expect(mocks.unenroll).toHaveBeenCalledWith({ factorId: "totp-primary" });
    expect(mocks.refreshSession).toHaveBeenCalledTimes(1);
    expect(mocks.messageSuccess).toHaveBeenCalledWith("Verification app removed.");
  });

  it("removes one selected app when multiple verified TOTP factors already exist", async () => {
    arrangeProfileMfa({
      initialFactors: [
        verifiedTotpFactor("totp-primary", "Main Authenticator"),
        verifiedTotpFactor("totp-secondary", "Secondary Authenticator"),
      ],
      refreshedFactors: [verifiedTotpFactor("totp-primary", "Main Authenticator")],
      currentLevel: "aal2",
    });

    render(<Profile />);

    fireEvent.click(await screen.findByRole("button", { name: "Manage verification apps" }));
    const removeButtons = screen.getAllByRole("button", { name: "Remove" });
    fireEvent.click(removeButtons[1]);

    await waitFor(() => expect(mocks.modalConfirm).toHaveBeenCalledTimes(1));
    expect(mocks.modalConfirm.mock.calls[0][0].content).toContain("Secondary Authenticator");
    await waitFor(() => expect(mocks.unenroll).toHaveBeenCalledWith({ factorId: "totp-secondary" }));
    expect(mocks.refreshSession).toHaveBeenCalledTimes(1);
  });

  it("blocks unenroll with localized guidance when the current session is not AAL2", async () => {
    arrangeProfileMfa({
      initialFactors: [verifiedTotpFactor("totp-primary", "Main Authenticator")],
      currentLevel: "aal1",
    });

    render(<Profile />);

    fireEvent.click(await screen.findByRole("button", { name: "Manage verification apps" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(mocks.getAuthenticatorAssuranceLevel).toHaveBeenCalledTimes(1));
    expect(mocks.messageError).toHaveBeenCalledWith("Log out, sign in again, and complete MFA before removing a verification app.");
    expect(mocks.unenroll).not.toHaveBeenCalled();
  });

  it("keeps profile MFA locale copy free of backup and cadangan terminology", () => {
    const englishMfaCopy = collectLocaleStrings(enCommon.profile.mfa).join(" ");
    const indonesianMfaCopy = collectLocaleStrings(idCommon.profile.mfa).join(" ");

    expect(englishMfaCopy).not.toMatch(/\bbackup\b/i);
    expect(indonesianMfaCopy).not.toMatch(/cadangan/i);
  });
});
