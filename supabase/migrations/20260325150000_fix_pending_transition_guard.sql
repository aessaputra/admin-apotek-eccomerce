begin;
create or replace function public.apply_midtrans_webhook_transition(
  p_provider text,
  p_event_key text,
  p_order_id uuid,
  p_next_payment_status text,
  p_next_order_status text,
  p_midtrans_transaction_id text default null,
  p_payment_type text default null,
  p_biteship_order_id text default null,
  p_waybill_number text default null
)
returns table (
  applied boolean,
  payment_status text,
  order_status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted_id uuid;
begin
  if p_provider is null or btrim(p_provider) = '' then
    raise exception 'provider is required';
  end if;

  if p_event_key is null or btrim(p_event_key) = '' then
    raise exception 'event_key is required';
  end if;

  insert into public.webhook_idempotency (provider, event_key)
  values (p_provider, p_event_key)
  on conflict (provider, event_key) do nothing
  returning id into v_inserted_id;

  if v_inserted_id is null then
    return query
      select
        false as applied,
        o.payment_status::text,
        o.status::text as order_status
      from public.orders o
      where o.id = p_order_id;

    if not found then
      raise exception 'order % not found while handling duplicate webhook event', p_order_id;
    end if;

    return;
  end if;

  update public.orders o
  set
    payment_status = p_next_payment_status::public.payment_status,
    status = p_next_order_status,
    paid_at = case
      when p_next_payment_status = 'settlement' then coalesce(o.paid_at, timezone('utc'::text, now()))
      else o.paid_at
    end,
    midtrans_transaction_id = coalesce(p_midtrans_transaction_id, o.midtrans_transaction_id),
    payment_type = coalesce(p_payment_type::public.payment_type, o.payment_type),
    biteship_order_id = coalesce(p_biteship_order_id, o.biteship_order_id),
    waybill_number = coalesce(p_waybill_number, o.waybill_number),
    updated_at = timezone('utc'::text, now())
  where o.id = p_order_id
    and (
      (p_next_payment_status = 'pending' and o.payment_status in ('pending', 'authorize'))
      or (p_next_payment_status = 'authorize' and o.payment_status = 'pending')
      or (p_next_payment_status = 'settlement' and o.payment_status in ('pending', 'authorize'))
      or (p_next_payment_status in ('deny', 'cancel', 'expire') and o.payment_status in ('pending', 'authorize'))
      or (p_next_payment_status in ('refund', 'partial_refund', 'chargeback', 'partial_chargeback') and o.payment_status = 'settlement')
    )
  returning
    true as applied,
    o.payment_status::text,
    o.status::text as order_status
  into applied, payment_status, order_status;

  if applied is not true then
    return query
      select
        false as applied,
        o.payment_status::text,
        o.status::text as order_status
      from public.orders o
      where o.id = p_order_id;

    if not found then
      raise exception 'order % not found while applying webhook transition', p_order_id;
    end if;

    return;
  end if;

  return next;
end;
$$;
comment on function public.apply_midtrans_webhook_transition is
  'Atomically inserts webhook idempotency marker and applies guarded Midtrans order status transition. Pending is idempotent for pending/authorize, authorize lifecycle supports pending->authorize->settlement or deny/cancel/expire, settlement supports refund states.';
commit;
