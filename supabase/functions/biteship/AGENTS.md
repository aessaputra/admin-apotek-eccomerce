# Biteship Function

**Purpose:** Server-side proxy for Biteship rates, maps/areas, courier lists, draft order creation, and customer-safe public tracking.

## FILES

| File | Role |
|------|------|
| `index.ts` | Deno runtime wiring and manual JWT verification setup |
| `handler.ts` | Testable action router and Biteship request validation |
| `__tests__/index.test.ts` | Runtime config, auth, rates, maps, courier, tracking tests |

## ACTIONS

| Action | Caller | Notes |
|--------|--------|-------|
| `rates` | authenticated customer/admin | Server-owned origin/shipper config; destination from payload |
| `maps` | authenticated user | Area search proxy; never expose Biteship API key |
| `couriers` | authenticated user; settings UI is the current caller | Live courier list for settings; fallback handled in frontend hook |
| `draft_order` | authenticated caller from server/admin flow | Server injects shipper/origin fields; handler currently verifies JWT but does not role-gate this action |
| `track_public` | authenticated order owner | Uses stored order waybill/courier and filters `order_read_model.user_id`; no admin override path |

Direct `create_order` and direct `track` are disabled for browser clients.

## RUNTIME CONFIG

- Biteship API key, enabled couriers, origin area/postal/coordinates, and shipper fields resolve through `_shared/runtime-config.ts`, `_shared/biteship.ts`, Admin Settings, and Vault keys such as `biteship.api_key`.
- Handler fails closed when `biteship.api_key` runtime config is missing or when non-secret runtime config required for `rates`/`draft_order` is incomplete.
- Legacy `settings` drift is diagnostic only; do not reintroduce legacy settings as the source of truth.
- Instant courier companies/services are normalized through `_shared/biteship-courier-contract.ts`.

## COORDINATION

- Frontend callers: `src/hooks/useBiteshipCouriers.ts`, `src/components/biteship-area-search/`, `src/pages/settings/shipping-settings-panel.tsx`.
- Fulfillment callers: `order-manager`, `_shared/webhook-side-effects.ts`, `_shared/biteship.ts`.
- Schema/config migrations: `*integration_config*`, `*biteship*snapshot*`, and Biteship settings backfill migrations.

## TESTING

```bash
pnpm vitest run supabase/functions/biteship/__tests__/index.test.ts
pnpm vitest run supabase/functions/_shared/__tests__/biteship-order.test.ts
pnpm vitest run supabase/functions/_shared/__tests__/biteship-rates.test.ts
pnpm vitest run supabase/functions/_shared/__tests__/biteship-runtime-source.test.ts
```

## ANTI-PATTERNS

- **NEVER** expose or return the Biteship API key to clients.
- **NEVER** add provider env fallbacks for Biteship secrets or broaden runtime config lookup beyond Admin Settings and Vault.
- **NEVER** call upstream Biteship with missing origin/shipper/runtime config.
- **NEVER** trust client-provided order IDs without owner/admin checks.
- **NEVER** save frontend fallback courier rows as live enabled-courier config.
- **NEVER** bypass immutable order config snapshots for fulfillment creation.
