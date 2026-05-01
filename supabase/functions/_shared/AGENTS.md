# Shared Edge Function Helpers

**Purpose:** Cross-function Deno utilities for Midtrans, Biteship, order flow, Supabase admin access, cleanup, notifications, and webhook side effects.

## WHERE TO LOOK

| Task | File | Notes |
|------|------|-------|
| Supabase admin client | `supabase.ts` | Reads `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` |
| CORS headers | `cors.ts` | Reuse for function responses/options |
| Midtrans mapping/signature/Snap | `midtrans.ts` | Payment status, currency, gross amount, Snap payload |
| Biteship integration | `biteship.ts`, `biteship-courier-contract.ts` | Rates/order/tracking and courier capability rules |
| Biteship rates/endpoints | `biteship-rates.ts`, `biteship-public-tracking.ts`, `biteship-postal-code.ts` | Request payloads and public endpoint builders |
| Order transition rules | `order-flow-rules.ts`, `order-status.ts`, `order-manager-mutation.ts` | Status validation and mutation/rollback helpers |
| Order aggregate/types | `order-aggregate.ts`, `types.ts` | Shared order/payment/shipping contracts |
| Webhook side effects | `webhook-side-effects.ts` | Stock/cart/Biteship task processing and retries |
| Storage cleanup | `cleanup-orphan-storage.ts` | Media reference discovery and cleanup response shape |
| Notifications | `notification-helpers.ts` | Shared route constants and notification data |

## CONVENTIONS

- Keep helpers pure/testable where possible; isolate `Deno.env`, `fetch`, and Supabase clients at edges.
- Preserve existing normalization helpers instead of reimplementing status/currency/amount logic in functions.
- Use explicit error messages that tests can assert, but do not include secrets.
- When adding a shared helper, add/extend tests in `_shared/__tests__/`.
- Treat `_shared` edits as deployment-affecting for every importer.

## HIGH-RISK HELPERS

- `midtrans.ts`: signature verification, stale/no-op payment handling, paid timestamp/currency normalization.
- `webhook-side-effects.ts`: lease/retry behavior, stock deduction, cart cleanup, Biteship order creation.
- `cleanup-orphan-storage.ts`: managed media prefixes and reference sources.
- `biteship.ts`: duplicate reference handling and request/response assertions.
- `order-manager-mutation.ts`: rollback snapshots for shipment/order mutations.

## ANTI-PATTERNS

- **NEVER** loosen Midtrans amount/currency/signature checks to make a webhook pass.
- **NEVER** add managed media prefixes without matching storage policies/migrations.
- **NEVER** make shared helpers depend on browser-only APIs or `import.meta.env`.
- **NEVER** change retry/idempotency semantics without updating tests and the calling function docs.
