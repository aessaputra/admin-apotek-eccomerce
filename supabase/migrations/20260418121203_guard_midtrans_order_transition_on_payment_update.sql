create or replace function public.apply_midtrans_webhook_transition(
  p_provider text,
  p_event_key text,
  p_order_id uuid,
  p_next_payment_status text,
  p_next_order_status text,
  p_midtrans_transaction_id text default null,
  p_payment_type text default null,
  p_biteship_order_id text default null,
  p_waybill_number text default null,
  p_paid_at timestamptz default null
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
  v_payment_rows_updated integer := 0;
begin
  insert into public.webhook_idempotency (provider, event_key)
  values (p_provider, p_event_key)
  on conflict (provider, event_key) do nothing
  returning id into v_inserted_id;

  if v_inserted_id is null then
    return query
      select
        false,
        coalesce(p.status::text, 'pending'),
        o.status::text
      from public.orders o
      left join lateral (
        select payments.status
        from public.payments
        where payments.order_id = o.id
        order by payments.updated_at desc, payments.created_at desc
        limit 1
      ) p on true
      where o.id = p_order_id;
    return;
  end if;

  update public.payments p
  set
    status = p_next_payment_status::public.payment_status,
    paid_at = case
      when p_next_payment_status = 'settlement' then coalesce(p.paid_at, p_paid_at, timezone('utc'::text, now()))
      else p.paid_at
    end,
    midtrans_transaction_id = coalesce(p_midtrans_transaction_id, p.midtrans_transaction_id),
    payment_type = coalesce(p_payment_type::public.payment_type, p.payment_type),
    updated_at = timezone('utc'::text, now())
  where p.order_id = p_order_id
    and (
      (p_next_payment_status = 'pending' and p.status = 'pending')
      or (p_next_payment_status = 'authorize' and p.status = 'pending')
      or (p_next_payment_status = 'settlement' and p.status in ('pending', 'authorize', 'deny'))
      or (p_next_payment_status in ('deny', 'cancel', 'expire') and p.status in ('pending', 'authorize'))
      or (p_next_payment_status in ('refund', 'partial_refund', 'chargeback', 'partial_chargeback') and p.status = 'settlement')
    )
  returning p.status::text into payment_status;

  get diagnostics v_payment_rows_updated = row_count;

  if v_payment_rows_updated = 0 then
    return query
      select
        false,
        coalesce(p.status::text, 'pending'),
        o.status::text
      from public.orders o
      left join lateral (
        select payments.status
        from public.payments
        where payments.order_id = o.id
        order by payments.updated_at desc, payments.created_at desc
        limit 1
      ) p on true
      where o.id = p_order_id;
    return;
  end if;

  update public.orders o
  set
    status = p_next_order_status,
    updated_at = timezone('utc'::text, now())
  where o.id = p_order_id
  returning true, o.status::text into applied, order_status;

  if applied is distinct from true then
    return query
      select
        false,
        coalesce(p.status::text, 'pending'),
        o.status::text
      from public.orders o
      left join lateral (
        select payments.status
        from public.payments
        where payments.order_id = o.id
        order by payments.updated_at desc, payments.created_at desc
        limit 1
      ) p on true
      where o.id = p_order_id;
    return;
  end if;

  return next;
end;
$$;
