# Supabase Postgres Best-Practices Audit

**Date:** 2026-07-03  
**Project:** `ibmpikevzfuqtfpdpkyy`  
**Skill applied:** `/supabase-postgres-best-practices`

## Scope

1. Verify that every foreign-key column has both an index and a foreign-key constraint.
2. Verify that CHECK constraints express business-domain limits.
3. Review high sequential-scan ratios and advisor output.
4. Review RLS / SECURITY DEFINER surface for unintended exposure.

## Summary

| Area | Result |
|------|--------|
| All public tables have RLS | ✅ |
| All public tables have a primary key | ✅ |
| All public FK columns are indexed | ✅ |
| No duplicate indexes in `public` | ✅ |
| `pg_stat_statements` enabled | ✅ |
| `order_items.quantity` positive check | ✅ fixed in `20260703140000_fix_order_items_constraints.sql` |
| `order_items.source_cart_item_id` FK | ✅ fixed in `20260703140000_fix_order_items_constraints.sql` |

## Findings & Decisions

### 1. `order_items` constraint gaps (FIXED)

**Before:**
- `quantity` had only `CHECK (quantity <= 99999)` — no minimum.
- `source_cart_item_id` had an index (`order_items_source_cart_item_id_idx`) but **no foreign-key constraint**.

**Investigation:**
- 0 rows with `quantity <= 0`.
- 76 rows with `source_cart_item_id` pointing to deleted `cart_items`.

**Fix applied (`20260703140000_fix_order_items_constraints.sql`):**
- Added `order_items_quantity_positive_chk CHECK (quantity > 0)`.
- Set orphaned `source_cart_item_id` values to `NULL`.
- Added `order_items_source_cart_item_id_fkey FOREIGN KEY (source_cart_item_id) REFERENCES public.cart_items(id) ON DELETE SET NULL`.

### 2. `order_items.product_id` is nullable

**Investigation:**
- 0 rows with `product_id IS NULL`.
- Existing FK already uses `ON DELETE SET NULL`.

**Decision:** Keep nullable. In an e-commerce model, products may be hard-deleted by admins; preserving the order line while nulling `product_id` is acceptable because `product_sku_at_purchase` denormalizes the critical audit data. If the business later moves to **soft-delete products only**, this column should become `NOT NULL`.

### 3. High sequential-scan ratios

| Table | Seq Scan Ratio | Assessment |
|-------|---------------|------------|
| `webhook_side_effect_tasks` | 99.68% | Table currently has ~2 rows; seq scan is optimal. The claim query uses OR conditions on `next_retry_at`/`lease_until` plus `ORDER BY next_retry_at NULLS FIRST, created_at`. Existing partial index `due_retry_idx` is reasonable; as the table grows, consider rewriting the claim query to avoid OR or adding `(next_retry_at ASC NULLS FIRST, created_at ASC) WHERE failed_permanently_at IS NULL`. |
| `settings` | 90.22% | Single-row table; seq scan is expected. |
| `carts` | 79.74% | Investigate customer-side SELECT patterns. Index on `user_id` exists; may be small enough that planner chooses seq scan. |
| `cart_items` | 71.90% | Access is mostly through `cart_id`; index exists. Likely small table. |
| `products` | 68.81% | Admin list queries may scan; consider filtering/indexing on `is_active`, `category_id` if list performance degrades. |
| `orders` | 55.37% | `user_id` index exists; admin list may scan with filters. Monitor as order volume grows. |

**Decision:** No immediate index changes. Monitor `webhook_side_effect_tasks` volume and the orders/products admin list queries.

### 4. Security advisor findings

#### 4.1 `SECURITY DEFINER` views

Views flagged:
- `public.order_read_model`
- `public.admin_monthly_operational_metrics`
- `public.report_customer_sales`
- `public.report_daily_sales`
- `public.report_product_sales`
- `public.report_sold_products`

**Current grants:** all six are granted to `anon`, `authenticated`, `postgres`, `service_role`.

**Context:**
- The admin panel uses `order_read_model` and the four `report_*` views directly as Refine resources.
- Migration `20260401094000_fix_security_advisor_findings.sql` previously changed `report_daily_sales`, `report_customer_sales`, `report_product_sales` to `security_invoker = true`, but later migrations recreated some report views without re-applying `security_invoker`.
- `order_read_model` is intentionally `SECURITY DEFINER` to present a unified read model that combines order, payment, shipment, and profile data across ownership boundaries.

**Risk:** `SECURITY DEFINER` views bypass the caller's RLS and run as the view owner. If the underlying data is not itself filtered, authenticated users may see more than intended.

**Decision:** Do **not** change grants in this pass. Before tightening:
1. Verify `order_read_model` output is filtered by the data provider / Refine `meta.readResource` logic using `user_id` or `private.is_admin()`.
2. Decide whether to convert report views to `security_invoker = true` and add selective policies, or to keep them `SECURITY DEFINER` with explicit row filters inside the view definitions.

#### 4.2 `claim_profile_push_token`

- `SECURITY DEFINER`, executable by `authenticated`.
- Already documented as an intentional authenticated exception in:
  - `supabase/migrations/20260521071129_harden_public_rpc_grants_and_snap_lock_rls.sql`
  - `supabase/migrations/20260522201626_remediate_live_advisor_findings.sql`
  - `supabase/TASK_11_FOLLOW_UP_VERIFICATION.md`

**Decision:** No change. The function validates Expo token format, binds to `auth.uid()`, and revokes conflicting duplicate tokens only for the signed-in user.

#### 4.3 Leaked password protection

- Supabase Auth leaked-password protection is currently disabled.

**Decision:** Enable in the Supabase Dashboard under **Auth → Password Protection**. This is a product/UX decision; enabling it prevents users from signing up with known-breached passwords.

### 5. Performance advisor: unused indexes

~20 indexes flagged as unused (INFO level), mostly on `private` integration-config tables and a few on `public` tables.

**Decision:** Do **not** drop any indexes. Many support admin paths, cron jobs, or reporting queries that are run infrequently. See `supabase/INDEX_REVIEW_DECISIONS.md` for the project's index-review policy.

## Next Steps

1. Apply `20260703140000_fix_order_items_constraints.sql` to the remote database.
2. Run `pnpm test` to validate the new migration test.
3. (Optional) Enable **Leaked Password Protection** in Supabase Auth settings.
4. (Future) Review `order_read_model` / report views for `security_invoker` vs explicit in-view filters.
5. (Future) Revisit `webhook_side_effect_tasks` indexing once the table grows beyond a few thousand rows.
