import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { STORE_BRANDING_QUERY_KEY, useStoreBranding } from "../useStoreBranding";

const mocks = vi.hoisted(() => {
  const maybeSingle = vi.fn();
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));

  return {
    maybeSingle,
    eq,
    select,
    from,
  };
});

vi.mock("../../providers/supabase-client", () => ({
  supabaseClient: {
    from: mocks.from,
  },
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useStoreBranding", () => {
  beforeEach(() => {
    mocks.from.mockClear();
    mocks.select.mockClear();
    mocks.eq.mockClear();
    mocks.maybeSingle.mockReset();

  });

  it("uses a stable branding query key", () => {
    expect(STORE_BRANDING_QUERY_KEY).toEqual(["store-branding"]);
  });

  it("loads store name and primary logo url from settings row 1", async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: {
        store_name: "Apotek Sehat",
        primary_logo_url: "https://cdn.example.com/settings/logo.png",
      },
      error: null,
    });

    const { result } = renderHook(() => useStoreBranding(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.storeName).toBe("Apotek Sehat");
      expect(result.current.primaryLogoUrl).toBe("https://cdn.example.com/settings/logo.png");
    });

    expect(mocks.from).toHaveBeenCalledWith("settings");
    expect(mocks.select).toHaveBeenCalledWith("store_name, primary_logo_url");
    expect(mocks.eq).toHaveBeenCalledWith("id", 1);
  });

  it("normalizes blank branding values to null", async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: {
        store_name: "   ",
        primary_logo_url: "   ",
      },
      error: null,
    });

    const { result } = renderHook(() => useStoreBranding(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.storeName).toBeNull();
      expect(result.current.primaryLogoUrl).toBeNull();
    });
  });

  it("converts stored relative logo paths into public URLs for branding consumers", async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: {
        store_name: "Apotek Sehat",
        primary_logo_url: "settings/logo.png",
      },
      error: null,
    });

    const { result } = renderHook(() => useStoreBranding(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.primaryLogoUrl).toBe(
        `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/media/settings/logo.png`,
      );
    });
  });
});
