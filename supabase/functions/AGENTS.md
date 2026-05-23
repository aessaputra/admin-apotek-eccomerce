# Supabase Edge Functions

**Purpose:** Deno serverless handlers for checkout, payments, shipping, order operations, notifications, customer bans, runtime integration config, and cleanup jobs.

## FUNCTIONS

| Function | Role |
|----------|------|
| `ban-customer` | Admin customer ban/unban with service-role Auth access |
| `biteship` | Rates, maps, public tracking, courier list, and Biteship config proxy; see local AGENTS.md |
| `cancel-user-order` | Authenticated customer unpaid-order cancellation and Midtrans cancel |
| `cleanup-orphan-storage` | Manual/cron media orphan dry-run/quarantine cleanup |
| `confirm-midtrans-payment` | Authenticated manual payment confirmation/reconciliation |
| `confirm-order-received` | Customer completion confirmation |
| `create-checkout-order` | JWT-authenticated checkout aggregate/RPC path |
| `create-snap-token` | Midtrans Snap token creation/reuse |
| `integration-config` | Admin-only runtime config summary/rotate/update/audit gateway; see local AGENTS.md |
| `midtrans-webhook` | Midtrans notification receiver and payment transition source |
| `order-manager` | Admin order status/shipment transition manager |
| `process-webhook-side-effects` | Service-role queued stock/cart/Biteship side-effect processor |
| `push` | Expo push notification dispatch, receipts, test notification |
| `reconcile-pending-midtrans-payments` | Service-role pending payment reconciliation |

## ENTRYPOINT PATTERNS

- Default entrypoint is `index.ts` with `Deno.serve`.
- Testable functions split runtime wiring (`index.ts`) from logic (`handler.ts`): `biteship`, `ban-customer`, `integration-config`, `create-checkout-order`, `cleanup-orphan-storage`, and `push`.
- Shared utilities and types belong in `_shared/`, not copied across function folders.
- CORS handling should use existing `_shared/cors.ts` helpers where applicable.
- Large legacy functions may keep router/business logic in `index.ts`; extract new testable logic rather than expanding them further.

## AUTH / SECRETS

- `supabase/config.toml` sets `verify_jwt = false` for every listed function; never assume Supabase pre-verifies callers.
- Browser/mobile-callable functions must verify JWTs and ownership/admin roles manually.
- Admin functions check `profiles.role === "admin"`.
- Service-role cron/worker functions must require `Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}` or a vetted Vault/cron path.
- Public webhooks must validate provider signatures before DB mutation or raw notification persistence.
- Read Supabase platform env (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) at runtime edges only.
- Provider secrets should come from `_shared/runtime-config.ts` and database/Vault config. Do not add direct `MIDTRANS_*`, `BITESHIP_*`, or `EXPO_*` env reads; the only approved provider env grace path is the source-guarded `BITESHIP_API_KEY` fallback in `_shared/biteship.ts`.

## TESTING

- Handler/shared tests use Vitest under function-local or `_shared/__tests__/` directories.
- Prefer extracting logic into `handler.ts` or `_shared` when adding tests for request handling.
- Handler tests build real `Request` objects and assert `Response` status/body/headers with injected Supabase/auth/fetch dependencies.
- Source-guard tests in `_shared/__tests__` inspect runtime source to prevent forbidden provider env fallbacks and unsafe persistence order.
- Run `pnpm test` for existing function tests; add focused tests for payment, checkout, cleanup, runtime config, Biteship, and push regressions.

## HOTSPOTS

- `order-manager/index.ts`: largest order lifecycle function; coordinate with `src/pages/orders/show.tsx`, notifications, shipment rollback, and side-effect tests.
- `biteship/handler.ts`: rates, maps, couriers, runtime config diagnostics, and public tracking; pair with `_shared/biteship*.ts`.
- `integration-config/handler.ts`: admin role checks, config mutation/audit RPCs, secret response sanitization.
- `push/handler.ts`: service-role delivery, user JWT test notifications, Expo receipts, invalid-token cleanup.
- `midtrans-webhook/index.ts`: signature/status/amount checks plus idempotent payment transitions.
- `process-webhook-side-effects` + `_shared/webhook-side-effects.ts`: stock, cart, Biteship, retry/lease semantics.

## DEPLOYMENT

```bash
npx supabase --workdir "/home/coder/dev/pharma/admin-panel" functions deploy <function-name> --project-ref <project-ref> --use-api
```

If `_shared` changes, redeploy all importing functions, not just the folder edited.

## ANTI-PATTERNS

- **NEVER** persist raw Midtrans notifications before signature validation.
- **NEVER** duplicate stock deduction, cart cleanup, or Biteship side effects on stale/replayed payment notifications.
- **NEVER** trust client-provided order/user IDs without checking ownership/admin role.
- **NEVER** expose stack traces, raw database errors, plaintext secrets, or secret-derived details in JSON responses.
- **NEVER** use `Deno.env.toObject()` or broad env dumps in function code/tests.
