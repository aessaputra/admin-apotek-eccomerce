# Biteship Webhook Function

**Purpose:** Receive real-time shipping status updates from Biteship via webhook, replacing the need for manual "Sync Tracking" clicks in the admin panel.

## FILES

| File | Role |
|------|------|
| `index.ts` | Deno runtime entry point; no JWT verification (external webhook) |
| `handler.ts` | Event router and processor for `order.status`, `order.waybill_id`, `order.price` |
| `__tests__/index.test.ts` | Unit tests for all webhook event flows |

## EVENTS HANDLED

| Biteship Event | What it does |
|----------------|-------------|
| `order.status` | Maps Biteship status → internal status, updates `orders` + `shipments`, logs `webhook_tracking` or `shipment_tracking_exception` activity, sends push notification |
| `order.waybill_id` | Updates waybill number and tracking ID on the `shipments` row |
| `order.price` | Acknowledged and logged; no DB mutation (future: update shipping cost) |

## SECURITY

- `verify_jwt = false` because Biteship sends webhooks without JWT
- Optional `BITESHIP_WEBHOOK_SECRET` env var validated from `?secret=` query parameter
- Order lookup validates that `biteship_order_id` exists in `shipments` table (second gate)
- All unknown or unmatched payloads return `200` with `status: "ignored"` to prevent retries

## STATUS MAPPING

Reuses `_shared/order-status.ts` (`resolveBiteshipStatus`) — same mapping as `order-manager sync_tracking`:

| Biteship Status | Internal Status |
|-----------------|----------------|
| confirmed, allocated, scheduled, picking_up | awaiting_shipment |
| picked, picked_up | shipped |
| dropping_off, delivering, in_transit | in_transit |
| delivered | delivered |
| on_hold, rejected, courier_not_found, etc. | Exception (keep current) |

## GUARDS

- **Idempotency:** Skips if `latest_biteship_status` already matches incoming status
- **Forward-only:** Never moves order status backward (same as order-manager)
- **Payment guard:** Stores biteship status but won't advance order if payment isn't settled
- **Terminal guard:** Won't process status changes for delivered/cancelled orders
- **Waybill guard:** Won't set shipped without a waybill number

## COORDINATION

- Frontend activity display: `src/pages/orders/components/OrderActivities.tsx` (already recognizes `webhook_tracking`)
- Manual fallback: `order-manager sync_tracking` action remains available for admin override
- Biteship Dashboard config: Admin must register webhook URL in Biteship → Integrations → Webhook

## CONFIGURATION

1. Set `BITESHIP_WEBHOOK_SECRET` in Supabase Edge Function secrets (optional but recommended)
2. In Biteship Dashboard, add webhook URL:
   `https://<PROJECT_REF>.supabase.co/functions/v1/biteship-webhook?secret=<SECRET>`
3. Subscribe to events: `order.status`, `order.waybill_id` (optional: `order.price`)

## TESTING

```bash
pnpm vitest run supabase/functions/biteship-webhook/__tests__/index.test.ts
```

## ANTI-PATTERNS

- **NEVER** expose `BITESHIP_WEBHOOK_SECRET` in client code
- **NEVER** trust client-provided status without resolving through `resolveBiteshipStatus`
- **NEVER** skip the forward-only check — backward status transitions corrupt order state
- **NEVER** skip the payment settlement guard — fulfillment requires settled payment
- **NEVER** return non-200 for unknown orders — Biteship will retry indefinitely
