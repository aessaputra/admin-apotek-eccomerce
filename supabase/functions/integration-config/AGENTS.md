# Integration Config Function

**Purpose:** Admin-only Edge Function gateway for database-backed runtime config summary, secret rotation, non-secret updates, audits, and Biteship health diagnostics.

## FILES

| File | Role |
|------|------|
| `index.ts` | Deno runtime wiring, auth/admin Supabase clients, env validation |
| `handler.ts` | Testable request handler and action routing |
| `__tests__/index.test.ts` | Admin auth, RPC, sanitization, and action tests |

## ACTIONS

| Action | RPC | Notes |
|--------|-----|-------|
| `summary` | `list_integration_config_summary` | May include Biteship health diagnostics |
| `rotateSecret` | `rotate_integration_config_secret` | Requires `key`, `secret`, `reason` |
| `updateValue` | `update_integration_config_value` | Requires `key`, JSON `value`, `reason` |
| `audit` | `list_integration_config_audit` | Optional key, bounded limit 1-500 |

## AUTH / RESPONSE CONTRACT

- `verify_jwt = false` in `supabase/config.toml`; `handler.ts` must validate `Authorization: Bearer <token>`.
- Auth client verifies the user, then admin client reads `profiles.role`; only `admin` may proceed.
- Admin RPCs run with service role through injected `getAdminClient`.
- Responses must pass through `withoutUnsafeResponseFields`; never return `runtime_value`, `secret`, or `p_secret_value`.
- Logs use safe generic messages; do not include database errors or plaintext config values.

## RUNTIME CONFIG MODEL

- Config data lives in private integration-config tables and Vault references created by migrations.
- Secret values rotate into new versions with masked value and fingerprint metadata.
- Non-secret values are versioned too; do not treat them as mutable `settings` columns.
- Biteship health compares runtime config completeness and legacy settings drift; diagnostics are safe metadata only.

## TESTING

```bash
pnpm vitest run supabase/functions/integration-config/__tests__/index.test.ts
pnpm vitest run supabase/migrations/__tests__/database-backed-integration-config-migration.test.ts
pnpm vitest run supabase/functions/_shared/__tests__/runtime-config.test.ts
```

## ANTI-PATTERNS

- **NEVER** bypass admin role verification because the function already has service-role credentials.
- **NEVER** return plaintext Vault/runtime values to the browser.
- **NEVER** add an action without updating frontend `integration-config-client.ts`, migrations/RPCs, and tests.
- **NEVER** log raw RPC errors from secret/config operations.
