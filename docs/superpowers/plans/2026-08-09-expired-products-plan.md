# Implementation Plan: Expired Products Monitoring & Auto-Deactivation

**Date:** 2026-08-09  
**Spec Document:** [docs/superpowers/specs/2026-08-09-expired-products-design.md](file:///home/coder/dev/pharma/admin-panel/docs/superpowers/specs/2026-08-09-expired-products-design.md)  
**Target:** Pharmacy Admin Panel (`pharma/admin-panel`)

---

## Approach

Implement a complete Expired Products monitoring and safety system by:
1. Creating a timestamped Supabase migration for schema additions (`expiry_date`, `batch_number`), partial index (`idx_products_active_expiry`), `admin_products` view update, and a daily `pg_cron` auto-deactivation job.
2. Adding i18n translation keys in `id` and `en` namespaces.
3. Updating Refine `products` form (`create.tsx`, `edit.tsx`) with DatePicker and batch number input.
4. Enhancing `products/list.tsx` with color-coded expiry status tags, filter controls, and a quick-deactivate action.
5. Adding an Expired Risk Alert widget to `src/pages/dashboard/index.tsx`.

---

## Scope

### In Scope
- Database schema changes (`expiry_date`, `batch_number` on `products`).
- Partial indexing and `security_invoker = true` view update (`admin_products`).
- PL/pgSQL `auto_deactivate_expired_products()` function & `pg_cron` daily schedule.
- Refine v5 Product List, Create, Edit page updates.
- Dashboard Expired Risk Alert Card.
- i18n localization (`id`, `en`).
- Empirical verification via `pnpm build` and `pnpm test`.

### Out of Scope
- Multi-warehouse lot batching matrix (kept simple per requirements).
- Customer frontend modifications (customer app already filters `is_active = true`).

---

## Action Items

- [ ] **Task 1**: Create Supabase SQL migration file `supabase/migrations/20260809200000_add_expired_products_schema_and_cron.sql` with schema additions, partial index, view update, PL/pgSQL function, and `pg_cron` schedule.
- [ ] **Task 2**: Update i18n locale files (`src/locales/id/common.json` and `src/locales/en/common.json`) with new translation keys for expiry fields, badges, and alerts.
- [ ] **Task 3**: Update Product Create & Edit forms (`src/pages/products/create.tsx` and `src/pages/products/edit.tsx`) to support `expiry_date` (DatePicker with dayjs) and `batch_number` (Input).
- [ ] **Task 4**: Update Product List page (`src/pages/products/list.tsx`) to add expiry tags (🔴 Expired, 🟡 Near Expiry, 🟢 Safe), batch number column, expiry filter dropdown, and quick deactivate action button.
- [ ] **Task 5**: Add Expired Products Risk Alert Card and Refine `useList` query to `src/pages/dashboard/index.tsx`.
- [ ] **Task 6**: Run verification tests (`pnpm build` and `pnpm test`) to ensure zero TypeScript errors or broken tests.
- [ ] **Task 7**: Commit implementation changes to git.

---

## Validation Plan

1. **Type & Build Check**: Run `pnpm build` (tsc & vite build) to verify TypeScript strictness and chunk generation.
2. **Unit & Component Test**: Run `pnpm test` (Vitest) to verify existing and new tests pass cleanly without errors.
