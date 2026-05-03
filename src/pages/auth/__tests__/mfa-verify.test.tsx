import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearAllPendingMfaState, setPendingMfaState } from "../../../utils/mfa";
import { MfaVerify } from "../mfa-verify";

const translations: Record<string, string> = {
  "auth.mfa.title": "Verify your sign-in",
  "auth.mfa.description": "Enter the verification code from your authenticator app to continue.",
  "auth.mfa.primaryAction": "Verify",
  "auth.mfa.secondaryAction": "Back to login",
  "auth.mfa.retryAction": "Retry",
  "auth.mfa.loadError": "We could not load your verification methods. Please try again.",
  "auth.mfa.challengeError": "We could not start verification. Please try again.",
  "auth.mfa.invalidCode": "The verification code could not be confirmed. Check the code and try again.",
  "auth.mfa.refreshError": "We could not finish verification. Please try again.",
  "auth.mfa.noFactorsTitle": "No verified authenticator app found",
  "auth.mfa.noFactorsDescription": "No verified authenticator app is available. Sign in again or contact another administrator for recovery.",
  "auth.mfa.factorLabel": "Authenticator app",
  "auth.mfa.factorFallback": "Authenticator app {{index}}",
  "auth.mfa.codeLabel": "6-digit code",
  "auth.mfa.codePlaceholder": "123456",
  "auth.mfa.codeRequired": "Enter your 6-digit code.",
  "auth.mfa.codeInvalid": "Enter exactly 6 digits.",
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

const mocks = vi.hoisted(() => {
  const navigate = vi.fn();
  const translate = vi.fn((key: string, paramsOrFallback?: Record<string, unknown> | string, fallback?: string) => {
    const template = translations[key] ?? (typeof fallback === "string" ? fallback : key);
    const params = typeof paramsOrFallback === "object" && paramsOrFallback !== null ? paramsOrFallback : {};
    return Object.entries(params).reduce(
      (result, [name, value]) => result.replace(`{{${name}}}`, String(value)),
      template,
    );
  });
  const getUser = vi.fn();
  const getAuthenticatorAssuranceLevel = vi.fn();
  const listFactors = vi.fn();
  const challenge = vi.fn();
  const verify = vi.fn();
  const refreshSession = vi.fn();
  const signOut = vi.fn();

  return {
    navigate,
    translate,
    getUser,
    getAuthenticatorAssuranceLevel,
    listFactors,
    challenge,
    verify,
    refreshSession,
    signOut,
  };
});

vi.mock("react-router", () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock("@refinedev/core", () => ({
  useTranslation: () => ({ translate: mocks.translate }),
}));

vi.mock("../../../components/layout/auth-title", () => ({
  AuthTitle: () => <div>Pharmacy Admin</div>,
}));

vi.mock("../../../providers/supabase-client", () => ({
  supabaseClient: {
    auth: {
      getUser: mocks.getUser,
      refreshSession: mocks.refreshSession,
      signOut: mocks.signOut,
      mfa: {
        getAuthenticatorAssuranceLevel: mocks.getAuthenticatorAssuranceLevel,
        listFactors: mocks.listFactors,
        challenge: mocks.challenge,
        verify: mocks.verify,
      },
    },
  },
}));

vi.mock("antd", () => {
  const FormComponent = ({
    children,
    onFinish,
  }: {
    children: React.ReactNode;
    onFinish?: (values: { code: string }) => void | Promise<void>;
  }) => (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        await Promise.resolve(onFinish?.({ code: String(formData.get("code") ?? "") })).catch(() => undefined);
      }}
    >
      {children}
    </form>
  );

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
              if (normalize) {
                event.currentTarget.value = normalize(event.currentTarget.value);
              }
            },
          })}
        </label>
      );
    },
    useForm: () => [{}],
  });

  const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />;

  const Select = ({
    options,
    value,
    onChange,
    "aria-label": ariaLabel,
  }: {
    options: Array<{ label: string; value: string }>;
    value?: string;
    onChange?: (value: string) => void;
    "aria-label"?: string;
  }) => (
    <select aria-label={ariaLabel} value={value} onChange={(event) => onChange?.(event.currentTarget.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );

  const Button = ({
    children,
    htmlType,
    loading,
    type: _antdType,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { htmlType?: "button" | "submit" | "reset"; loading?: boolean }) => (
    <button type={htmlType ?? "button"} disabled={props.disabled || loading} {...props}>
      {children}
    </button>
  );

  const Alert = ({
    message,
    description,
    action,
  }: {
    message: React.ReactNode;
    description?: React.ReactNode;
    action?: React.ReactNode;
  }) => (
    <div role="alert">
      <div>{message}</div>
      {description && <div>{description}</div>}
      {action}
    </div>
  );

  const Space = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;
  const Card = ({ children, loading }: { children: React.ReactNode; loading?: boolean }) => (
    <section>{loading ? <div>Loading</div> : children}</section>
  );
  const Typography = {
    Title: ({ children }: { children: React.ReactNode }) => <h1>{children}</h1>,
    Paragraph: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  };
  const theme = {
    useToken: () => ({
      token: {
        paddingLG: 24,
        marginLG: 24,
        marginXS: 8,
        screenXS: 480,
      },
    }),
  };

  return { Alert, Button, Card, Form, Input, Select, Space, Typography, theme };
});

function arrangeMfaSession({
  factors = [verifiedTotpFactor("totp-primary", "Main Authenticator")],
  currentLevel = "aal1",
  nextLevel = "aal2",
  returnTo,
}: {
  factors?: Factor[];
  currentLevel?: string;
  nextLevel?: string;
  returnTo?: string;
} = {}) {
  mocks.getUser.mockResolvedValue({ data: { user: { id: "admin-1", email: "admin@example.com" } }, error: null });
  mocks.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel, nextLevel }, error: null });
  mocks.listFactors.mockResolvedValue({ data: { all: factors }, error: null });
  mocks.challenge.mockResolvedValue({ data: { id: "challenge-1" }, error: null });
  mocks.verify.mockResolvedValue({ data: {}, error: null });
  mocks.refreshSession.mockResolvedValue({ data: {}, error: null });
  mocks.signOut.mockResolvedValue({ error: null });
  setPendingMfaState({ userId: "admin-1", email: "admin@example.com", returnTo });
}

async function enterCodeAndSubmit(code = "123456") {
  fireEvent.change(await screen.findByLabelText("6-digit code"), { target: { value: code } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
  });
}

describe("MfaVerify", () => {
  beforeEach(() => {
    clearAllPendingMfaState();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.navigate.mockReset();
    mocks.translate.mockClear();
    mocks.getUser.mockReset();
    mocks.getAuthenticatorAssuranceLevel.mockReset();
    mocks.listFactors.mockReset();
    mocks.challenge.mockReset();
    mocks.verify.mockReset();
    mocks.refreshSession.mockReset();
    mocks.signOut.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("verifies a single verified TOTP factor, clears pending MFA state, and navigates to the stored return destination", async () => {
    arrangeMfaSession({
      factors: [
        verifiedTotpFactor("totp-primary", "Main Authenticator"),
        { id: "totp-draft", factor_type: "totp", status: "unverified", friendly_name: "Draft" },
        { id: "phone-verified", factor_type: "phone", status: "verified", friendly_name: "Phone" },
        { id: "webauthn-verified", factor_type: "webauthn", status: "verified", friendly_name: "Security key" },
      ],
      returnTo: "/products",
    });

    render(<MfaVerify />);

    await screen.findByText("Verify your sign-in");
    await enterCodeAndSubmit("123456");

    await waitFor(() => expect(mocks.challenge).toHaveBeenCalledWith({ factorId: "totp-primary" }));
    expect(mocks.verify).toHaveBeenCalledWith({ factorId: "totp-primary", challengeId: "challenge-1", code: "123456" });
    expect(mocks.refreshSession).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem("mfa:pending-login:admin-1")).toBeNull();
    expect(mocks.navigate).toHaveBeenCalledWith("/products", { replace: true });
  });

  it("defaults successful MFA navigation home when no safe return destination exists", async () => {
    arrangeMfaSession();

    render(<MfaVerify />);

    await enterCodeAndSubmit("123456");

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("/", { replace: true }));
    expect(sessionStorage.getItem("mfa:pending-login:admin-1")).toBeNull();
  });

  it("keeps the admin on MFA verification with localized generic copy when the code is invalid", async () => {
    arrangeMfaSession();
    mocks.verify.mockResolvedValue({ data: null, error: new Error("invalid token from supabase") });

    render(<MfaVerify />);

    await enterCodeAndSubmit("654321");

    expect((await screen.findByRole("alert")).textContent).toContain("The verification code could not be confirmed. Check the code and try again.");
    expect(screen.queryByText("invalid token from supabase")).toBeNull();
    expect(mocks.navigate).not.toHaveBeenCalledWith("/", { replace: true });
    expect(sessionStorage.getItem("mfa:pending-login:admin-1")).not.toBeNull();
  });

  it("shows retry and back actions when AAL status loading fails, then recovers without reloading", async () => {
    arrangeMfaSession();
    mocks.getAuthenticatorAssuranceLevel
      .mockResolvedValueOnce({ data: null, error: new Error("aal fetch failed") })
      .mockResolvedValueOnce({ data: { currentLevel: "aal1", nextLevel: "aal2" }, error: null });

    render(<MfaVerify />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("We could not load your verification methods. Please try again.");
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(within(alert).getByRole("button", { name: "Back to login" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(mocks.getAuthenticatorAssuranceLevel).toHaveBeenCalledTimes(2));
    await screen.findByLabelText("6-digit code");
  });

  it("shows retry and back actions when factor loading fails, then recovers without reloading", async () => {
    arrangeMfaSession();
    mocks.listFactors
      .mockResolvedValueOnce({ data: null, error: new Error("factor fetch failed") })
      .mockResolvedValueOnce({ data: { all: [verifiedTotpFactor("totp-primary", "Main Authenticator")] }, error: null });

    render(<MfaVerify />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("We could not load your verification methods. Please try again.");
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(mocks.listFactors).toHaveBeenCalledTimes(2));
    await screen.findByLabelText("6-digit code");
  });

  it("keeps the admin on MFA verification when the challenge call fails", async () => {
    arrangeMfaSession();
    mocks.challenge.mockResolvedValue({ data: null, error: new Error("challenge unavailable") });

    render(<MfaVerify />);

    await enterCodeAndSubmit("246810");

    expect((await screen.findByRole("alert")).textContent).toContain("We could not start verification. Please try again.");
    expect(screen.queryByText("challenge unavailable")).toBeNull();
    expect(mocks.navigate).not.toHaveBeenCalledWith("/", { replace: true });
    expect(sessionStorage.getItem("mfa:pending-login:admin-1")).not.toBeNull();
  });

  it("keeps pending MFA state and stays on the page when refreshSession fails after verify", async () => {
    arrangeMfaSession();
    mocks.refreshSession.mockResolvedValue({ data: null, error: new Error("refresh failed") });

    render(<MfaVerify />);

    await enterCodeAndSubmit("123456");

    expect((await screen.findByRole("alert")).textContent).toContain("We could not finish verification. Please try again.");
    expect(screen.queryByText("refresh failed")).toBeNull();
    expect(mocks.verify).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).not.toHaveBeenCalledWith("/", { replace: true });
    expect(sessionStorage.getItem("mfa:pending-login:admin-1")).not.toBeNull();
  });

  it("shows safe recovery copy and signs out when no verified TOTP factors are available", async () => {
    arrangeMfaSession({
      factors: [
        { id: "totp-draft", factor_type: "totp", status: "unverified", friendly_name: "Draft" },
        { id: "phone-verified", factor_type: "phone", status: "verified", friendly_name: "Phone" },
      ],
    });

    render(<MfaVerify />);

    expect((await screen.findByRole("alert")).textContent).toContain("No verified authenticator app is available. Sign in again or contact another administrator for recovery.");
    expect(mocks.challenge).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Back to login" }));

    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledTimes(1));
    expect(sessionStorage.getItem("mfa:pending-login:admin-1")).toBeNull();
    expect(mocks.navigate).toHaveBeenCalledWith("/login", { replace: true });
  });

  it("redirects to login and does not query MFA APIs when there is no session", async () => {
    setPendingMfaState({ userId: "admin-1", email: "admin@example.com", createdAt: "2026-05-01T00:00:00.000Z" });
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    render(<MfaVerify />);

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("/login", { replace: true }));
    expect(mocks.getAuthenticatorAssuranceLevel).not.toHaveBeenCalled();
    expect(mocks.listFactors).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
  });

  it.each([
    { currentLevel: "aal2", nextLevel: "aal2" },
    { currentLevel: "aal1", nextLevel: "aal1" },
  ])("clears pending state and redirects home when MFA is already satisfied or unnecessary", async ({ currentLevel, nextLevel }) => {
    arrangeMfaSession({ currentLevel, nextLevel });

    render(<MfaVerify />);

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("/", { replace: true }));
    expect(mocks.listFactors).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("mfa:pending-login:admin-1")).toBeNull();
  });

  it("lets admins select among multiple verified TOTP factors and never challenges non-TOTP factors", async () => {
    arrangeMfaSession({
      factors: [
        verifiedTotpFactor("totp-primary", "Main Authenticator"),
        verifiedTotpFactor("totp-secondary", "Secondary Authenticator"),
        { id: "phone-verified", factor_type: "phone", status: "verified", friendly_name: "Phone" },
        { id: "webauthn-verified", factor_type: "webauthn", status: "verified", friendly_name: "Security key" },
      ],
    });

    render(<MfaVerify />);

    fireEvent.change(await screen.findByLabelText("Authenticator app"), { target: { value: "totp-secondary" } });
    expect(screen.getByText("Main Authenticator")).not.toBeNull();
    expect(screen.getByText("Secondary Authenticator")).not.toBeNull();
    expect(screen.queryByText("Phone")).toBeNull();
    expect(screen.queryByText("Security key")).toBeNull();

    await enterCodeAndSubmit("222333");

    await waitFor(() => expect(mocks.challenge).toHaveBeenCalledWith({ factorId: "totp-secondary" }));
    expect(mocks.challenge).not.toHaveBeenCalledWith({ factorId: "phone-verified" });
    expect(mocks.challenge).not.toHaveBeenCalledWith({ factorId: "webauthn-verified" });
  });
});
