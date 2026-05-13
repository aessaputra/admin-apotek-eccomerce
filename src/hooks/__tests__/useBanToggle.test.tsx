import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBanToggle } from "../useBanToggle";

const mocks = vi.hoisted(() => {
  const translate = vi.fn((key: string, params?: Record<string, string>) => {
    if (key === "customers.banContent") {
      return `Ban customer ${params?.name ?? "unknown"}?`;
    }

    if (key === "customers.unbanContent") {
      return `Restore login access for ${params?.name ?? "unknown"}?`;
    }

    const messages: Record<string, string> = {
      "customers.banConfirm": "Ban customer?",
      "customers.banOk": "Yes, ban",
      "buttons.cancel": "Cancel",
      "customers.unbanConfirm": "Unblock customer?",
      "customers.unbanOk": "Restore login access",
      "customers.banSuccess": "Customer banned",
      "customers.banError": "Failed to ban customer",
      "customers.unbanSuccess": "Customer unbanned",
      "customers.unbanError": "Failed to unban customer",
    };

    return messages[key] ?? key;
  });
  const invalidate = vi.fn();
  const confirm = vi.fn();
  const success = vi.fn();
  const error = vi.fn();
  const invoke = vi.fn();
  const getFunctionsErrorMessage = vi.fn();

  return {
    translate,
    invalidate,
    confirm,
    success,
    error,
    invoke,
    getFunctionsErrorMessage,
  };
});

vi.mock("@refinedev/core", () => ({
  useTranslation: () => ({ translate: mocks.translate }),
  useInvalidate: () => mocks.invalidate,
}));

vi.mock("antd", () => ({
  App: {
    useApp: () => ({
      modal: {
        confirm: mocks.confirm,
        success: mocks.success,
        error: mocks.error,
      },
    }),
  },
}));

vi.mock("../../providers/supabase-client", () => ({
  supabaseClient: {
    functions: {
      invoke: mocks.invoke,
    },
  },
}));

vi.mock("../../utils/functions-error", () => ({
  getFunctionsErrorMessage: mocks.getFunctionsErrorMessage,
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: {
        retry: false,
      },
    },
  });

  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useBanToggle", () => {
  beforeEach(() => {
    mocks.translate.mockClear();
    mocks.invalidate.mockReset();
    mocks.confirm.mockReset();
    mocks.success.mockReset();
    mocks.error.mockReset();
    mocks.invoke.mockReset();
    mocks.getFunctionsErrorMessage.mockReset();
  });

  it("opens a confirmation modal before banning a customer", () => {
    mocks.invoke.mockResolvedValue({ data: { ok: true }, error: null });

    const { result } = renderHook(() => useBanToggle(), {
      wrapper: createWrapper(),
    });

    result.current.handleBan({ id: "user-1", full_name: "Alice" });

    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Ban customer?",
        content: "Ban customer Alice?",
        okText: "Yes, ban",
        cancelText: "Cancel",
        okButtonProps: { danger: true },
        onOk: expect.any(Function),
      })
    );
  });

  it("opens a confirmation modal before unbanning a customer", () => {
    mocks.invoke.mockResolvedValue({ data: { ok: true }, error: null });

    const { result } = renderHook(() => useBanToggle(), {
      wrapper: createWrapper(),
    });

    result.current.handleUnban({ id: "user-2", full_name: "Bob" });

    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Unblock customer?",
        content: "Restore login access for Bob?",
        okText: "Restore login access",
        cancelText: "Cancel",
        onOk: expect.any(Function),
      })
    );
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("invokes the unban function after confirmation, invalidates refine caches, and shows success feedback", async () => {
    mocks.invoke.mockResolvedValue({ data: { ok: true }, error: null });

    const { result } = renderHook(() => useBanToggle(), {
      wrapper: createWrapper(),
    });

    result.current.handleUnban({ id: "user-2", full_name: "Bob" });

    const confirmConfig = mocks.confirm.mock.calls[0]?.[0];
    expect(confirmConfig).toBeDefined();

    if (!confirmConfig || typeof confirmConfig.onOk !== "function") {
      throw new Error("Expected confirm onOk handler");
    }

    confirmConfig.onOk();

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith("ban-customer", {
        body: { userId: "user-2", action: "unban" },
      });
      expect(mocks.invalidate).toHaveBeenCalledWith({
        resource: "profiles",
        invalidates: ["list", "detail"],
      });
      expect(mocks.success).toHaveBeenCalledWith({ content: "Customer unbanned" });
    });
  });

  it("resolves ban errors into user-facing modal feedback", async () => {
    const thrownError = new Error("request failed");
    mocks.invoke.mockResolvedValue({ data: null, error: thrownError });
    mocks.getFunctionsErrorMessage.mockResolvedValue("Readable failure");

    const { result } = renderHook(() => useBanToggle(), {
      wrapper: createWrapper(),
    });

    result.current.handleBan({ id: "user-3", full_name: "Charlie" });

    const confirmConfig = mocks.confirm.mock.calls[0]?.[0];
    expect(confirmConfig).toBeDefined();

    if (!confirmConfig || typeof confirmConfig.onOk !== "function") {
      throw new Error("Expected confirm onOk handler");
    }

    await confirmConfig.onOk();

    await waitFor(() => {
      expect(mocks.getFunctionsErrorMessage).toHaveBeenCalledWith(
        thrownError,
        "Failed to ban customer"
      );
      expect(mocks.error).toHaveBeenCalledWith({ content: "Readable failure" });
    });
  });
});
