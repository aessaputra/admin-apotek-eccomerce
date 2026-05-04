import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Login } from "../login";
import { MFA_VERIFY_ROUTE } from "../../../utils/mfa";

const mocks = vi.hoisted(() => {
  const navigate = vi.fn();
  const login = vi.fn();

  return { navigate, login };
});

vi.mock("react-router", () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
  useNavigate: () => mocks.navigate,
  useSearchParams: () => [new URLSearchParams("to=%2Fproducts")],
}));

vi.mock("@refinedev/core", () => ({
  useTranslation: () => ({
    translate: (key: string, _options?: Record<string, unknown>, fallback?: string) => {
      const indonesian: Record<string, string> = {
        "auth.email": "Email",
        "auth.password": "Kata Sandi",
        "auth.login.submit": "Masuk",
        "auth.login.forgotPassword": "Lupa kata sandi?",
        "auth.loginFailed": "Login gagal",
      };
      return indonesian[key] ?? fallback ?? key;
    },
  }),
}));

vi.mock("../../../components/layout/auth-title", () => ({
  AuthTitle: () => <div>Pharmacy Admin</div>,
}));

vi.mock("../../../providers/auth", () => ({
  default: {
    login: mocks.login,
  },
}));

describe("Login", () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
    mocks.login.mockReset();
  });

  it("forces MFA redirect to win over the Refine return-to query", async () => {
    mocks.login.mockResolvedValue({ success: true, redirectTo: MFA_VERIFY_ROUTE });

    render(<Login />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "admin@example.com" } });
    fireEvent.change(screen.getByLabelText("Kata Sandi"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Masuk" }));

    await waitFor(() => expect(mocks.login).toHaveBeenCalledWith({ email: "admin@example.com", password: "secret", to: "/products" }));
    expect(mocks.navigate).toHaveBeenCalledWith(MFA_VERIFY_ROUTE, { replace: true });
    expect(mocks.navigate).not.toHaveBeenCalledWith("/products", { replace: true });
  });

  it("honors the return-to query when MFA is not required", async () => {
    mocks.login.mockResolvedValue({ success: true, redirectTo: "/" });

    render(<Login />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "admin@example.com" } });
    fireEvent.change(screen.getByLabelText("Kata Sandi"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Masuk" }));

    await waitFor(() => expect(mocks.login).toHaveBeenCalledWith({ email: "admin@example.com", password: "secret", to: "/products" }));
    expect(mocks.navigate).toHaveBeenCalledWith("/products", { replace: true });
  });

  it("links to the forgot password route", () => {
    render(<Login />);

    expect(screen.getByRole("link", { name: "Lupa kata sandi?" }).getAttribute("href")).toBe("/forgot-password");
  });
});
