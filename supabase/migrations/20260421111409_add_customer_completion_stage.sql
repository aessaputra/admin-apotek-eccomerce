begin;

alter table public.orders
  add column if not exists delivered_at timestamptz,
  add column if not exists complaint_window_expires_at timestamptz,
  add column if not exists customer_completed_at timestamptz,
  add column if not exists customer_completed_by uuid references auth.users(id) on delete set null,
  add column if not exists customer_completion_source text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_customer_completion_source_check'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_customer_completion_source_check
      check (
        customer_completion_source is null
        or customer_completion_source = any (
          array['customer'::text, 'admin'::text, 'system_backfill'::text]
        )
      );
  end if;
end;
$$;

create index if not exists orders_delivered_completion_idx
  on public.orders (user_id, customer_completed_at, complaint_window_expires_at, created_at desc)
  where status = 'delivered';

create or replace function public.sync_order_delivery_metadata()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'delivered' then
    new.delivered_at := coalesce(
      new.delivered_at,
      case
        when tg_op = 'UPDATE' and old.status = 'delivered' then old.delivered_at
        else null
      end,
      timezone('utc'::text, now())
    );

    new.complaint_window_expires_at := coalesce(
      new.complaint_window_expires_at,
      case
        when tg_op = 'UPDATE' and old.status = 'delivered' then old.complaint_window_expires_at
        else null
      end,
      new.delivered_at + interval '2 days'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trigger_sync_order_delivery_metadata on public.orders;
create trigger trigger_sync_order_delivery_metadata
before insert or update on public.orders
for each row
execute function public.sync_order_delivery_metadata();

with delivered_backfill as (
  select
    o.id,
    coalesce(
      (
        select oa.created_at
        from public.order_activities oa
        where oa.order_id = o.id
          and oa.new_status = 'delivered'
        order by oa.created_at desc
        limit 1
      ),
      (
        select s.updated_at
        from public.shipments s
        where s.order_id = o.id
        order by s.updated_at desc, s.created_at desc
        limit 1
      ),
      o.updated_at,
      o.created_at,
      timezone('utc'::text, now())
    ) as derived_delivered_at
  from public.orders o
  where o.status = 'delivered'
)
update public.orders o
set
  delivered_at = coalesce(o.delivered_at, delivered_backfill.derived_delivered_at),
  complaint_window_expires_at = coalesce(
    o.complaint_window_expires_at,
    delivered_backfill.derived_delivered_at + interval '2 days'
  ),
  customer_completed_at = coalesce(o.customer_completed_at, delivered_backfill.derived_delivered_at),
  customer_completion_source = coalesce(o.customer_completion_source, 'system_backfill')
from delivered_backfill
where o.id = delivered_backfill.id;

create or replace view public.order_read_model
with (security_invoker = true)
as
select
  o.id,
  o.user_id,
  o.total_amount,
  o.status,
  o.shipping_cost,
  o.shipping_address_id,
  o.created_at,
  o.updated_at,
  o.delivered_at,
  o.complaint_window_expires_at,
  o.customer_completed_at,
  o.customer_completed_by,
  o.customer_completion_source,
  case
    when o.status <> 'delivered' then 'not_applicable'::text
    when o.customer_completed_at is not null then 'completed'::text
    when o.complaint_window_expires_at is not null
      and o.complaint_window_expires_at <= timezone('utc'::text, now()) then 'completed'::text
    else 'awaiting_customer'::text
  end as customer_completion_stage,
  case
    when o.status = 'delivered' and o.customer_completed_at is not null then o.customer_completed_at
    when o.status = 'delivered'
      and o.complaint_window_expires_at is not null
      and o.complaint_window_expires_at <= timezone('utc'::text, now()) then o.complaint_window_expires_at
    else null::timestamptz
  end as completed_at,
  coalesce(p.status, 'pending'::public.payment_status) as payment_status,
  p.payment_type,
  p.checkout_idempotency_key,
  p.midtrans_order_id,
  p.midtrans_transaction_id,
  p.gross_amount,
  p.paid_at,
  p.expiry_time as expired_at,
  p.snap_token,
  p.redirect_url as snap_redirect_url,
  p.snap_token_created_at,
  s.status as shipment_status,
  s.latest_biteship_status,
  s.courier_code,
  s.courier_service,
  s.shipping_etd,
  s.origin_area_id,
  s.destination_area_id,
  s.destination_postal_code,
  s.biteship_order_id,
  s.biteship_tracking_id,
  s.waybill_number,
  s.waybill_source,
  s.waybill_overridden_by,
  s.waybill_override_reason,
  s.waybill_overridden_at,
  case
    when o.status = 'pending'
      and coalesce(p.status, 'pending'::public.payment_status) = 'pending'::public.payment_status
      and (p.expiry_time is null or p.expiry_time > timezone('utc'::text, now())) then 'unpaid'::text
    when o.status in ('processing', 'awaiting_shipment') then 'packing'::text
    when o.status in ('shipped', 'in_transit') then 'shipped'::text
    when o.status = 'delivered'
      and (
        o.customer_completed_at is null
        and (
          o.complaint_window_expires_at is null
          or o.complaint_window_expires_at > timezone('utc'::text, now())
        )
      ) then 'shipped'::text
    when o.status = 'delivered' then 'completed'::text
    else null::text
  end as customer_order_bucket
from public.orders o
left join lateral (
  select
    payments.status,
    payments.payment_type,
    payments.checkout_idempotency_key,
    payments.midtrans_order_id,
    payments.midtrans_transaction_id,
    payments.gross_amount,
    payments.paid_at,
    payments.expiry_time,
    payments.snap_token,
    payments.redirect_url,
    payments.snap_token_created_at
  from public.payments
  where payments.order_id = o.id
  order by payments.updated_at desc, payments.created_at desc
  limit 1
) p on true
left join lateral (
  select
    shipments.status,
    shipments.latest_biteship_status,
    shipments.courier_code,
    shipments.courier_service,
    shipments.shipping_etd,
    shipments.origin_area_id,
    shipments.destination_area_id,
    shipments.destination_postal_code,
    shipments.biteship_order_id,
    shipments.biteship_tracking_id,
    shipments.waybill_number,
    shipments.waybill_source,
    shipments.waybill_overridden_by,
    shipments.waybill_override_reason,
    shipments.waybill_overridden_at
  from public.shipments
  where shipments.order_id = o.id
  order by shipments.updated_at desc, shipments.created_at desc
  limit 1
) s on true;

commit;
