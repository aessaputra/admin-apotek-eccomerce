import { AuthProvider } from "@refinedev/core";
import i18n from "../i18n";
import { supabaseClient } from "./supabase-client";

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

const authProvider: AuthProvider = {
  login: async ({ email, password, providerName }) => {
    try {
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
    const { error } = await supabaseClient.auth.signOut();
    if (error) {
      return { success: false, error };
    }
    return { success: true, redirectTo: "/" };
  },

  onError: async (error) => {
    if (import.meta.env.DEV) console.error(error);
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
      avatar: profile?.avatar_url ?? undefined,
    };
  },
};

export default authProvider;
