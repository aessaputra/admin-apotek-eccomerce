begin;

-- Supabase advisors flag public views that run with SECURITY DEFINER semantics.
-- Keep the public API as security_invoker views, while moving the privileged
-- SKU reads into private SECURITY DEFINER functions that still return rows only
-- when private.is_admin() is true.
create or replace function private.admin_products_for_current_user()
returns table (
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
  created_at timestamptz,
  updated_at timestamptz,
  images jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
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

create or replace function private.admin_order_items_for_current_user()
returns table (
  id uuid,
  order_id uuid,
  product_id uuid,
  product_name text,
  quantity integer,
  price_at_purchase numeric(12,2),
  product_sku_at_purchase text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    oi.id,
    oi.order_id,
    oi.product_id,
    p.name as product_name,
    oi.quantity,
    oi.price_at_purchase,
    oi.product_sku_at_purchase,
    oi.created_at
  from public.order_items oi
  left join public.products p on p.id = oi.product_id
  where (select private.is_admin());
$$;

revoke all on function private.admin_products_for_current_user() from public, anon, authenticated;
revoke all on function private.admin_order_items_for_current_user() from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.admin_products_for_current_user() to authenticated;
grant execute on function private.admin_order_items_for_current_user() to authenticated;

create or replace view public.admin_products
with (security_invoker = true, security_barrier = true)
as
select
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
  created_at,
  updated_at,
  images
from private.admin_products_for_current_user();

create or replace view public.admin_order_items
with (security_invoker = true, security_barrier = true)
as
select
  id,
  order_id,
  product_id,
  product_name,
  quantity,
  price_at_purchase::numeric(12,2) as price_at_purchase,
  product_sku_at_purchase,
  created_at
from private.admin_order_items_for_current_user();

comment on function private.admin_products_for_current_user() is
  'Private admin-only product read function used by public.admin_products; exposes SKU only when private.is_admin() is true.';

comment on function private.admin_order_items_for_current_user() is
  'Private admin-only order-item read function used by public.admin_order_items; exposes historical SKU snapshots only when private.is_admin() is true.';

comment on view public.admin_products is
  'Security-invoker admin product read model backed by a private admin-gated function so Supabase API views do not run with SECURITY DEFINER semantics.';

comment on view public.admin_order_items is
  'Security-invoker admin order-item read model backed by a private admin-gated function so Supabase API views do not run with SECURITY DEFINER semantics.';

revoke all on table public.admin_products from authenticated;
grant select on table public.admin_products to authenticated;
revoke all on table public.admin_products from public, anon;

revoke all on table public.admin_order_items from authenticated;
grant select on table public.admin_order_items to authenticated;
revoke all on table public.admin_order_items from public, anon;

commit;
