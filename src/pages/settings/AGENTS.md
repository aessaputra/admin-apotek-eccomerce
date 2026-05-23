# Settings Pages

**Purpose:** Singleton shop settings plus admin runtime configuration for payment, shipping, push, and CORS.

## FILES

| File | Role |
|------|------|
| `index.tsx` | Settings shell, store branding/location, tab orchestration |
| `payment-settings-panel.tsx` | Midtrans server key and production-mode runtime config UI |
| `shipping-settings-panel.tsx` | Biteship key/origin/courier/shop shipper runtime config UI |
| `integration-config-panel.tsx` | Technical config for push token, CORS, audit |
| `integration-config-client.ts` | Browser client for `integration-config` Edge Function |
| `integration-config-ownership.ts` | Primary owner and secret-key registry for every runtime config key |
| `integration-config-primitives.tsx` | Shared masked-value/audit/secret replacement UI |

## RUNTIME CONFIG CONTRACT

- Browser code calls `supabase.functions.invoke("integration-config")`; it never reads provider secrets directly.
- Every key in `RUNTIME_CONFIG_KEYS` must have exactly one owner in `INTEGRATION_CONFIG_OWNERSHIP`.
- Secret keys are limited to `midtrans.server_key`, `biteship.api_key`, and `push.expo_access_token`.
- Save operations require a reason string (`settings_*_save`) for audit trail RPCs.
- Summary rows expose masked/fingerprint/version metadata; plaintext secret values must never return to React.
- Biteship health diagnostics appear when requesting Biteship keys and compare runtime config with legacy `settings` drift.

## RELATED BACKEND

| Task | Backend |
|------|---------|
| Gateway auth/actions | `supabase/functions/integration-config/` |
| Runtime lookup/cache | `supabase/functions/_shared/runtime-config.ts` |
| Biteship settings use | `supabase/functions/_shared/biteship.ts` |
| Midtrans settings use | `supabase/functions/_shared/midtrans.ts` |
| Config schema/RPCs | `supabase/migrations/*integration_config*.sql` |

## CONVENTIONS

- Keep payment, shipping, and technical tabs aligned with ownership groups.
- Use AntD `message`, `Alert`, `Modal`, and `Card` patterns already in these panels.
- After payment or shipping mutations, invalidate that owner summary query; technical mutations invalidate both technical summary and audit queries. If another owner gains an audit view, invalidate its audit query too.
- Fallback courier data is read-only in the shipping panel; do not let admins save fallback as live Biteship config.
- Store branding upload still uses `useSupabaseUpload`; runtime config secrets use `SecretReplacementInput`.

## ANTI-PATTERNS

- **NEVER** add a runtime config key without updating `RUNTIME_CONFIG_KEYS`, ownership, backend `CONFIG_KEYS`, migrations, and tests.
- **NEVER** display or persist plaintext secrets in React state beyond the replacement input draft.
- **NEVER** bypass `integration-config` with direct table/RPC calls from the browser.
- **NEVER** treat versioned runtime config as simple `settings` row fields.
