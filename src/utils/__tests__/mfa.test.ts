import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAllPendingMfaState,
  clearPendingMfaStateForUser,
  getPendingMfaStateForUser,
  getVerifiedTotpFactors,
  isPendingMfaForUser,
  isVerifiedTotpFactor,
  MFA_VERIFY_ROUTE,
  PENDING_MFA_TTL_MS,
  sanitizeMfaReturnTo,
  setPendingMfaState,
} from "../mfa";

describe("mfa utils", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("exports the MFA verification route", () => {
    expect(MFA_VERIFY_ROUTE).toBe("/mfa-verify");
  });

  it("stores only safe pending MFA fields in a user-scoped sessionStorage key", () => {
    const createdAt = "2026-05-01T12:00:00.000Z";
    const pending = setPendingMfaState({
      userId: "user-123",
      email: "admin@example.com",
      returnTo: "/products?category=vitamin#stock",
      createdAt,
      qr_code: "secret-qr",
      secret: "secret-totp",
      uri: "otpauth://totp/secret",
      code: "123456",
      password: "super-secret",
      sessionToken: "access-token",
    } as unknown as Parameters<typeof setPendingMfaState>[0]);

    expect(pending).toEqual({
      userId: "user-123",
      email: "admin@example.com",
      returnTo: "/products?category=vitamin#stock",
      createdAt,
    });

    const storedKeys = Array.from({ length: sessionStorage.length }, (_, index) =>
      sessionStorage.key(index),
    ).filter((key): key is string => key !== null);

    expect(storedKeys).toEqual(["mfa:pending-login:user-123"]);
    expect(sessionStorage.getItem("mfa:pending-login:user-123")).toBe(
      JSON.stringify({ userId: "user-123", email: "admin@example.com", returnTo: "/products?category=vitamin#stock", createdAt }),
    );
  });

  it("omits unsafe post-MFA return destinations from pending state", () => {
    const unsafeReturnDestinations = [
      "https://evil.example/products",
      "//evil.example/products",
      "login",
      "/login",
      "/login?to=%2Fproducts",
      MFA_VERIFY_ROUTE,
      `${MFA_VERIFY_ROUTE}?next=%2Fproducts`,
    ];

    for (const returnTo of unsafeReturnDestinations) {
      clearAllPendingMfaState();

      const pending = setPendingMfaState({
        userId: "user-unsafe",
        email: "admin@example.com",
        returnTo,
        createdAt: "2026-05-01T12:00:00.000Z",
      });

      expect(pending?.returnTo).toBeUndefined();
      expect(sessionStorage.getItem("mfa:pending-login:user-unsafe")).not.toContain(returnTo);
    }
  });

  it("normalizes safe relative post-MFA return destinations", () => {
    expect(sanitizeMfaReturnTo(" /orders/show/123?tab=activity#latest ")).toBe("/orders/show/123?tab=activity#latest");
    expect(sanitizeMfaReturnTo("https://evil.example/orders")).toBeUndefined();
    expect(sanitizeMfaReturnTo("//evil.example/orders")).toBeUndefined();
    expect(sanitizeMfaReturnTo("/login")).toBeUndefined();
    expect(sanitizeMfaReturnTo(MFA_VERIFY_ROUTE)).toBeUndefined();
  });

  it("keeps pending MFA state isolated per user and supports cleanup helpers", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T00:00:00.000Z"));

    setPendingMfaState({ userId: "user-a", email: "a@example.com", createdAt: "2026-05-01T00:00:00.000Z" });
    setPendingMfaState({ userId: "user-b", createdAt: "2026-05-01T00:00:00.000Z" });

    expect(getPendingMfaStateForUser("user-a")).toEqual({
      userId: "user-a",
      email: "a@example.com",
      createdAt: "2026-05-01T00:00:00.000Z",
    });
    expect(getPendingMfaStateForUser("user-b")).toEqual({
      userId: "user-b",
      createdAt: "2026-05-01T00:00:00.000Z",
    });
    expect(getPendingMfaStateForUser("other-user")).toBeNull();
    expect(isPendingMfaForUser("user-a")).toBe(true);
    expect(isPendingMfaForUser("other-user")).toBe(false);

    clearPendingMfaStateForUser("user-a");
    expect(isPendingMfaForUser("user-a")).toBe(false);
    expect(isPendingMfaForUser("user-b")).toBe(true);

    clearAllPendingMfaState();
    expect(isPendingMfaForUser("user-b")).toBe(false);
    expect(sessionStorage.length).toBe(0);
  });

  it("expires pending MFA state after ten minutes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T00:00:00.000Z"));

    setPendingMfaState({ userId: "user-expiring", email: "expiring@example.com" });

    vi.setSystemTime(new Date("2026-05-01T00:09:59.999Z"));
    expect(getPendingMfaStateForUser("user-expiring")).toEqual({
      userId: "user-expiring",
      email: "expiring@example.com",
      createdAt: "2026-05-01T00:00:00.000Z",
    });

    vi.setSystemTime(new Date("2026-05-01T00:10:00.001Z"));
    expect(getPendingMfaStateForUser("user-expiring")).toBeNull();
    expect(sessionStorage.getItem("mfa:pending-login:user-expiring")).toBeNull();
    expect(PENDING_MFA_TTL_MS).toBe(10 * 60 * 1000);
  });

  it("cleans up pending MFA entries whose stored user id does not match the lookup user", () => {
    const key = "mfa:pending-login:user-mismatch";
    sessionStorage.setItem(
      key,
      JSON.stringify({ userId: "different-user", createdAt: "2026-05-01T00:00:00.000Z" }),
    );

    expect(getPendingMfaStateForUser("user-mismatch")).toBeNull();
    expect(sessionStorage.getItem(key)).toBeNull();
  });

  it("cleans up malformed pending MFA JSON entries", () => {
    const key = "mfa:pending-login:user-malformed";
    sessionStorage.setItem(key, "{not-json");

    expect(getPendingMfaStateForUser("user-malformed")).toBeNull();
    expect(sessionStorage.getItem(key)).toBeNull();
  });

  it("cleans up pending MFA entries with invalid shapes", () => {
    const key = "mfa:pending-login:user-invalid";
    sessionStorage.setItem(
      key,
      JSON.stringify({ userId: "user-invalid", createdAt: 123, email: 42 }),
    );

    expect(getPendingMfaStateForUser("user-invalid")).toBeNull();
    expect(sessionStorage.getItem(key)).toBeNull();
  });

  it("cleans up pending MFA entries with unsafe stored return destinations", () => {
    const key = "mfa:pending-login:user-unsafe-return";
    sessionStorage.setItem(
      key,
      JSON.stringify({ userId: "user-unsafe-return", createdAt: "2026-05-01T00:00:00.000Z", returnTo: "https://evil.example" }),
    );

    expect(getPendingMfaStateForUser("user-unsafe-return")).toBeNull();
    expect(sessionStorage.getItem(key)).toBeNull();
  });

  it("filters only verified TOTP factors", () => {
    const factors = [
      {
        id: "totp-verified",
        factor_type: "totp",
        status: "verified",
        friendly_name: "Main Authenticator",
        created_at: "2026-04-01T00:00:00.000Z",
        updated_at: "2026-04-02T00:00:00.000Z",
      },
      {
        id: "totp-unverified",
        factor_type: "totp",
        status: "unverified",
      },
      {
        id: "phone-verified",
        factor_type: "phone",
        status: "verified",
      },
      {
        id: "webauthn-verified",
        factor_type: "webauthn",
        status: "verified",
      },
    ];

    expect(isVerifiedTotpFactor(factors[0])).toBe(true);
    expect(isVerifiedTotpFactor(factors[1])).toBe(false);
    expect(isVerifiedTotpFactor(factors[2])).toBe(false);

    expect(getVerifiedTotpFactors(factors)).toEqual([factors[0]]);
  });
});
