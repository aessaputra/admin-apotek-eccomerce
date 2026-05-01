import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MFA_VERIFY_ROUTE, setPendingMfaState } from "../../utils/mfa";

const translations: Record<string, string> = {
  "auth.accessDenied": "Akses ditolak. Hanya admin yang dapat login ke panel ini.",
  "auth.oauthNotAllowed": "Panel admin hanya mendukung login dengan email dan password.",
  "auth.registerDisabled": "Registrasi tidak tersedia. Hubungi administrator.",
  "auth.checkFailed": "Akses ditolak. Hanya admin yang dapat mengakses panel ini.",
};

type ProfileRoleResult = { data: { role?: string | null } | null; error: unknown };
type ProfileIdentityResult = {
  data: { full_name?: string | null; avatar_url?: string | null } | null;
  error: unknown;
};

type AssuranceLevelResult = {
  data: {
    currentLevel?: string | null;
    nextLevel?: string | null;
  } | null;
  error: unknown;
};

const mocks = vi.hoisted(() => {
  let profileRoleResult: ProfileRoleResult = {
    data: { role: "admin" },
    error: null,
  };

  let profileIdentityResult: ProfileIdentityResult = {
    data: { full_name: "Admin User", avatar_url: "https://example.com/avatar.png" },
    error: null,
  };

  let assuranceLevelResult: AssuranceLevelResult = {
    data: { currentLevel: "aal1", nextLevel: "aal1" },
    error: null,
  };

  const signInWithPassword = vi.fn();
  const signOut = vi.fn();
  const getUser = vi.fn();
  const resetPasswordForEmail = vi.fn();
  const updateUser = vi.fn();
  const getAuthenticatorAssuranceLevel = vi.fn();
  const from = vi.fn((table: string) => ({
    select: vi.fn((columns: string) => ({
      eq: vi.fn(() => ({
        single: vi.fn(async () => {
          if (table !== "profiles") {
            throw new Error(`Unexpected table: ${table}`);
          }

          if (columns === "role") {
            return profileRoleResult;
          }

          if (columns === "full_name, avatar_url") {
            return profileIdentityResult;
          }

          throw new Error(`Unexpected select columns: ${columns}`);
        }),
      })),
    })),
  }));

  getAuthenticatorAssuranceLevel.mockImplementation(async () => assuranceLevelResult);

  return {
    get profileRoleResult() {
      return profileRoleResult;
    },
    set profileRoleResult(value: ProfileRoleResult) {
      profileRoleResult = value;
    },
    get profileIdentityResult() {
      return profileIdentityResult;
    },
    set profileIdentityResult(value: ProfileIdentityResult) {
      profileIdentityResult = value;
    },
    get assuranceLevelResult() {
      return assuranceLevelResult;
    },
    set assuranceLevelResult(value: AssuranceLevelResult) {
      assuranceLevelResult = value;
    },
    signInWithPassword,
    signOut,
    getUser,
    resetPasswordForEmail,
    updateUser,
    getAuthenticatorAssuranceLevel,
    from,
  };
});

vi.mock("../../i18n", () => ({
  default: {
    t: vi.fn((key: string) => translations[key] ?? key),
  },
}));

vi.mock("../supabase-client", () => ({
  supabaseClient: {
    auth: {
      signInWithPassword: mocks.signInWithPassword,
      signOut: mocks.signOut,
      getUser: mocks.getUser,
      resetPasswordForEmail: mocks.resetPasswordForEmail,
      updateUser: mocks.updateUser,
      mfa: {
        getAuthenticatorAssuranceLevel: mocks.getAuthenticatorAssuranceLevel,
      },
    },
    from: mocks.from,
  },
}));

import authProvider from "../auth";

describe("authProvider", () => {
  const PENDING_MFA_TTL_MS = 10 * 60 * 1000;

  beforeEach(() => {
    mocks.profileRoleResult = {
      data: { role: "admin" },
      error: null,
    };
    mocks.profileIdentityResult = {
      data: { full_name: "Admin User", avatar_url: "https://example.com/avatar.png" },
      error: null,
    };
    mocks.assuranceLevelResult = {
      data: { currentLevel: "aal1", nextLevel: "aal1" },
      error: null,
    };

    mocks.signInWithPassword.mockReset();
    mocks.signOut.mockReset();
    mocks.getUser.mockReset();
    mocks.resetPasswordForEmail.mockReset();
    mocks.updateUser.mockReset();
    mocks.getAuthenticatorAssuranceLevel.mockReset();
    mocks.getAuthenticatorAssuranceLevel.mockImplementation(async () => mocks.assuranceLevelResult);
    mocks.from.mockClear();
    sessionStorage.clear();
    window.history.pushState({}, "", "/");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects OAuth logins for the admin panel", async () => {
    const result = await authProvider.login({
      providerName: "google",
      email: "admin@example.com",
      password: "secret",
    });

    expect(result).toEqual({
      success: false,
      error: {
        message: translations["auth.oauthNotAllowed"],
        name: "OAuth not allowed",
      },
    });
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });

  it("signs non-admin users out after a successful password login", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    });
    mocks.signOut.mockResolvedValue({ error: null });
    mocks.profileRoleResult = {
      data: { role: "user" },
      error: null,
    };

    const result = await authProvider.login({
      email: "user@example.com",
      password: "secret",
    });

    expect(mocks.signOut).toHaveBeenCalledTimes(1);
    expect(mocks.getAuthenticatorAssuranceLevel).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: false,
      error: {
        message: translations["auth.accessDenied"],
        name: "Unauthorized",
      },
    });
  });

  it("allows admins to log in without MFA and clears stale pending state", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: { id: "admin-1" } },
      error: null,
    });
    setPendingMfaState({ userId: "admin-1", email: "admin@example.com", createdAt: "2026-05-01T00:00:00.000Z" });
    mocks.assuranceLevelResult = {
      data: { currentLevel: "aal1", nextLevel: "aal1" },
      error: null,
    };

    const result = await authProvider.login({
      email: "admin@example.com",
      password: "secret",
    });

    expect(result).toEqual({ success: true, redirectTo: "/" });
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("mfa:pending-login:admin-1")).toBeNull();
  });

  it("keeps the MFA verify redirect when the return-to URL points to products", async () => {
    window.history.pushState({}, "", "/login?to=%2Fproducts");
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: { id: "admin-1", email: "admin@example.com" } },
      error: null,
    });
    mocks.assuranceLevelResult = {
      data: { currentLevel: "aal1", nextLevel: "aal2" },
      error: null,
    };

    const result = await authProvider.login({
      email: "admin@example.com",
      password: "secret",
      to: "/products",
    });

    expect(result).toEqual({ success: true, redirectTo: MFA_VERIFY_ROUTE });
    expect(JSON.parse(sessionStorage.getItem("mfa:pending-login:admin-1") ?? "null")).toMatchObject({
      userId: "admin-1",
      email: "admin@example.com",
      returnTo: "/products",
    });
  });

  it("does not persist unsafe return-to URLs for MFA-required logins", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: { id: "admin-unsafe", email: "admin@example.com" } },
      error: null,
    });
    mocks.assuranceLevelResult = {
      data: { currentLevel: "aal1", nextLevel: "aal2" },
      error: null,
    };

    const result = await authProvider.login({
      email: "admin@example.com",
      password: "secret",
      to: "https://evil.example/products",
    });

    expect(result).toEqual({ success: true, redirectTo: MFA_VERIFY_ROUTE });
    expect(JSON.parse(sessionStorage.getItem("mfa:pending-login:admin-unsafe") ?? "null")).toEqual(expect.not.objectContaining({
      returnTo: expect.any(String),
    }));
  });

  it("keeps the normal redirect when the return-to URL points to products and MFA is not required", async () => {
    window.history.pushState({}, "", "/login?to=%2Fproducts");
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: { id: "admin-1", email: "admin@example.com" } },
      error: null,
    });
    mocks.assuranceLevelResult = {
      data: { currentLevel: "aal1", nextLevel: "aal1" },
      error: null,
    };

    const result = await authProvider.login({
      email: "admin@example.com",
      password: "secret",
    });

    expect(result).toEqual({ success: true, redirectTo: "/" });
    expect(sessionStorage.getItem("mfa:pending-login:admin-1")).toBeNull();
  });

  it("requires MFA for admins when the assurance level moves from aal1 to aal2", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: { id: "admin-2", email: "admin2@example.com" } },
      error: null,
    });
    mocks.assuranceLevelResult = {
      data: { currentLevel: "aal1", nextLevel: "aal2" },
      error: null,
    };

    const result = await authProvider.login({
      email: "admin2@example.com",
      password: "secret",
    });

    expect(result).toEqual({ success: true, redirectTo: MFA_VERIFY_ROUTE });
    const pendingState = JSON.parse(sessionStorage.getItem("mfa:pending-login:admin-2") ?? "null");
    expect(pendingState).toMatchObject({
      userId: "admin-2",
      email: "admin2@example.com",
    });
    expect(typeof pendingState.createdAt).toBe("string");
  });

  it("fails admin login when MFA assurance lookup errors", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: { id: "admin-3" } },
      error: null,
    });
    mocks.assuranceLevelResult = {
      data: null,
      error: new Error("aal failed"),
    };

    const result = await authProvider.login({
      email: "admin3@example.com",
      password: "secret",
    });

    expect(mocks.signOut).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      success: false,
      error: {
        message: translations["auth.checkFailed"],
        name: "Unauthorized",
      },
    });
  });

  it("fails check when there is no authenticated session", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });

    const result = await authProvider.check();

    expect(result).toEqual({
      authenticated: false,
      error: {
        message: "Check failed",
        name: "Session not found",
      },
      logout: true,
      redirectTo: "/login",
    });
  });

  it("signs out authenticated users who are not admins during route checks", async () => {
    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          id: "user-2",
          email: "staff@example.com",
        },
      },
    });
    mocks.signOut.mockResolvedValue({ error: null });
    mocks.profileRoleResult = {
      data: { role: "staff" },
      error: null,
    };

    const result = await authProvider.check();

    expect(mocks.signOut).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      authenticated: false,
      error: {
        message: translations["auth.checkFailed"],
        name: "Unauthorized",
      },
      logout: true,
      redirectTo: "/login",
    });
  });

  it("redirects authenticated admins to MFA verification when a pending login exists", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T00:00:00.000Z"));

    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          id: "admin-4",
          email: "admin4@example.com",
        },
      },
    });
    setPendingMfaState({ userId: "admin-4", email: "admin4@example.com", createdAt: new Date().toISOString() });

    const result = await authProvider.check();

    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(result).toEqual({
      authenticated: false,
      error: {
        name: "MfaRequired",
        message: "auth.mfa.required",
      },
      logout: false,
      redirectTo: MFA_VERIFY_ROUTE,
    });
  });

  it("recreates pending MFA state when stored state belongs to another user but Supabase still requires MFA", async () => {
    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          id: "admin-7",
          email: "admin7@example.com",
        },
      },
    });
    mocks.assuranceLevelResult = {
      data: { currentLevel: "aal1", nextLevel: "aal2" },
      error: null,
    };
    window.history.pushState({}, "", "/products?status=active#grid");
    sessionStorage.setItem(
      "mfa:pending-login:admin-7",
      JSON.stringify({
        userId: "different-user",
        email: "other@example.com",
        createdAt: "2026-05-01T00:00:00.000Z",
      }),
    );

    const result = await authProvider.check();

    expect(result).toEqual({
      authenticated: false,
      error: {
        name: "MfaRequired",
        message: "auth.mfa.required",
      },
      logout: false,
      redirectTo: MFA_VERIFY_ROUTE,
    });
    expect(JSON.parse(sessionStorage.getItem("mfa:pending-login:admin-7") ?? "null")).toMatchObject({
      userId: "admin-7",
      email: "admin7@example.com",
      returnTo: "/products?status=active#grid",
    });
  });

  it("recreates pending MFA state when stored state is expired but Supabase still requires MFA", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T00:10:00.000Z"));

    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          id: "admin-8",
          email: "admin8@example.com",
        },
      },
    });
    mocks.assuranceLevelResult = {
      data: { currentLevel: "aal1", nextLevel: "aal2" },
      error: null,
    };
    window.history.pushState({}, "", "/orders/show/123");
    setPendingMfaState({
      userId: "admin-8",
      email: "admin8@example.com",
      createdAt: new Date(Date.now() - PENDING_MFA_TTL_MS - 1).toISOString(),
    });

    const result = await authProvider.check();

    expect(result).toEqual({
      authenticated: false,
      error: {
        name: "MfaRequired",
        message: "auth.mfa.required",
      },
      logout: false,
      redirectTo: MFA_VERIFY_ROUTE,
    });
    expect(JSON.parse(sessionStorage.getItem("mfa:pending-login:admin-8") ?? "null")).toMatchObject({
      userId: "admin-8",
      email: "admin8@example.com",
      returnTo: "/orders/show/123",
      createdAt: "2026-05-01T00:10:00.000Z",
    });
  });

  it("recreates pending MFA state when stored state is malformed but Supabase still requires MFA", async () => {
    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          id: "admin-9",
          email: "admin9@example.com",
        },
      },
    });
    mocks.assuranceLevelResult = {
      data: { currentLevel: "aal1", nextLevel: "aal2" },
      error: null,
    };
    window.history.pushState({}, "", "/customers");
    sessionStorage.setItem("mfa:pending-login:admin-9", "{not-json");

    const result = await authProvider.check();

    expect(result).toEqual({
      authenticated: false,
      error: {
        name: "MfaRequired",
        message: "auth.mfa.required",
      },
      logout: false,
      redirectTo: MFA_VERIFY_ROUTE,
    });
    expect(JSON.parse(sessionStorage.getItem("mfa:pending-login:admin-9") ?? "null")).toMatchObject({
      userId: "admin-9",
      email: "admin9@example.com",
      returnTo: "/customers",
    });
  });

  it("creates pending MFA state when client storage is missing but Supabase still requires MFA", async () => {
    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          id: "admin-10",
          email: "admin10@example.com",
        },
      },
    });
    mocks.assuranceLevelResult = {
      data: { currentLevel: "aal1", nextLevel: "aal2" },
      error: null,
    };
    window.history.pushState({}, "", "/settings");

    const result = await authProvider.check();

    expect(result).toEqual({
      authenticated: false,
      error: {
        name: "MfaRequired",
        message: "auth.mfa.required",
      },
      logout: false,
      redirectTo: MFA_VERIFY_ROUTE,
    });
    expect(JSON.parse(sessionStorage.getItem("mfa:pending-login:admin-10") ?? "null")).toMatchObject({
      userId: "admin-10",
      email: "admin10@example.com",
      returnTo: "/settings",
    });
  });

  it("fails route checks closed when MFA assurance lookup errors", async () => {
    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          id: "admin-aal-error",
          email: "admin-aal-error@example.com",
        },
      },
    });
    mocks.assuranceLevelResult = {
      data: null,
      error: new Error("aal unavailable"),
    };

    const result = await authProvider.check();

    expect(result).toEqual({
      authenticated: false,
      error: {
        message: translations["auth.checkFailed"],
        name: "Unauthorized",
      },
      logout: true,
      redirectTo: "/login",
    });
  });

  it("does not redirect pending MFA users away from the verification route", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T00:00:00.000Z"));

    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          id: "admin-5",
          email: "admin5@example.com",
        },
      },
    });
    setPendingMfaState({ userId: "admin-5", email: "admin5@example.com", createdAt: new Date().toISOString() });
    window.history.pushState({}, "", MFA_VERIFY_ROUTE);

    const result = await authProvider.check();

    expect(result).toEqual({ authenticated: true });
  });

  it("clears pending MFA state on logout", async () => {
    setPendingMfaState({ userId: "admin-6", email: "admin6@example.com", createdAt: "2026-05-01T00:00:00.000Z" });
    mocks.signOut.mockResolvedValue({ error: null });

    const result = await authProvider.logout({});

    expect(result).toEqual({ success: true, redirectTo: "/" });
    expect(sessionStorage.length).toBe(0);
  });

  it("returns identity fields from the profile record when available", async () => {
    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          id: "admin-1",
          email: "admin@example.com",
        },
      },
    });

    const result = await authProvider.getIdentity?.();

    expect(result).toEqual({
      id: "admin-1",
      name: "Admin User",
      avatar: "https://example.com/avatar.png",
    });
  });
});
