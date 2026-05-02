begin;

create or replace view public.report_sold_products
with (security_invoker = true, security_barrier = true)
as
select
  oi.id as id,
  orm.created_at as order_created_at,
  date_trunc('day', orm.created_at)::date as sale_date,
  p.name as product_name,
  oi.quantity,
  oi.price_at_purchase::numeric(12,2) as unit_price,
  (oi.quantity::numeric * oi.price_at_purchase)::numeric(12,2) as subtotal
from public.order_items oi
join public.order_read_model orm on orm.id = oi.order_id
left join public.products p on p.id = oi.product_id
where orm.payment_status = 'settlement'::public.payment_status;

comment on view public.report_sold_products is
  'Line-item sold-products report sourced from order_items and canonical order_read_model settlement/created_at sales semantics.';

revoke all on table public.report_sold_products from authenticated;
grant select on table public.report_sold_products to authenticated;
revoke all on table public.report_sold_products from public, anon;

commit;
