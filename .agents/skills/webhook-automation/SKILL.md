---
name: Webhook Automation
description: Build, debug, and update Midtrans webhook and payment-notification flows for this pharmacy admin panel. Use this skill whenever the task involves Midtrans notifications, Snap checkout, payment status reconciliation, signature verification, order/payment status transitions, settlement handling, or post-payment side effects, even if the user only says "webhook", "payment callback", or "Midtrans issue".
version: 1.1.0
author: Claude Office Skills
category: integration
tags:
  - webhook
  - midtrans
  - payments
  - automation
  - supabase
department: engineering
models:
  - claude-3-opus
  - claude-3-sonnet
  - gpt-4
capabilities:
  - Midtrans notification handling
  - Snap checkout integration
  - Payment status reconciliation
  - Signature verification
  - Fulfillment side-effect orchestration
input:
  - Midtrans notification payloads
  - Order and payment records
  - Supabase Edge Function code
  - Midtrans environment configuration
output:
  - Verified payment transitions
  - Updated order and payment records
  - Safe webhook handlers
  - Auditable operational guidance
languages:
  - en
related_skills:
  - api-integration
  - zapier-automation
---

# Webhook Automation

Use this skill for Midtrans payment notifications in this codebase, not for generic webhook theory. The repo already has a concrete Midtrans flow in `supabase/functions/midtrans-webhook/`, `create-snap-token/`, `confirm-midtrans-payment/`, and `_shared/midtrans.ts`; follow that shape unless the user explicitly wants a redesign.

## What this skill should optimize for

1. **Trust only verified Midtrans state**. Validate `signature_key`, then verify the transaction again via Midtrans status API before treating a payment as successful.
2. **Keep handlers idempotent**. Duplicate or stale notifications are normal. Use transaction-aware event keys and guard transitions.
3. **Map payment changes to business state carefully**. Payment success changes both `payments.status` and `orders.status`, and may trigger stock and shipping side effects.
4. **Acknowledge quickly, do heavy work safely**. Midtrans expects a timely HTTP response. Keep the critical path short and move fulfillment side effects out of band when possible.
5. **Match repo terminology**. Use the established names: `midtrans_order_id`, `gross_amount`, `snap_token`, `snap_redirect_url`, `apply_midtrans_webhook_transition`, and `webhook_side_effect_tasks`.

## Core Midtrans flow in this repository

### 1. Checkout creation

Use `supabase/functions/create-snap-token/index.ts` as the reference flow.

- Read the order and ensure it is still payable.
- Reuse a valid `snap_token` if it already exists.
- Generate a `midtrans_order_id` if needed.
- Build the Snap payload from internal order data.
- Call Midtrans Snap:
  - Sandbox: `https://app.sandbox.midtrans.com/snap/v1/transactions`
  - Production: `https://app.midtrans.com/snap/v1/transactions`
- Authenticate with Basic auth using `MIDTRANS_SERVER_KEY`.
- Persist `snap_token`, `snap_redirect_url`, `snap_token_created_at`, and the numeric `gross_amount` back to the order.

### 2. Incoming payment notification

Use `supabase/functions/midtrans-webhook/index.ts` as the primary reference.

Expected request shape:

```json
{
  "order_id": "APT-12345678-1712670000000",
  "status_code": "200",
  "gross_amount": "150000.00",
  "signature_key": "...",
  "transaction_status": "settlement",
  "transaction_id": "...",
  "fraud_status": "accept",
  "payment_type": "bank_transfer",
  "currency": "IDR"
}
```

Required fields for initial validation in this repo:

- `order_id`
- `status_code`
- `gross_amount`
- `signature_key`

### 3. Signature verification

Midtrans notifications in this project do **not** use a generic HMAC header flow. They use Midtrans `signature_key` verification:

```text
SHA512(order_id + status_code + gross_amount + ServerKey)
```

Reference implementation: `_shared/midtrans.ts -> verifyMidtransSignature()`.

```ts
const rawString = `${orderId}${statusCode}${grossAmount}${serverKey}`;
const hashBuffer = await crypto.subtle.digest(
  "SHA-512",
  new TextEncoder().encode(rawString),
);
```

Important details:

- Use `MIDTRANS_SERVER_KEY`, not the client key.
- Use the original `gross_amount` string from Midtrans when computing the signature.
- Reject invalid signatures with `401`.

### 4. Re-verify with Midtrans before trusting success

After signature validation, verify transaction status against Midtrans:

- Sandbox base URL: `https://api.sandbox.midtrans.com/v2`
- Production base URL: `https://api.midtrans.com/v2`
- Status endpoint: `GET /{order_id}/status`

Reference implementation: `_shared/midtrans.ts -> verifyMidtransTransaction()`.

This repository deliberately does not trust a success-like webhook payload on its own. It checks Midtrans again and only accepts success when the verified status confirms it.

## Success, pending, and failure semantics

Use `_shared/midtrans.ts -> mapMidtransStatus()` and `isConfirmedMidtransSuccess()` as the source of truth.

### Treat as confirmed success

Success requires both a successful status code and a valid transaction state:

- `status_code === "200"`
- and either:
  - `transaction_status === "settlement"`
  - or `transaction_status === "capture" && fraud_status === "accept"`

### Internal mapping used by this repo

| Midtrans status | Fraud status | Internal payment status | Internal order status |
|---|---|---|---|
| `settlement` | any/none | `settlement` | `awaiting_shipment` |
| `capture` | `accept` | `settlement` | `awaiting_shipment` |
| `capture` | `challenge` | `pending` | unchanged |
| `capture` | `deny` | `deny` | `cancelled` |
| `cancel` / `deny` / `expire` | any/none | same as Midtrans | `cancelled` |
| `refund` | any/none | `refund` | unchanged |
| `partial_refund` | any/none | `partial_refund` | unchanged |
| `chargeback` | any/none | `chargeback` | unchanged |
| `partial_chargeback` | any/none | `partial_chargeback` | unchanged |
| `authorize` | any/none | `authorize` | unchanged |
| `pending` | any/none | `pending` | unchanged |
| `failure` | any/none | `deny` | `cancelled` |

## Idempotency and stale-event handling

This repo uses more than just `order_id` deduplication. Follow the existing event-key pattern so `capture+challenge` and `capture+accept` do not collapse incorrectly.

Reference implementation: `midtrans-webhook/index.ts -> buildWebhookEventKey()`.

```ts
const webhookEventKey = [
  payload.transaction_id || payload.order_id,
  payload.transaction_status,
  payload.status_code,
  payload.gross_amount,
  payload.fraud_status || "",
].join(":");
```

When deciding whether a duplicate or stale event can be ignored, follow `_shared/midtrans.ts -> isIgnorableMidtransNoop()` and the `STALE_PAYMENT_STATUS_MAP` rather than inventing new transition rules.

## Amount and currency safeguards

Do not mark a payment successful unless the amount and currency are consistent.

This repo checks:

1. Expected order amount from stored `gross_amount` or calculated order total.
2. Verified Midtrans amount from the status API.
3. Currency consistency between payload and verified status.

If the verified amount does not match the expected order amount, the current implementation returns `409` and keeps the audit trail.

## Persistence pattern used here

Use the existing write order when implementing or modifying the handler:

1. Parse JSON body.
2. Reject invalid method or malformed payload.
3. Validate signature.
4. Persist the raw notification early for auditability.
5. Re-verify status with Midtrans.
6. Load the order by `midtrans_order_id`.
7. Validate amount and currency.
8. Compute next state via `mapMidtransStatus()`.
9. Apply transition atomically through `apply_midtrans_webhook_transition`.
10. Upsert the `payments` record with `buildMidtransPaymentRecord()`.
11. Insert `order_activities` if the transition was applied.
12. Trigger side effects for confirmed settlement.

## Side effects after settlement

Settlement is not just a payment-table update.

In this codebase, confirmed settlement can lead to:

- clearing the user cart,
- saving a `webhook_side_effect_tasks` record,
- reducing stock,
- triggering Biteship fulfillment,
- logging order activity.

Reference files:

- `supabase/functions/_shared/webhook-side-effects.ts`
- `supabase/functions/midtrans-webhook/index.ts`

If you add or change webhook behavior, preserve the separation between **payment-state transition** and **post-payment fulfillment side effects**.

## HTTP response guidance for Midtrans

Use these practical rules:

- Return `200` when the event is accepted, already satisfied, or safely ignored.
- Return `401` for invalid signatures.
- Return `400` for malformed payloads.
- Return `503` for retryable conditions such as verification failure or order not found during eventual consistency windows.
- Return `409` for hard business mismatches such as amount inconsistencies.

Midtrans retries some non-2xx responses, so choose error codes deliberately. If the issue is temporary and should be retried, prefer a retry-friendly status rather than burying the event.

## Environment variables and endpoints

Use the repo’s existing env names:

- `MIDTRANS_SERVER_KEY`
- `MIDTRANS_IS_PRODUCTION`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Environment switching:

```ts
const isProduction = Deno.env.get("MIDTRANS_IS_PRODUCTION") === "true";
```

Snap endpoints:

- Sandbox: `https://app.sandbox.midtrans.com/snap/v1/transactions`
- Production: `https://app.midtrans.com/snap/v1/transactions`

Status-check endpoints:

- Sandbox: `https://api.sandbox.midtrans.com/v2/{order_id}/status`
- Production: `https://api.midtrans.com/v2/{order_id}/status`

## Working rules for future edits

When asked to implement or debug Midtrans webhook work:

1. Read these files first:
   - `supabase/functions/midtrans-webhook/index.ts`
   - `supabase/functions/_shared/midtrans.ts`
   - `supabase/functions/_shared/types.ts`
   - `supabase/functions/create-snap-token/index.ts`
2. Match the existing response helpers and logging style.
3. Reuse existing helper functions before adding new ones.
4. Keep payment logic deterministic and auditable.
5. Prefer extending transition guards and shared helpers over inlining status logic in multiple places.

## Common mistakes to avoid

- Do not use generic webhook HMAC header logic instead of Midtrans `signature_key`.
- Do not trust `transaction_status: settlement` without status re-verification for critical updates.
- Do not ignore `fraud_status` for `capture` events.
- Do not compare only `order_id`; preserve the repo’s richer event-key pattern.
- Do not update fulfillment state before the payment transition is durably applied.
- Do not hardcode production endpoints.
- Do not assume unknown Midtrans fields are errors; parse defensively.

## Example implementation checklist

Use this checklist when implementing or reviewing a Midtrans webhook task:

```md
- Parse JSON body safely
- Require order_id, status_code, gross_amount, signature_key
- Verify SHA-512 Midtrans signature
- Persist raw notification for audit trail
- Fetch canonical Midtrans status via API
- Load order by midtrans_order_id
- Validate amount and currency
- Map Midtrans status to internal payment/order state
- Apply transition idempotently
- Upsert payment record
- Trigger settlement side effects if needed
- Return the correct HTTP status
```

## Reference locations

- Official docs: Midtrans HTTP notification/webhook docs, notification best practices, and transaction status docs
- Local implementation:
  - `supabase/functions/midtrans-webhook/index.ts`
  - `supabase/functions/_shared/midtrans.ts`
  - `supabase/functions/create-snap-token/index.ts`
  - `supabase/functions/confirm-midtrans-payment/index.ts`
  - `supabase/functions/reconcile-pending-midtrans-payments/index.ts`

When this skill and the code disagree, prefer the codebase’s current shared helpers first, then reconcile them with official Midtrans docs before changing behavior.
