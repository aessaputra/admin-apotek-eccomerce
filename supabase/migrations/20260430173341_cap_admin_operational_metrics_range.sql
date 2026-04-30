begin;

create or replace function public.admin_operational_metrics(
  p_granularity text,
  p_start_date date,
  p_end_date date
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
stable
security invoker
set search_path = ''
as $$
declare
  normalized_granularity text := lower(coalesce(p_granularity, ''));
  step_interval interval;
  normalized_start_date date;
  normalized_end_date date;
  first_bucket_start date;
  last_bucket_start date;
  bucket_count integer;
  max_bucket_count constant integer := 500;
begin
  if not (select private.is_admin()) then
    return;
  end if;

  if normalized_granularity not in ('day', 'week', 'month', 'year') then
    raise exception 'Unsupported granularity: %', p_granularity
      using errcode = '22023';
  end if;

  if p_start_date is null or p_end_date is null then
    raise exception 'Start date and end date are required'
      using errcode = '22004';
  end if;

  if p_start_date <= p_end_date then
    normalized_start_date := p_start_date;
    normalized_end_date := p_end_date;
  else
    normalized_start_date := p_end_date;
    normalized_end_date := p_start_date;
  end if;

  step_interval := case normalized_granularity
    when 'day' then interval '1 day'
    when 'week' then interval '1 week'
    when 'month' then interval '1 month'
    else interval '1 year'
  end;
  first_bucket_start := pg_catalog.date_trunc(normalized_granularity, normalized_start_date::timestamp)::date;
  last_bucket_start := pg_catalog.date_trunc(normalized_granularity, normalized_end_date::timestamp)::date;

  bucket_count := case normalized_granularity
    when 'day' then (last_bucket_start - first_bucket_start) + 1
    when 'week' then ((last_bucket_start - first_bucket_start) / 7) + 1
    when 'month' then
      ((extract(year from last_bucket_start)::integer - extract(year from first_bucket_start)::integer) * 12)
      + (extract(month from last_bucket_start)::integer - extract(month from first_bucket_start)::integer)
      + 1
    else extract(year from last_bucket_start)::integer - extract(year from first_bucket_start)::integer + 1
  end;

  if bucket_count > max_bucket_count then
    raise exception 'Operational metrics range is too large: % buckets requested, maximum is %', bucket_count, max_bucket_count
      using errcode = '22023';
  end if;

  return query
  with buckets as (
    select generated_bucket::date as bucket_start
    from pg_catalog.generate_series(first_bucket_start::timestamp, last_bucket_start::timestamp, step_interval) as generated_bucket
  ),
  metrics as (
    select
      pg_catalog.date_trunc(normalized_granularity, timezone('Asia/Jakarta', orm.created_at))::date as bucket_start,
      count(orm.id)::bigint as order_count,
      count(orm.id) filter (where orm.payment_status = 'settlement'::public.payment_status)::bigint as paid_order_count,
      count(orm.id) filter (where orm.payment_status = 'settlement'::public.payment_status and orm.status = 'delivered')::bigint as completed_order_count,
      coalesce(sum(orm.total_amount) filter (where orm.payment_status = 'settlement'::public.payment_status), 0)::numeric as revenue
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

revoke all on function public.admin_operational_metrics(text, date, date) from public;
grant execute on function public.admin_operational_metrics(text, date, date) to authenticated;

comment on function public.admin_operational_metrics(text, date, date) is
  'Admin-only operational dashboard metrics bucketed by day, week, month, or year using Asia/Jakarta order-created dates; missing buckets are zero-filled, range requests are capped, and revenue counts settlement payments only.';

commit;
