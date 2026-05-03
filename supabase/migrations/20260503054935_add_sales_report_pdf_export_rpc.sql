begin;

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

revoke all on function public.admin_sales_report_pdf_export(date, date) from public;
revoke all on function public.admin_sales_report_pdf_export(date, date) from anon;
grant execute on function public.admin_sales_report_pdf_export(date, date) to authenticated;

commit;
