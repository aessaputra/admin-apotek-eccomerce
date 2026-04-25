begin;

-- The admin SKU views intentionally expose SKU only through private.is_admin(),
-- but authenticated should have SELECT on those views and no write-like grants.
revoke all on table public.admin_products from authenticated;
grant select on table public.admin_products to authenticated;
revoke all on table public.admin_products from public, anon;

revoke all on table public.admin_order_items from authenticated;
grant select on table public.admin_order_items to authenticated;
revoke all on table public.admin_order_items from public, anon;

commit;
