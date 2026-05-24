# Shared Edge Function Helpers

**Purpose:** Cross-function Deno utilities for runtime config, Midtrans, Biteship, order flow, Supabase admin access, cleanup, notifications, and webhook side effects.

## WHERE TO LOOK

| Task | File | Notes |
|------|------|-------|
| Supabase admin client | `supabase.ts` | Reads `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` |
| CORS headers | `cors.ts` | Reuse for function responses/options |
| Runtime config | `runtime-config.ts` | Database/Vault-backed provider config, masking, cache, versions |
| Midtrans mapping/signature/Snap | `midtrans.ts` | Payment status, currency, gross amount, Snap payload |
| Biteship integration | `biteship.ts`, `biteship-courier-contract.ts` | Runtime settings, snapshots, rates/order/tracking |
| Biteship rates/endpoints | `biteship-rates.ts`, `biteship-public-tracking.ts`, `biteship-postal-code.ts` | Request payloads and public endpoint builders |
| Order transition rules | `order-flow-rules.ts`, `order-status.ts`, `order-manager-mutation.ts` | Status validation and mutation/rollback helpers |
| Order aggregate/types | `order-aggregate.ts`, `types.ts` | Shared order/payment/shipping contracts |
| Webhook side effects | `webhook-side-effects.ts` | Stock/cart/Biteship task processing and retries |
| Storage cleanup | `cleanup-orphan-storage.ts` | Media reference discovery and cleanup response shape |
| Notifications | `notification-helpers.ts` | Shared route constants and notification data |

## CONVENTIONS

- Keep helpers pure/testable where possible; isolate `Deno.env`, `fetch`, and Supabase clients at edges.
- Preserve existing normalization helpers instead of reimplementing status/currency/amount/courier logic in functions.
- Use explicit error messages that tests can assert, but do not include secrets.
- Runtime config log-safe values may include key name, version, masked value, and fingerprint, never plaintext `runtime_value`.
- Provider secrets and config resolve through runtime config and Vault keys such as `midtrans.server_key`, `midtrans.is_production`, `biteship.api_key`, and `push.expo_access_token`; source-guard tests should reject provider env reads or broad env dumps.
- When adding a shared helper, add/extend tests in `_shared/__tests__/`.
- Treat `_shared` edits as deployment-affecting for every importer.

## HIGH-RISK HELPERS

- `runtime-config.ts`: provider secret resolution, active/grace version semantics, cache, masking/fingerprinting.
- `midtrans.ts`: signature verification, stale/no-op payment handling, paid timestamp/currency normalization.
- `biteship.ts`: runtime settings, duplicate reference handling, immutable snapshots, request/response assertions.
- `webhook-side-effects.ts`: lease/retry behavior, stock deduction, cart cleanup, Biteship order creation.
- `cleanup-orphan-storage.ts`: managed media prefixes and reference sources.
- `order-manager-mutation.ts`: rollback snapshots for shipment/order mutations.

## TESTING

- Source-guard tests intentionally reject direct provider env reads and unsafe persistence order.
- For runtime config changes, run `runtime-config.test.ts` plus provider-specific source tests.
- For payment changes, run `midtrans.test.ts`, `midtrans-runtime-source.test.ts`, and webhook tests.
- For Biteship changes, run `biteship-*` tests plus the function-local Biteship tests.

## ANTI-PATTERNS

- **NEVER** loosen Midtrans amount/currency/signature checks to make a webhook pass.
- **NEVER** add provider config keys without matching migrations, frontend ownership, runtime config definitions, and tests.
- **NEVER** add new provider env fallbacks; migrate provider config through runtime config/Vault instead.
- **NEVER** log or return plaintext runtime config, Vault values, or provider secrets.
- **NEVER** add managed media prefixes without matching storage policies/migrations.
- **NEVER** make shared helpers depend on browser-only APIs or `import.meta.env`.
- **NEVER** change retry/idempotency semantics without updating tests and the calling function docs.
