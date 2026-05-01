# Supabase Edge Functions

**Purpose:** Deno serverless handlers for checkout, payments, shipping, order operations, notifications, customer bans, and cleanup jobs.

## FUNCTIONS

| Function | Role |
|----------|------|
| `ban-customer` | Admin customer ban/unban with service-role Auth access |
| `biteship` | Rates, draft orders, public tracking, courier/maps proxy |
| `cancel-user-order` | Authenticated customer unpaid-order cancellation and Midtrans cancel |
| `cleanup-orphan-storage` | Manual/cron media orphan dry-run/quarantine cleanup |
| `confirm-midtrans-payment` | Authenticated manual payment confirmation/reconciliation |
| `confirm-order-received` | Customer completion confirmation |
| `create-checkout-order` | JWT-authenticated checkout aggregate/RPC path |
| `create-snap-token` | Midtrans Snap token creation/reuse |
| `midtrans-webhook` | Midtrans notification receiver and payment transition source |
| `order-manager` | Admin order status/shipment transition manager |
| `process-webhook-side-effects` | Service-role queued stock/cart/Biteship side-effect processor |
| `push` | Expo push notification dispatch |
| `reconcile-pending-midtrans-payments` | Service-role pending payment reconciliation |

## ENTRYPOINT PATTERNS

- Default entrypoint is `index.ts` with `Deno.serve`.
- `create-checkout-order`, `cleanup-orphan-storage`, and `push` split runtime wiring (`index.ts`) from testable logic (`handler.ts`).
- Shared utilities and types belong in `_shared/`, not copied across function folders.
- CORS handling should use existing `_shared/cors.ts` helpers where applicable.
- Large legacy functions may keep router/business logic in `index.ts`; extract new testable logic rather than expanding them further.

## AUTH / SECRETS

- Several functions are configured with `verify_jwt = false`; do not assume Supabase pre-verifies callers.
- Public webhooks must validate provider signatures before DB mutation.
- User/admin functions must verify JWTs and roles explicitly when JWT verification is disabled at config level.
- Service-role functions must require a service-role bearer or server-side cron/Vault path.
- Read secrets from `Deno.env`; never import frontend env or hard-code keys.

## TESTING

- Handler/shared tests use Vitest under function-local or `_shared/__tests__/` directories.
- Prefer extracting logic into `handler.ts` or `_shared` when adding tests for request handling.
- Run `pnpm test` for existing function tests; add focused tests for payment, checkout, cleanup, and push regressions.

## HOTSPOTS

- `order-manager/index.ts`: largest order lifecycle function; coordinate with `src/pages/orders/show.tsx`, notifications, shipment rollback, and side-effect tests.
- `biteship/index.ts`: proxy/router for rates, maps, couriers, and tracking; pair with `_shared/biteship*.ts`.
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
- **NEVER** expose stack traces or secret-derived details in JSON responses.
