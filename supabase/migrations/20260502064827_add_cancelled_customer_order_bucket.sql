begin;

create or replace view public.order_read_model
with (security_invoker = true)
as
with base_order_projection as (
  select
    o.id,
    o.user_id,
    o.total_amount,
    o.status,
    o.shipping_cost,
    o.shipping_address_id,
    o.created_at,
    o.updated_at,
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
    o.delivered_at,
    o.complaint_window_expires_at,
    o.customer_completed_at,
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
    s.status as shipment_status,
    s.latest_biteship_status
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
  ) s on true
)
select
  base_order_projection.*,
  case
    when base_order_projection.status = 'pending'
      and base_order_projection.payment_status = 'pending'::public.payment_status
      and (
        base_order_projection.expired_at is null
        or base_order_projection.expired_at > timezone('utc'::text, now())
      ) then 'unpaid'::text
    when base_order_projection.status in ('processing', 'awaiting_shipment') then 'packing'::text
    when base_order_projection.status in ('shipped', 'in_transit') then 'shipped'::text
    when base_order_projection.status = 'delivered'
      and base_order_projection.customer_completion_stage = 'awaiting_customer' then 'shipped'::text
    when base_order_projection.status = 'delivered'
      and base_order_projection.customer_completion_stage = 'completed' then 'completed'::text
    when base_order_projection.status = 'cancelled' then 'cancelled'::text
    else null::text
  end as customer_order_bucket
from base_order_projection;

commit;
