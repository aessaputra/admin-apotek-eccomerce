begin;

create or replace view public.admin_monthly_operational_metrics
with (security_invoker = true)
as
select
  date_trunc('month', timezone('Asia/Jakarta', orm.created_at))::date as month_start,
  count(distinct orm.id)::bigint as order_count,
  count(distinct orm.id) filter (where orm.payment_status = 'settlement'::public.payment_status)::bigint as paid_order_count,
  count(distinct orm.id) filter (where orm.payment_status = 'settlement'::public.payment_status and orm.status = 'delivered')::bigint as completed_order_count,
  coalesce(sum(orm.total_amount) filter (where orm.payment_status = 'settlement'::public.payment_status), 0)::numeric as revenue
from public.order_read_model orm
group by date_trunc('month', timezone('Asia/Jakarta', orm.created_at))::date
order by date_trunc('month', timezone('Asia/Jakarta', orm.created_at))::date desc;

comment on view public.admin_monthly_operational_metrics is
  'Monthly operational metrics bucketed by Asia/Jakarta order-created month; revenue counts settlement payments only and completed orders count delivered settlement orders.';

commit;
