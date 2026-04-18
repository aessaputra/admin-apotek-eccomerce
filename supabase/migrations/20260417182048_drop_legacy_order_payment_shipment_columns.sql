begin;

drop index if exists public.orders_checkout_idempotency_key_uidx;
drop index if exists public.orders_midtrans_order_id_uidx;
drop index if exists public.orders_payment_status_created_idx;
drop index if exists public.orders_user_pending_idx;
drop index if exists public.idx_orders_expired_pending;
drop index if exists public.orders_expired_at_idx;
drop index if exists public.idx_orders_waybill_overridden_by;

alter table public.orders
  drop constraint if exists orders_waybill_overridden_by_fkey,
  drop constraint if exists orders_waybill_source_check;

alter table public.orders
  drop column if exists checkout_idempotency_key,
  drop column if exists gross_amount,
  drop column if exists payment_status,
  drop column if exists payment_type,
  drop column if exists midtrans_order_id,
  drop column if exists midtrans_transaction_id,
  drop column if exists paid_at,
  drop column if exists expired_at,
  drop column if exists snap_token,
  drop column if exists snap_redirect_url,
  drop column if exists snap_token_created_at,
  drop column if exists courier_code,
  drop column if exists courier_service,
  drop column if exists shipping_etd,
  drop column if exists origin_area_id,
  drop column if exists destination_area_id,
  drop column if exists destination_postal_code,
  drop column if exists biteship_order_id,
  drop column if exists biteship_tracking_id,
  drop column if exists waybill_number,
  drop column if exists waybill_source,
  drop column if exists waybill_overridden_by,
  drop column if exists waybill_override_reason,
  drop column if exists waybill_overridden_at;

commit;
