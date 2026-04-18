begin;

create or replace view public.report_daily_sales
with (security_invoker = true)
as
select
  date_trunc('day', orm.created_at)::date as sale_date,
  count(*) as orders_count,
  sum(orm.total_amount) as total_revenue,
  avg(orm.total_amount) as average_order_value
from public.order_read_model orm
where orm.payment_status = 'settlement'::public.payment_status
group by date_trunc('day', orm.created_at)::date
order by date_trunc('day', orm.created_at)::date desc;

create or replace view public.report_product_sales
with (security_invoker = true)
as
select
  p.id as product_id,
  p.name as product_name,
  c.name as category_name,
  sum(oi.quantity) as total_qty_sold,
  sum(oi.quantity::numeric * oi.price_at_purchase) as total_revenue
from public.order_items oi
join public.order_read_model orm on orm.id = oi.order_id
join public.products p on p.id = oi.product_id
left join public.categories c on c.id = p.category_id
where orm.payment_status = 'settlement'::public.payment_status
group by p.id, p.name, c.name
order by sum(oi.quantity) desc;

create or replace view public.report_customer_sales
with (security_invoker = true)
as
select
  u.id as user_id,
  u.full_name,
  u.phone_number,
  count(orm.id) as orders_count,
  sum(orm.total_amount) as total_revenue
from public.order_read_model orm
join public.profiles u on u.id = orm.user_id
where orm.payment_status = 'settlement'::public.payment_status
group by u.id, u.full_name, u.phone_number
order by sum(orm.total_amount) desc;

comment on view public.report_daily_sales is
  'Daily sales report sourced from canonical order_read_model payment state.';

comment on view public.report_product_sales is
  'Product sales report sourced from canonical order_read_model payment state.';

comment on view public.report_customer_sales is
  'Customer sales report sourced from canonical order_read_model payment state.';

commit;
