begin;

-- 1. Recreate report_daily_sales with cancelled filter
drop view if exists public.report_daily_sales;
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
  and orm.status != 'cancelled'::public.order_status
group by date_trunc('day', orm.created_at)::date
order by date_trunc('day', orm.created_at)::date desc;

-- 2. Recreate report_product_sales with cancelled filter
drop view if exists public.report_product_sales;
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
  and orm.status != 'cancelled'::public.order_status
group by p.id, p.name, c.name
order by sum(oi.quantity) desc;

-- 3. Recreate report_customer_sales with cancelled filter
drop view if exists public.report_customer_sales;
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
  and orm.status != 'cancelled'::public.order_status
group by u.id, u.full_name, u.phone_number
order by sum(orm.total_amount) desc;

-- 4. Recreate report_sold_products with cancelled filter
drop view if exists public.report_sold_products;
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
where orm.payment_status = 'settlement'::public.payment_status
  and orm.status != 'cancelled'::public.order_status;

-- 5. Recreate admin_operational_metrics RPC with cancelled filter
create or replace function public.admin_operational_metrics(
  p_granularity text,
  p_start_date date default null,
  p_end_date date default null
)
returns table (
  bucket_start date,
  bucket_end date,
  order_count bigint,
  paid_order_count bigint,
  completed_order_count bigint,
  revenue numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_granularity text;
  normalized_start_date date;
  normalized_end_date date;
  step_interval interval;
  first_bucket_start date;
  last_bucket_start date;
begin
  if not (select auth.role() = 'authenticated' and (auth.jwt() ->> 'role') = 'admin') then
    raise exception 'Unauthorized';
  end if;

  normalized_granularity := lower(coalesce(p_granularity, 'day'));
  if normalized_granularity not in ('day', 'week', 'month', 'year') then
    normalized_granularity := 'day';
  end if;

  normalized_start_date := coalesce(p_start_date, (timezone('Asia/Jakarta', now()) - interval '30 days')::date);
  normalized_end_date := coalesce(p_end_date, timezone('Asia/Jakarta', now())::date);

  if normalized_start_date > normalized_end_date then
    normalized_start_date := normalized_end_date;
  end if;

  step_interval := case normalized_granularity
    when 'day' then interval '1 day'
    when 'week' then interval '1 week'
    when 'month' then interval '1 month'
    else interval '1 year'
  end;
  first_bucket_start := pg_catalog.date_trunc(normalized_granularity, normalized_start_date::timestamp)::date;
  last_bucket_start := pg_catalog.date_trunc(normalized_granularity, normalized_end_date::timestamp)::date;

  return query
  with buckets as (
    select generated_bucket::date as bucket_start
    from pg_catalog.generate_series(first_bucket_start::timestamp, last_bucket_start::timestamp, step_interval) as generated_bucket
  ),
  metrics as (
    select
      pg_catalog.date_trunc(normalized_granularity, timezone('Asia/Jakarta', orm.created_at))::date as bucket_start,
      count(orm.id) filter (where orm.status != 'cancelled'::public.order_status)::bigint as order_count,
      count(orm.id) filter (where orm.payment_status = 'settlement'::public.payment_status and orm.status != 'cancelled'::public.order_status)::bigint as paid_order_count,
      count(orm.id) filter (where orm.payment_status = 'settlement'::public.payment_status and orm.status = 'delivered'::public.order_status)::bigint as completed_order_count,
      coalesce(sum(orm.total_amount) filter (where orm.payment_status = 'settlement'::public.payment_status and orm.status != 'cancelled'::public.order_status), 0)::numeric as revenue
    from public.order_read_model orm
    where orm.created_at >= (normalized_start_date::timestamp at time zone 'Asia/Jakarta')
      and orm.created_at < ((normalized_end_date + 1)::timestamp at time zone 'Asia/Jakarta')
    group by pg_catalog.date_trunc(normalized_granularity, timezone('Asia/Jakarta', orm.created_at))::date
  )
  select
    buckets.bucket_start,
    (buckets.bucket_start + step_interval - interval '1 day')::date as bucket_end,
    coalesce(metrics.order_count, 0)::bigint as order_count,
    coalesce(metrics.paid_order_count, 0)::bigint as paid_order_count,
    coalesce(metrics.completed_order_count, 0)::bigint as completed_order_count,
    coalesce(metrics.revenue, 0)::numeric as revenue
  from buckets
  left join metrics using (bucket_start)
  order by buckets.bucket_start asc;
end;
$$;

-- 6. Recreate admin_sales_report_pdf_export RPC with cancelled filter
create or replace function public.admin_sales_report_pdf_export(
  p_start_date date,
  p_end_date date
)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_payload jsonb;
begin
  if p_start_date is null or p_end_date is null then
    raise exception 'start and end dates are required';
  end if;

  if p_start_date > p_end_date then
    raise exception 'start date must be on or before end date';
  end if;

  if not exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'admin'
  ) then
    raise exception 'insufficient privileges to export sales report';
  end if;

  with filtered_orders as (
    select
      orm.id,
      orm.user_id,
      orm.created_at,
      orm.total_amount
    from public.order_read_model orm
    where orm.payment_status = 'settlement'::public.payment_status
      and orm.status != 'cancelled'::public.order_status
      and orm.created_at::date between p_start_date and p_end_date
  ),
  daily_sales_summary as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'sale_date', sale_date,
          'orders_count', orders_count,
          'total_revenue', total_revenue,
          'average_order_value', average_order_value
        )
        order by sale_date desc
      ),
      '[]'::jsonb
    ) as rows
    from (
      select
        date_trunc('day', fo.created_at)::date as sale_date,
        count(*)::bigint as orders_count,
        sum(fo.total_amount)::numeric as total_revenue,
        avg(fo.total_amount)::numeric as average_order_value
      from filtered_orders fo
      group by date_trunc('day', fo.created_at)::date
    ) daily_rows
  ),
  sold_products as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', oi.id,
          'order_created_at', fo.created_at,
          'sale_date', date_trunc('day', fo.created_at)::date,
          'product_name', p.name,
          'quantity', oi.quantity,
          'unit_price', oi.price_at_purchase::numeric(12, 2),
          'subtotal', (oi.quantity::numeric * oi.price_at_purchase)::numeric(12, 2)
        )
        order by fo.created_at desc, oi.id desc
      ),
      '[]'::jsonb
    ) as rows
    from filtered_orders fo
    join public.order_items oi on oi.order_id = fo.id
    left join public.products p on p.id = oi.product_id
  ),
  best_selling_products as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'product_id', product_id,
          'product_name', product_name,
          'category_name', category_name,
          'total_qty_sold', total_qty_sold,
          'total_revenue', total_revenue
        )
        order by total_qty_sold desc, product_name asc
      ),
      '[]'::jsonb
    ) as rows
    from (
      select
        p.id as product_id,
        p.name as product_name,
        c.name as category_name,
        sum(oi.quantity)::bigint as total_qty_sold,
        sum(oi.quantity::numeric * oi.price_at_purchase)::numeric(12, 2) as total_revenue
      from filtered_orders fo
      join public.order_items oi on oi.order_id = fo.id
      join public.products p on p.id = oi.product_id
      left join public.categories c on c.id = p.category_id
      group by p.id, p.name, c.name
    ) best_rows
  ),
  largest_customers as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'user_id', user_id,
          'full_name', full_name,
          'phone_number', phone_number,
          'orders_count', orders_count,
          'total_revenue', total_revenue
        )
        order by total_revenue desc, full_name asc
      ),
      '[]'::jsonb
    ) as rows
    from (
      select
        u.id as user_id,
        u.full_name,
        u.phone_number,
        count(fo.id)::bigint as orders_count,
        sum(fo.total_amount)::numeric(12, 2) as total_revenue
      from filtered_orders fo
      join public.profiles u on u.id = fo.user_id
      group by u.id, u.full_name, u.phone_number
    ) customer_rows
  )
  select jsonb_build_object(
    'dailySalesSummary', (select rows from daily_sales_summary),
    'soldProducts', (select rows from sold_products),
    'bestSellingProducts', (select rows from best_selling_products),
    'largestCustomers', (select rows from largest_customers)
  )
  into v_payload;

  return v_payload;
end;
$$;

-- View comments (restoring)
comment on view public.report_daily_sales is
  'Daily sales report sourced from canonical order_read_model payment state (excludes cancelled orders).';

comment on view public.report_product_sales is
  'Product sales report sourced from canonical order_read_model payment state (excludes cancelled orders).';

comment on view public.report_customer_sales is
  'Customer sales report sourced from canonical order_read_model payment state (excludes cancelled orders).';

comment on view public.report_sold_products is
  'Line-item sold-products report sourced from order_items and canonical order_read_model settlement/created_at sales semantics (excludes cancelled orders).';

-- Restore grants
revoke all on table public.report_sold_products from authenticated, public, anon;
grant select on table public.report_sold_products to authenticated;

revoke all on function public.admin_operational_metrics(text, date, date) from public;
grant execute on function public.admin_operational_metrics(text, date, date) to authenticated;

revoke all on function public.admin_sales_report_pdf_export(date, date) from public;
revoke all on function public.admin_sales_report_pdf_export(date, date) from anon;
grant execute on function public.admin_sales_report_pdf_export(date, date) to authenticated;

commit;
