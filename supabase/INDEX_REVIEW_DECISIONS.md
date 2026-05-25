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

## 2026-05-22 Live Advisor Run: Unused-Index Decisions

Source: `.omo/evidence/task-1-advisor-snapshot.md`, section 7. The live advisor run reported 19 `unused_index` findings, each with `idx_scan = 0`, `idx_tup_read = 0`, `idx_tup_fetch = 0`, and `indisvalid = true` at snapshot time. This section records the investigation-first decision state only; it does not authorize index drops.

Decision vocabulary:

- `keep`: retain because the index supports an FK, currently known operational path, cron/system path, admin path, or customer path.
- `defer`: retain for now because the advisor signal is insufficient without live query-shape or replacement-index evidence.
- `drop-candidate`: only for indexes with complete evidence proving no FK/constraint role, no current or expected operational path, and no needed replacement index.

| Schema | Table | Index | Advisor status | Decision | Rationale |
|---|---|---|---|---|---|
| `private` | `order_integration_config_snapshots` | `order_integration_config_snapshots_shipment_idx` | `unused_index` | `keep` | Covers the `shipment_id` FK to `public.shipments(id)` on a private service-role snapshot table. Task 1 only proves zero scans at one snapshot, so do not repeat prior FK-support drop mistakes. |
| `private` | `order_integration_config_snapshots` | `order_integration_config_snapshots_created_idx` | `unused_index` | `defer` | Created for recency ordering on Biteship/runtime configuration snapshots. The table is new, private, and service-role driven; no complete evidence proves the recency index is dead. |
| `public` | `order_activities` | `idx_order_activities_created_at` | `unused_index` | `defer` | Activity timelines and delivery backfill logic order by `created_at`; existing evidence suggests a future composite replacement might be better than a blind drop. |
| `private` | `integration_config_versions` | `integration_config_versions_key_status_created_idx` | `unused_index` | `keep` | Runtime configuration lookups filter by key and active/grace status for service-role Edge Function paths. Keep until live query plans prove a replacement or redundancy. |
| `private` | `integration_config_versions` | `integration_config_versions_vault_secret_idx` | `unused_index` | `keep` | Supports secret-version rows tied to `vault.secrets(id)` and runtime secret resolution. Treat as FK/secret-management support, not a drop candidate. |
| `private` | `integration_config_audit_logs` | `integration_config_audit_logs_key_created_idx` | `unused_index` | `keep` | Admin integration-config audit RPC filters by `key_name` and orders by recent events, matching this index shape. |
| `private` | `integration_config_audit_logs` | `integration_config_audit_logs_actor_created_idx` | `unused_index` | `defer` | Actor-based audit investigation is an admin/forensic path. No repo evidence proves it is unnecessary, and audit indexes should not be dropped from advisor output alone. |
| `private` | `integration_config_audit_logs` | `integration_config_audit_logs_request_idx` | `unused_index` | `defer` | Request-id correlation is an operational debugging path for service-role config changes. Keep pending production log/query evidence. |
| `public` | `orders` | `orders_customer_completed_by_idx` | `unused_index` | `keep` | Supports the nullable `customer_completed_by` FK to `auth.users(id)` and was added during advisor remediation. Do not mark FK-support indexes as drop candidates. |
| `private` | `midtrans_payment_config_bindings` | `midtrans_payment_config_bindings_server_key_version_idx` | `unused_index` | `defer` | Related to the server-key version FK and Midtrans config binding service path. It is not a full 3-column FK cover, so defer until a complete covering replacement and query evidence exist. |
| `private` | `midtrans_payment_config_bindings` | `midtrans_payment_config_bindings_is_production_version_idx` | `unused_index` | `defer` | Related to the is-production version FK and Midtrans config binding service path. It is not a full 3-column FK cover, so defer until a complete covering replacement and query evidence exist. |
| `public` | `order_items` | `order_items_source_cart_item_id_idx` | `unused_index` | `keep` | Checkout persists selected cart provenance and webhook side-effect cart cleanup validates `order_items.source_cart_item_id`. Keep this operational provenance index. |
| `public` | `profile_push_tokens` | `profile_push_tokens_user_active_seen_idx` | `unused_index` | `keep` | Push delivery loads active profile push tokens by `user_id`, `revoked_at is null`, ordered by `last_seen_at desc`; this matches the customer/admin notification path. |
| `public` | `webhook_side_effect_tasks` | `webhook_side_effect_tasks_lease_idx` | `unused_index` | `keep` | Cron and Edge Function processors gate due work on `lease_until`; zero scans are not representative when queue volume is low. |
| `public` | `orders` | `orders_delivered_completion_idx` | `unused_index` | `keep` | Supports customer completion windows for delivered orders and the customer order bucket lifecycle. Feature traffic may be low, but this is an active customer path. |
| `public` | `order_item_stock_deductions` | `idx_order_item_stock_deductions_product_id` | `unused_index` | `keep` | Supports the `product_id` FK to `public.products(id)` and was restored after a prior drop caused FK advisor regressions. |
| `public` | `shipments` | `shipments_waybill_overridden_by_idx` | `unused_index` | `keep` | Supports the nullable `waybill_overridden_by` FK and was restored after a prior drop caused FK advisor regressions. |
| `public` | `notification_push_deliveries` | `notification_push_deliveries_user_created_idx` | `unused_index` | `keep` | Leading `user_id` supports FK maintenance and user delivery history/audit access on service-role push delivery records. |
| `public` | `orders` | `orders_payment_status_created_idx` | `unused_index` | `defer` | Admin and customer order flows filter by payment status and order recency through order views/RPCs. Verify live plans before deciding whether this direct orders index is redundant. |

2026-05-22 summary: `keep` = 12, `defer` = 7, `drop-candidate` = 0. No migration should be generated from this advisor signal alone.

## 2026-05-25 Task 11 Review: 26 Unused-Index Advisor Signals

Source: `.omo/evidence/task-9-production-readonly-audit.md`, lines 77-81 and 108-115. That evidence preserves only a redacted table-level summary of 26 `unused_index` INFO lints from the 2026-05-24 read-only production audit; it does not preserve every index name. This Task 11 pass therefore records conservative table-level decisions and follow-up requirements rather than authorizing any migration.

Decision state for this sanitized signal:

| Surface | Advisor signal | Decision | Rationale |
|---|---|---|---|
| `private.order_integration_config_snapshots` | `unused_index` | `keep/defer` | Snapshot rows support service-role Biteship/Midtrans provenance and include FK-backed shipment/creator relationships plus recency/debug lookup paths. Keep FK support; defer non-FK recency indexes until an index-level advisor export and query plan review prove redundancy. |
| `private.integration_config_versions` and `private.integration_config_current_versions` | `unused_index` | `keep/defer` | Runtime config resolution is service-role critical for Edge Functions and Vault-backed config. FK support for creator/active-version relationships and active/grace lookup paths is more important than one low-traffic stats window. |
| `private.integration_config_audit_logs` | `unused_index` | `keep/defer` | Admin audit and incident-debug paths filter by config key, actor, request ID, and version. These are low-frequency forensic paths; advisor usage counters alone are insufficient to drop them. |
| `private.midtrans_payment_config_bindings` | `unused_index` | `keep/defer` | Payment verification binds Midtrans transactions to runtime config versions. Keep exact FK-covering indexes and defer older partial binding indexes until a replacement plan is reviewed. |
| `public.order_activities` | `unused_index` | `defer` | Admin/customer timelines and payment/shipment investigations use order activity history. Current evidence suggests a future `(order_id, created_at desc)` replacement may be better than dropping `created_at`-only support. |
| `public.orders` | `unused_index` | `keep/defer` | Order status, payment status, customer completion, cancellation cron, and admin/customer read-model paths are active or low-frequency operational flows. FK support such as `customer_completed_by` stays kept. |
| `public.order_items` and `public.order_item_stock_deductions` | `unused_index` | `keep` | Checkout provenance, cart cleanup validation, stock-deduction audit, and product FK maintenance rely on these tables. Product/source-cart indexes must not be dropped without FK and cleanup-path proof. |
| `public.profile_push_tokens` and `public.notification_push_deliveries` | `unused_index` | `keep` | Push delivery loads active tokens by user/recency and records delivery history. These support service-role push operations, token cleanup, receipt checks, and FK/user history paths. |
| `public.webhook_side_effect_tasks` | `unused_index` | `keep` | Cron/worker retry and lease pickup are bursty and may show low scan counts when the queue is empty. Keep lease/retry support for settlement fulfillment reliability. |
| `public.shipments` | `unused_index` | `keep/defer` | Shipment admin/debug flows and nullable waybill override FK support require care. Prior drops already caused FK-support regressions, so no shipment index should be dropped from `unused_index` alone. |

Task 11 conclusion: no 2026-05-25 index migration is warranted. A future approved review must first capture a redacted index-level advisor export, map every index to FK constraints and query paths, sample `pg_stat_statements`/`EXPLAIN` for candidate replacements, then update this document before creating any drop migration.

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
