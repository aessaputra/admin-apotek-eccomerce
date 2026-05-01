export const MFA_VERIFY_ROUTE = "/mfa-verify";
export const PENDING_MFA_TTL_MS = 10 * 60 * 1000;

const PENDING_MFA_STORAGE_PREFIX = "mfa:pending-login:";
const VERIFIED_FACTOR_STATUS = "verified";
const TOTP_FACTOR_TYPE = "totp";

export interface PendingMfaState {
  userId: string;
  email?: string;
  returnTo?: string;
  createdAt: string;
}

export interface PendingMfaInput {
  userId: string;
  email?: string;
  returnTo?: string;
  createdAt?: string;
}

export interface MfaFactor {
  id: string;
  factor_type: string;
  status: string;
  friendly_name?: string;
  created_at?: string;
  updated_at?: string;
}

export interface VerifiedTotpFactor extends MfaFactor {
  factor_type: "totp";
  status: "verified";
}

function getPendingMfaStorageKey(userId: string): string {
  return `${PENDING_MFA_STORAGE_PREFIX}${encodeURIComponent(userId)}`;
}

function getSessionStorage(): Storage | null {
  if (typeof window === "undefined") return null;

  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function toPendingMfaState(input: PendingMfaInput): PendingMfaState {
  const returnTo = sanitizeMfaReturnTo(input.returnTo);

  return {
    userId: input.userId,
    email: input.email,
    ...(returnTo ? { returnTo } : {}),
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

function readPendingMfaState(value: string | null): PendingMfaState | null {
  if (!value) return null;

  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return null;

    const candidate = parsed as Partial<PendingMfaState>;
    if (
      typeof candidate.userId !== "string" ||
      typeof candidate.createdAt !== "string" ||
      (candidate.email !== undefined && typeof candidate.email !== "string") ||
      (candidate.returnTo !== undefined && typeof candidate.returnTo !== "string")
    ) {
      return null;
    }

    const returnTo = sanitizeMfaReturnTo(candidate.returnTo);
    if (candidate.returnTo !== undefined && !returnTo) {
      return null;
    }

    return {
      userId: candidate.userId,
      email: candidate.email,
      ...(returnTo ? { returnTo } : {}),
      createdAt: candidate.createdAt,
    };
  } catch {
    return null;
  }
}

function isFreshPendingMfaState(createdAt: string): boolean {
  const createdAtMs = Date.parse(createdAt);
  if (!Number.isFinite(createdAtMs)) return false;

  const ageMs = Date.now() - createdAtMs;
  return ageMs >= 0 && ageMs < PENDING_MFA_TTL_MS;
}

export function setPendingMfaState(input: PendingMfaInput): PendingMfaState | null {
  const storage = getSessionStorage();
  if (!storage) return null;

  const pendingState = toPendingMfaState(input);
  storage.setItem(getPendingMfaStorageKey(pendingState.userId), JSON.stringify(pendingState));
  return pendingState;
}

export function sanitizeMfaReturnTo(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;

  const candidate = value.trim();
  if (!candidate.startsWith("/") || candidate.startsWith("//")) return undefined;

  const baseOrigin = typeof window === "undefined" ? "http://localhost" : window.location.origin;

  try {
    const url = new URL(candidate, baseOrigin);
    if (url.origin !== baseOrigin) return undefined;
    if (url.pathname === "/login" || url.pathname === MFA_VERIFY_ROUTE) return undefined;

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return undefined;
  }
}

export function getPendingMfaStateForUser(userId: string): PendingMfaState | null {
  const storage = getSessionStorage();
  if (!storage) return null;

  const storageKey = getPendingMfaStorageKey(userId);
  const pendingState = readPendingMfaState(storage.getItem(storageKey));
  if (!pendingState) {
    storage.removeItem(storageKey);
    return null;
  }

  if (pendingState.userId !== userId || !isFreshPendingMfaState(pendingState.createdAt)) {
    storage.removeItem(storageKey);
    return null;
  }

  return pendingState;
}

export function isPendingMfaForUser(userId: string): boolean {
  return getPendingMfaStateForUser(userId) !== null;
}

export function clearPendingMfaStateForUser(userId: string): void {
  const storage = getSessionStorage();
  if (!storage) return;

  storage.removeItem(getPendingMfaStorageKey(userId));
}

export function clearAllPendingMfaState(): void {
  const storage = getSessionStorage();
  if (!storage) return;

  const keysToRemove: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(PENDING_MFA_STORAGE_PREFIX)) {
      keysToRemove.push(key);
    }
  }

  keysToRemove.forEach((key) => storage.removeItem(key));
}

export function isVerifiedTotpFactor(factor: MfaFactor): factor is VerifiedTotpFactor {
  return factor.factor_type === TOTP_FACTOR_TYPE && factor.status === VERIFIED_FACTOR_STATUS;
}

export function getVerifiedTotpFactors(factors: readonly MfaFactor[]): VerifiedTotpFactor[] {
  return factors.filter(isVerifiedTotpFactor);
}
