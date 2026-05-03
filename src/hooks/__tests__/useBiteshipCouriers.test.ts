import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BITESHIP_FALLBACK_COURIER_SERVICES } from "../../constants/couriers";
import { useBiteshipCouriers } from "../useBiteshipCouriers";

const mocks = vi.hoisted(() => {
  const getSession = vi.fn();
  return { getSession };
});

vi.mock("../../providers/supabase-client", () => ({
  supabaseClient: {
    auth: {
      getSession: mocks.getSession,
    },
  },
}));

describe("useBiteshipCouriers", () => {
  beforeEach(() => {
    mocks.getSession.mockReset();
    vi.restoreAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("uses fallback couriers when there is no authenticated session token", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null } });

    const { result } = renderHook(() => useBiteshipCouriers());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.isFallback).toBe(true);
      expect(result.current.error).toBe("Authentication required to load live courier services");
      expect(result.current.couriers).toEqual(BITESHIP_FALLBACK_COURIER_SERVICES);
    });
  });

  it("normalizes courier responses from the edge function", async () => {
    mocks.getSession.mockResolvedValue({
      data: { session: { access_token: "token-123" } },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            courier_code: " JNE ",
            courier_name: " JNE Express ",
            courier_service_code: " REG ",
            courier_service_name: " Regular ",
            description: " Fast delivery ",
          },
          {
            courier_code: "jne",
            courier_name: "Duplicate",
            courier_service_code: "reg",
            courier_service_name: "Duplicate",
          },
        ],
      })
    );

    const { result } = renderHook(() => useBiteshipCouriers());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.isFallback).toBe(false);
      expect(result.current.error).toBeNull();
      expect(result.current.couriers).toEqual([
        {
          key: "jne:reg",
          companyCode: "jne",
          companyLabel: "JNE Express",
          serviceCode: "reg",
          serviceLabel: "Regular",
          description: "Fast delivery",
        },
      ]);
    });
  });

  it("falls back when the edge function request fails", async () => {
    mocks.getSession.mockResolvedValue({
      data: { session: { access_token: "token-123" } },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => [],
      })
    );

    const { result } = renderHook(() => useBiteshipCouriers());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.isFallback).toBe(true);
      expect(result.current.error).toBe("Unable to load live courier services from Biteship");
      expect(result.current.couriers).toEqual(BITESHIP_FALLBACK_COURIER_SERVICES);
    });
  });
});
