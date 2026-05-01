import { AuthProvider } from "@refinedev/core";
import i18n from "../i18n";
import {
  clearAllPendingMfaState,
  clearPendingMfaStateForUser,
  getPendingMfaStateForUser,
  MFA_VERIFY_ROUTE,
  sanitizeMfaReturnTo,
  setPendingMfaState,
} from "../utils/mfa";
import { supabaseClient } from "./supabase-client";
import { MEDIA_BUCKET, resolveStoragePublicUrl } from "../utils/storage";

const ADMIN_ROLE = "admin";

function toAuthError(error: unknown): { name: string; message: string } {
  if (error && typeof error === "object" && "message" in error) {
    const err = error as { name?: string; message: string };
    return {
      name: typeof err.name === "string" ? err.name : "AuthError",
      message: String(err.message),
    };
  }
  return { name: "AuthError", message: "An unexpected error occurred" };
}

async function getProfileRole(userId: string): Promise<string | null> {
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();
  if (error) return null;
  return data?.role ?? null;
}

async function getProfileIdentity(userId: string) {
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("full_name, avatar_url")
    .eq("id", userId)
    .single();
  if (error) return null;
  return data;
}

function rejectNonAdmin() {
  return {
    success: false as const,
    error: {
      message: i18n.t("auth.accessDenied"),
      name: "Unauthorized",
    },
  };
}

function getCurrentPath(): string {
  return typeof window === "undefined" ? "/" : window.location.pathname;
}

function getCurrentReturnTo(): string | undefined {
  if (typeof window === "undefined") return undefined;

  return sanitizeMfaReturnTo(`${window.location.pathname}${window.location.search}${window.location.hash}`);
}

function isMfaRequired(assuranceLevel: { currentLevel?: string | null; nextLevel?: string | null } | null | undefined): boolean {
  return assuranceLevel?.currentLevel === "aal1" && assuranceLevel?.nextLevel === "aal2";
}

const authProvider: AuthProvider = {
  login: async (params) => {
    try {
      const { email, password, providerName } = params;
      const returnTo = sanitizeMfaReturnTo((params as { to?: unknown }).to);

      if (providerName) {
        return {
          success: false,
          error: {
            message: i18n.t("auth.oauthNotAllowed"),
            name: "OAuth not allowed",
          },
        };
      }

      const { data, error } = await supabaseClient.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        return { success: false, error };
      }

      if (data?.user) {
        const role = await getProfileRole(data.user.id);
        if (role !== ADMIN_ROLE) {
          await supabaseClient.auth.signOut();
          return rejectNonAdmin();
        }

        const { data: assuranceLevel, error: assuranceLevelError } =
          await supabaseClient.auth.mfa.getAuthenticatorAssuranceLevel();

        if (assuranceLevelError) {
          await supabaseClient.auth.signOut();
          return {
            success: false,
            error: {
              message: i18n.t("auth.checkFailed"),
              name: "Unauthorized",
            },
          };
        }

        if (isMfaRequired(assuranceLevel)) {
          setPendingMfaState({
            userId: data.user.id,
            email: data.user.email ?? undefined,
            returnTo,
          });
          return { success: true, redirectTo: MFA_VERIFY_ROUTE };
        }

        clearPendingMfaStateForUser(data.user.id);
        return { success: true, redirectTo: "/" };
      }
    } catch (error) {
      return {
        success: false,
        error: toAuthError(error),
      };
    }

    return {
      success: false,
      error: {
        message: "Login failed",
        name: "Invalid email or password",
      },
    };
  },

  register: async () => ({
    success: false,
    error: {
      message: i18n.t("auth.registerDisabled"),
      name: "Registration disabled",
    },
  }),

  forgotPassword: async ({ email }) => {
    try {
      const { data, error } = await supabaseClient.auth.resetPasswordForEmail(
        email,
        { redirectTo: `${window.location.origin}/update-password` }
      );

      if (error) {
        return { success: false, error };
      }

      if (data) {
        return { success: true };
      }
    } catch (error) {
      return {
        success: false,
        error: toAuthError(error),
      };
    }

    return {
      success: false,
      error: {
        message: "Forgot password failed",
        name: "Invalid email",
      },
    };
  },

  updatePassword: async ({ password }) => {
    try {
      const { data, error } = await supabaseClient.auth.updateUser({
        password,
      });

      if (error) {
        return { success: false, error };
      }

      if (data?.user) {
        const role = await getProfileRole(data.user.id);
        if (role !== ADMIN_ROLE) {
          await supabaseClient.auth.signOut();
          return rejectNonAdmin();
        }
        return { success: true };
      }
    } catch (error) {
      return {
        success: false,
        error: toAuthError(error),
      };
    }

    return {
      success: false,
      error: {
        message: "Update password failed",
        name: "Invalid password",
      },
    };
  },

  logout: async () => {
    clearAllPendingMfaState();
    const { error } = await supabaseClient.auth.signOut();
    if (error) {
      return { success: false, error };
    }
    return { success: true, redirectTo: "/" };
  },

  onError: async (error) => {
    return { error };
  },

  check: async () => {
    try {
      const { data: userData } = await supabaseClient.auth.getUser();

      if (!userData?.user) {
        return {
          authenticated: false,
          error: {
            message: "Check failed",
            name: "Session not found",
          },
          logout: true,
          redirectTo: "/login",
        };
      }

      const role = await getProfileRole(userData.user.id);
      if (role !== ADMIN_ROLE) {
        await supabaseClient.auth.signOut();
        return {
          authenticated: false,
          error: {
            message: i18n.t("auth.checkFailed"),
            name: "Unauthorized",
          },
          logout: true,
          redirectTo: "/login",
        };
      }

      const pendingMfaState = getPendingMfaStateForUser(userData.user.id);
      if (pendingMfaState && getCurrentPath() !== MFA_VERIFY_ROUTE) {
        return {
          authenticated: false,
          error: {
            name: "MfaRequired",
            message: i18n.t("auth.mfa.required"),
          },
          logout: false,
          redirectTo: MFA_VERIFY_ROUTE,
        };
      }

      if (getCurrentPath() !== MFA_VERIFY_ROUTE) {
        const { data: assuranceLevel, error: assuranceLevelError } = await supabaseClient.auth.mfa.getAuthenticatorAssuranceLevel();

        if (assuranceLevelError) {
          return {
            authenticated: false,
            error: {
              message: i18n.t("auth.checkFailed"),
              name: "Unauthorized",
            },
            logout: true,
            redirectTo: "/login",
          };
        }

        if (isMfaRequired(assuranceLevel)) {
          setPendingMfaState({
            userId: userData.user.id,
            email: userData.user.email ?? undefined,
            returnTo: getCurrentReturnTo(),
          });
          return {
            authenticated: false,
            error: {
              name: "MfaRequired",
              message: i18n.t("auth.mfa.required"),
            },
            logout: false,
            redirectTo: MFA_VERIFY_ROUTE,
          };
        }
      }
    } catch (error) {
      return {
        authenticated: false,
        error: toAuthError(error),
        logout: true,
        redirectTo: "/login",
      };
    }

    return { authenticated: true };
  },

  getPermissions: async () => {
    const { data: userData } = await supabaseClient.auth.getUser();
    if (userData?.user) {
      const role = await getProfileRole(userData.user.id);
      return role ? [role] : null;
    }
    return null;
  },

  getIdentity: async () => {
    const { data } = await supabaseClient.auth.getUser();
    if (!data?.user) return null;

    const profile = await getProfileIdentity(data.user.id);
    const name = profile?.full_name || data.user.email || "User";

    return {
      id: data.user.id,
      name,
      avatar: resolveStoragePublicUrl(profile?.avatar_url ?? null, MEDIA_BUCKET) ?? undefined,
    };
  },
};

export default authProvider;
