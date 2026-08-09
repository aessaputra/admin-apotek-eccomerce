# Design Specification: Expired Products Monitoring & Auto-Deactivation

**Date:** 2026-08-09  
**Status:** Approved  
**Target App:** Pharmacy E-Commerce Admin Panel (`pharma/admin-panel`)  
**Stack:** React 19, Refine v5, Ant Design v5, Vite, Supabase Postgres, `pg_cron`

---

## 1. Overview & Business Intent

In a pharmacy e-commerce ecosystem, tracking product expiration dates (*near expiry*) is essential for patient safety, operational efficiency, and inventory control. 

This feature provides:
- **Simple Data Entry**: Pharmacists can enter an optional `expiry_date` and `batch_number` directly when creating or editing products.
- **Automated Safety Protection**: A daily scheduled Supabase Postgres function (`pg_cron`) automatically sets `is_active = false` on products whose expiration date has passed (`expiry_date <= CURRENT_DATE`), preventing expired medicine from being sold to online customers.
- **Internal Monitoring Dashboard**: A dedicated risk alert card on the admin dashboard (`src/pages/dashboard/index.tsx`) highlighting expired and near-expiry products (<30 days).
- **Refine Product List & Form Integration**: Expiry date tags (🔴 Expired, 🟡 Near Expiry, 🟢 Safe), filtering, quick one-click manual deactivation, and i18n support.

---

## 2. Database Schema & Migration Specs (Supabase Postgres)

### 2.1 Table Alterations (`public.products`)
Add lightweight, nullable columns to `public.products`:

```sql
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS expiry_date date NULL,
  ADD COLUMN IF NOT EXISTS batch_number text NULL;

COMMENT ON COLUMN public.products.expiry_date IS 'Expiration date of current inventory batch (YYYY-MM-DD precision)';
COMMENT ON COLUMN public.products.batch_number IS 'Manufacturer batch/lot identifier (optional)';
```

### 2.2 Performance Optimization: Partial Composite Index
Following Supabase Postgres Best Practices (`query-partial-indexes`), index only active products with an expiry date to optimize storage and query performance:

```sql
CREATE INDEX IF NOT EXISTS idx_products_active_expiry 
  ON public.products (expiry_date) 
  WHERE is_active = true AND expiry_date IS NOT NULL;
```

### 2.3 Admin Security View Update (`public.admin_products`)
Update the `admin_products` view to include `expiry_date` and `batch_number` while preserving `security_invoker = true`:

```sql
CREATE OR REPLACE VIEW public.admin_products
WITH (security_invoker = true) AS
SELECT 
  p.id,
  p.name,
  p.sku,
  p.slug,
  p.category_id,
  p.description,
  p.price,
  p.stock,
  p.weight,
  p.is_active,
  p.expiry_date,
  p.batch_number,
  p.created_at,
  p.updated_at
FROM public.products p;

-- Restrict privileges to authenticated role
REVOKE ALL ON public.admin_products FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_products TO authenticated;
```

---

## 3. Backend Logic & Automated Scheduling (`pg_cron`)

### 3.1 Auto-Deactivate Function (`public.auto_deactivate_expired_products`)
A hardened PL/pgSQL function executing atomic batch updates for expired items:

```sql
CREATE OR REPLACE FUNCTION public.auto_deactivate_expired_products()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deactivated_count int := 0;
  v_batch_size CONSTANT int := 500;
BEGIN
  WITH expired_items AS (
    SELECT id
    FROM public.products
    WHERE is_active = true
      AND expiry_date IS NOT NULL
      AND expiry_date <= CURRENT_DATE
    FOR UPDATE SKIP LOCKED
    LIMIT v_batch_size
  )
  UPDATE public.products p
  SET 
    is_active = false,
    updated_at = NOW()
  FROM expired_items e
  WHERE p.id = e.id;

  GET DIAGNOSTICS v_deactivated_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'deactivated_count', v_deactivated_count,
    'executed_at', NOW()
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'error', SQLERRM,
    'executed_at', NOW()
  );
END;
$$;

-- Security privilege revocation (Supabase Security Checklist)
REVOKE ALL ON FUNCTION public.auto_deactivate_expired_products() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_deactivate_expired_products() TO service_role;

COMMENT ON FUNCTION public.auto_deactivate_expired_products() IS 
  'Atomically deactivates products that have passed their expiry_date (runs daily via pg_cron)';
```

### 3.2 Daily Cron Schedule
Runs daily at 00:00 WIB (17:00 UTC):

```sql
SELECT cron.unschedule('auto-deactivate-expired-products-daily');

SELECT cron.schedule(
  'auto-deactivate-expired-products-daily',
  '0 17 * * *',
  $$ SELECT public.auto_deactivate_expired_products(); $$
);
```

---

## 4. Admin Frontend Architecture & Component Design

### 4.1 Dashboard Risk Alert Card (`src/pages/dashboard/index.tsx`)
- Displays an operational alert card for Expired / Near-Expiry products.
- Uses `useList` hook from `@refinedev/core` targeting `products` resource.
- Filter criteria: `expiry_date <= Today + 30 days`, `is_active = true`.
- CTA button to navigate directly to `/products` with pre-applied expiry filters.

### 4.2 Product Form (`src/pages/products/create.tsx` & `edit.tsx`)
- Added fields in Form layout:
  - `expiry_date`: `<DatePicker format="YYYY-MM-DD" style={{ width: "100%" }} />`
  - `batch_number`: `<Input placeholder="Opsional (misal: BCH-2026-0801)" allowClear />`
- Form serialization handled via `dayjs` formatting for ISO string compatibility.

### 4.3 Product List (`src/pages/products/list.tsx`)
- **Table Columns**:
  - `expiry_date`: Rendered with AntD `<Tag>`:
    - 🔴 `color="error"` ("Kedaluwarsa") for `ED <= Today`
    - 🟡 `color="warning"` ("Hampir ED") for `Today < ED <= Today + 30d`
    - 🟢 Default for `ED > Today + 30d`
  - `batch_number`: Rendered with `<Text code>` or `-`.
- **Filter Toolbar**: Expiry status filter dropdown (`All`, `Near Expiry (<30 Days)`, `Expired`).
- **Quick Action**: Single-click "Deactivate" (`is_active = false`) button in row action column.

### 4.4 i18n Translations (`src/locales/id/common.json` & `src/locales/en/common.json`)
Ensure synchronized key additions across Indonesian (`id`) and English (`en`) namespaces.

---

## 5. Verification & Testing Strategy

1. **Database Migration Test**:
   - Run migration against local Supabase.
   - Verify index creation (`idx_products_active_expiry`) and view privileges on `admin_products`.
2. **Function Unit/Integration Test**:
   - Create test script inserting active product with `expiry_date = CURRENT_DATE - INTERVAL '1 day'`.
   - Call `auto_deactivate_expired_products()`.
   - Assert `is_active = false` and `deactivated_count = 1`.
3. **Frontend Component Test**:
   - Run `pnpm test` and Vitest suites to confirm no regressions in product list, create, edit, or dashboard rendering.
