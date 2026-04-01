import { beforeEach, describe, expect, it, vi } from "vitest";

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

const mocks = vi.hoisted(() => {
  let profileRoleResult: ProfileRoleResult = {
    data: { role: "admin" },
    error: null,
  };

  let profileIdentityResult: ProfileIdentityResult = {
    data: { full_name: "Admin User", avatar_url: "https://example.com/avatar.png" },
    error: null,
  };

  const signInWithPassword = vi.fn();
  const signOut = vi.fn();
  const getUser = vi.fn();
  const resetPasswordForEmail = vi.fn();
  const updateUser = vi.fn();
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
    signInWithPassword,
    signOut,
    getUser,
    resetPasswordForEmail,
    updateUser,
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
    },
    from: mocks.from,
  },
}));

import authProvider from "../auth";

describe("authProvider", () => {
  beforeEach(() => {
    mocks.profileRoleResult = {
      data: { role: "admin" },
      error: null,
    };
    mocks.profileIdentityResult = {
      data: { full_name: "Admin User", avatar_url: "https://example.com/avatar.png" },
      error: null,
    };

    mocks.signInWithPassword.mockReset();
    mocks.signOut.mockReset();
    mocks.getUser.mockReset();
    mocks.resetPasswordForEmail.mockReset();
    mocks.updateUser.mockReset();
    mocks.from.mockClear();
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
    expect(result).toEqual({
      success: false,
      error: {
        message: translations["auth.accessDenied"],
        name: "Unauthorized",
      },
    });
  });

  it("allows admins to log in and redirects to the dashboard", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: { id: "admin-1" } },
      error: null,
    });

    const result = await authProvider.login({
      email: "admin@example.com",
      password: "secret",
    });

    expect(result).toEqual({ success: true, redirectTo: "/" });
    expect(mocks.signOut).not.toHaveBeenCalled();
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
