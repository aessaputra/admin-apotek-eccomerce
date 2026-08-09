-- ============================================================================
-- Migration: Add Expired Products Schema, Auto-Deactivate Function & Daily Cron
-- Description: Adds expiry_date and batch_number columns to products,
--              updates admin_products view, creates auto-deactivation function,
--              and schedules daily pg_cron job at 00:00 WIB (17:00 UTC).
-- ============================================================================

-- 1. Add columns to products table
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS expiry_date date,
  ADD COLUMN IF NOT EXISTS batch_number text;

COMMENT ON COLUMN public.products.expiry_date IS 'Expiration date of current inventory batch (YYYY-MM-DD precision)';
COMMENT ON COLUMN public.products.batch_number IS 'Manufacturer batch/lot identifier (optional)';

-- 2. Partial index for fast lookup of active products with an expiry date
CREATE INDEX IF NOT EXISTS idx_products_active_expiry
  ON public.products (expiry_date)
  WHERE is_active = true AND expiry_date IS NOT NULL;

-- 3. Update private admin function to include expiry_date and batch_number
CREATE OR REPLACE FUNCTION private.admin_products_for_current_user()
RETURNS TABLE (
  id uuid,
  category_id uuid,
  category_name text,
  category_slug text,
  name text,
  slug text,
  description text,
  price numeric(12,2),
  stock integer,
  is_active boolean,
  weight integer,
  sku text,
  expiry_date date,
  batch_number text,
  created_at timestamptz,
  updated_at timestamptz,
  images jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  select
    p.id,
    p.category_id,
    c.name as category_name,
    c.slug as category_slug,
    p.name,
    p.slug,
    p.description,
    p.price,
    p.stock,
    p.is_active,
    p.weight,
    p.sku,
    p.expiry_date,
    p.batch_number,
    p.created_at,
    p.updated_at,
    coalesce(pi.images, '[]'::jsonb) as images
  from public.products p
  left join public.categories c on c.id = p.category_id
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'id', product_images.id,
        'url', product_images.url,
        'sort_order', product_images.sort_order,
        'created_at', product_images.created_at
      )
      order by product_images.sort_order asc, product_images.created_at asc
    ) as images
    from public.product_images
    where product_images.product_id = p.id
  ) pi on true
  where (select private.is_admin());
$$;

-- 4. Recreate admin_products view with new columns
DROP VIEW IF EXISTS public.admin_products;
CREATE VIEW public.admin_products
WITH (security_invoker = true, security_barrier = true)
AS
SELECT
  id,
  category_id,
  category_name,
  category_slug,
  name,
  slug,
  description,
  price::numeric(12,2) as price,
  stock,
  is_active,
  weight,
  sku,
  expiry_date,
  batch_number,
  created_at,
  updated_at,
  images
FROM private.admin_products_for_current_user();

COMMENT ON VIEW public.admin_products IS
  'Security-invoker admin product read model backed by a private admin-gated function so Supabase API views do not run with SECURITY DEFINER semantics.';

REVOKE ALL ON TABLE public.admin_products FROM authenticated;
GRANT SELECT ON TABLE public.admin_products TO authenticated;
REVOKE ALL ON TABLE public.admin_products FROM public, anon;

-- 5. Auto-deactivate expired products function
CREATE OR REPLACE FUNCTION public.auto_deactivate_expired_products()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deactivated_count int := 0;
  v_batch_size int := 500;
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
    updated_at = now()
  FROM expired_items e
  WHERE p.id = e.id;

  GET DIAGNOSTICS v_deactivated_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'deactivated_count', v_deactivated_count,
    'executed_at', now()
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'error', sqlerrm,
    'executed_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.auto_deactivate_expired_products() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_deactivate_expired_products() TO service_role;

COMMENT ON FUNCTION public.auto_deactivate_expired_products() IS
  'Atomically deactivates products that have passed their expiry_date (runs daily via pg_cron)';

-- 6. Schedule daily cron at 00:00 WIB (17:00 UTC)
SELECT cron.unschedule('auto-deactivate-expired-products-daily');

SELECT cron.schedule(
  'auto-deactivate-expired-products-daily',
  '0 17 * * *',
  $$ SELECT public.auto_deactivate_expired_products(); $$
);
