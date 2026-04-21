# Index Review Decisions

## Context

This document records the current decision state for remaining Supabase Performance Advisor index warnings after the April 21, 2026 hardening and cleanup work.

The key operational lesson is:

- `unused_index` and `unindexed_foreign_keys` measure different things.
- An index can have `idx_scan = 0` and still be worth keeping if it supports foreign-key maintenance.
- Index cleanup must be based on both **live query evidence** and **schema/constraint role**, not advisor output alone.

## Current State

Applied migrations relevant to this review:

1. `20260421115036_fix_remaining_advisor_findings.sql`
2. `20260421120319_drop_confirmed_unused_indexes.sql`
3. `20260421120447_restore_fk_support_indexes.sql`

The following indexes were dropped and intentionally remain removed because they had no convincing active query path and no FK-support requirement:

- `webhook_side_effect_tasks_cart_cleanup_idx`
- `webhook_idempotency_provider_created_idx`
- `storage_cleanup_runs_finished_at_idx`
- `shipments_courier_status_idx`

The following indexes were restored because removing them caused `unindexed_foreign_keys` advisor findings:

- `shipments_waybill_overridden_by_idx`
- `idx_order_item_stock_deductions_product_id`

## Decision Table

### Keep

These should remain in place for now.

| Index | Decision | Why |
|---|---|---|
| `shipments_waybill_overridden_by_idx` | **KEEP** | Supports FK coverage for `shipments.waybill_overridden_by`. Even though query scans are zero, dropping it triggered `unindexed_foreign_keys`. |
| `idx_order_item_stock_deductions_product_id` | **KEEP** | Supports FK coverage for `order_item_stock_deductions.product_id`. Same reasoning: not query-hot, but still needed for FK maintenance best practice. |
| `orders_delivered_completion_idx` | **KEEP** | Feature is new and traffic is still low. It is aligned with delivered/completion flows and may become relevant as customer confirmation usage grows. |
| `orders_customer_completed_by_idx` | **KEEP** | New index added to satisfy FK coverage for `orders.customer_completed_by`. It is not yet query-hot, but removing it would likely reintroduce FK coverage concerns. |
| `webhook_side_effect_tasks_lease_idx` | **KEEP** | Table currently has zero rows, so live stats are not representative. This index may still help cron/lease-based task pickup under production load. |

### Monitor

These are not strong enough drop candidates yet, but they should be revisited with more evidence.

| Index | Decision | Why |
|---|---|---|
| `idx_order_activities_created_at` | **MONITOR** | Live query shape is more strongly aligned to `(order_id, created_at desc)` than `created_at desc` alone. This may be replaceable later, but dropping should be paired with a better composite index if needed. |
| `idx_order_items_product_id` | **MONITOR** | Advisor still flags it as unused. There is no strong application query path for product-only filtering in current repo evidence, but this one should be rechecked carefully before dropping because it exists live and may reflect older usage not fully visible in current code. |

### Already Dropped

These were high-confidence dead indexes and were intentionally removed.

| Index | Decision | Why |
|---|---|---|
| `webhook_side_effect_tasks_cart_cleanup_idx` | **DROPPED** | `needs_cart_cleanup` is written as a flag but not used as a database filter in the active processing query. |
| `webhook_idempotency_provider_created_idx` | **DROPPED** | Active idempotency logic uses `(provider, event_key)`, not `(provider, created_at)`. |
| `storage_cleanup_runs_finished_at_idx` | **DROPPED** | Actual code paths read by `status` and `started_at`, not `finished_at`. |
| `shipments_courier_status_idx` | **DROPPED** | Shipment reads in current code are driven by `order_id`, not by `(courier_code, status, updated_at)`. |

## Evidence Summary

Evidence used for decisions came from these sources:

1. Supabase Performance Advisor warnings
2. `pg_stat_user_indexes.idx_scan`
3. `pg_stat_statements` live query shapes
4. Repository query/code-path review
5. Foreign-key coverage checks and advisor feedback after drops

## Operational Guidance

### Safe rule

Do **not** drop an index solely because Supabase labels it `unused`.

Before dropping, check all of the following:

1. Does the index support a foreign key column?
2. Does dropping it trigger `unindexed_foreign_keys`?
3. Is there a low-frequency admin/cron/system flow that may still depend on it?
4. Is the current query shape actually asking for a different replacement index rather than no index at all?

### Suggested next review window

Revisit the remaining `KEEP` / `MONITOR` indexes after one of these conditions:

- meaningful growth in order / shipment / activity volume,
- one full production cycle of customer completion flow,
- enough webhook side-effect task rows to observe real lease-query behavior,
- or a future performance investigation specifically around order history / activity timelines.

## Current Recommendation

No further index cleanup should be done immediately.

The current state is intentionally conservative:

- high-confidence dead indexes are already removed,
- FK-support indexes are restored and retained,
- ambiguous indexes are kept until stronger evidence exists.
