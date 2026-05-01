# Providers Module

**Purpose:** Frontend infrastructure for Supabase auth, Refine data access, and browser client configuration.

## FILES

| File | Role |
|------|------|
| `auth.ts` | Refine `authProvider`; password login, admin role gate, MFA handling |
| `data.ts` | Refine Supabase `dataProvider` wrapper; read models, RPC metrics, media cleanup |
| `supabase-client.ts` | Browser Supabase client with public schema and persistent auth |
| `constants.ts` | Required `VITE_SUPABASE_URL` / `VITE_SUPABASE_KEY` validation |
| `__tests__/` | Provider unit tests for auth and data cleanup behavior |

## AUTH FLOW (`auth.ts`)

```text
login
  -> supabase.auth.signInWithPassword
  -> getProfileRole(user.id)
  -> non-admin: signOut + reject
  -> MFA required: store pending MFA state + redirect /mfa-verify
  -> admin: success
```

Key symbols:

| Symbol | Role |
|--------|------|
| `ADMIN_ROLE` | Literal role gate: `admin` |
| `getProfileRole(userId)` | Reads `profiles.role` |
| `rejectNonAdmin()` | Standard denial result |
| `isMfaRequired()` | Checks Supabase AAL response |
| `authProvider.check()` | Revalidates session, admin role, MFA state |

## DATA FLOW (`data.ts`)

- `mapReadResource()` redirects admin-facing resources to protected read models where required.
- `withProductReadMeta()` injects select metadata for product read resources.
- `getAdminOperationalMetrics()` calls the `admin_operational_metrics` RPC; date/granularity filters are required.
- `getOne("orders")` stitches order rows with `order_items` from the read model path.
- `deleteOne` / `deleteMany` clean media for categories, products, and home banners before delegating DB deletion.
- Banner media is removed only when no remaining banner row references the same `media_path`.

## CONVENTIONS

- Keep Supabase browser keys limited to `VITE_SUPABASE_URL` and `VITE_SUPABASE_KEY`; other publishable frontend keys (for example Google Maps) belong outside this provider.
- Return Refine-compatible auth results: `{ success, redirectTo, error, logout }`.
- Normalize unknown errors with typed `Error` objects; do not leak privileged details.
- For new protected read resources, add mapping/normalization here instead of scattering Supabase selects across pages.
- If delete cleanup changes, update `src/providers/__tests__/data.test.ts` and storage utility tests.

## ANTI-PATTERNS

- **NEVER** use `SUPABASE_SERVICE_ROLE_KEY` here; service role belongs only in Edge Functions/server-side jobs.
- **NEVER** bypass `authProvider.check` in route protection.
- **NEVER** trust client metadata for admin authorization; use `profiles.role` or backend checks.
- **NEVER** silently ignore storage cleanup failures unless the calling flow intentionally tolerates best-effort cleanup.

## RELATED

- Upload path validation: `src/utils/storage.ts`
- Upload hook: `src/hooks/useSupabaseUpload.ts`
- Auth UI: `src/pages/auth/`, `src/pages/profile/`
- Server-side privileged code: `supabase/functions/`
