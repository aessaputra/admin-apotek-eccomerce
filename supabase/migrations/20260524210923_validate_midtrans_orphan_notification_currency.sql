begin;

create or replace function public.reconcile_midtrans_orphan_notifications(p_limit integer default 20)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec record;
  v_processed integer := 0;
  v_transaction_status text;
  v_fraud_status text;
  v_status_code text;
  v_gross_amount text;
  v_payment_type text;
  v_transaction_id text;
  v_current_payment_status text;
  v_next_payment_status text;
  v_next_order_status text;
  v_event_key text;
  v_expected_amount numeric;
  v_webhook_amount numeric;
  v_expected_currency text;
  v_notification_currency text;
  v_transition_applied boolean := false;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service_role required'
      using errcode = '42501';
  end if;

  for rec in
    select
      orphan_payment.id as payment_id,
      orphan_payment.midtrans_order_id,
      orphan_payment.raw_notification,
      canonical_payment.order_id,
      canonical_payment.currency as expected_currency,
      o.user_id,
      canonical_payment.status::text as current_payment_status,
      o.status as current_order_status,
      canonical_payment.payment_type::text as current_payment_type,
      o.total_amount,
      o.shipping_cost,
      canonical_payment.gross_amount
    from public.payments orphan_payment
    join public.payments canonical_payment
      on canonical_payment.midtrans_order_id = orphan_payment.midtrans_order_id
     and canonical_payment.order_id is not null
    join public.orders o on o.id = canonical_payment.order_id
    where orphan_payment.order_id is null
      and orphan_payment.midtrans_order_id is not null
      and orphan_payment.raw_notification is not null
    order by orphan_payment.updated_at asc
    limit greatest(1, least(coalesce(p_limit, 20), 100))
  loop
    v_transaction_status := coalesce(rec.raw_notification->>'transaction_status', '');
    v_fraud_status := coalesce(rec.raw_notification->>'fraud_status', '');
    v_status_code := coalesce(rec.raw_notification->>'status_code', '');
    v_gross_amount := coalesce(rec.raw_notification->>'gross_amount', '');
    v_payment_type := coalesce(rec.raw_notification->>'payment_type', rec.current_payment_type);
    v_transaction_id := rec.raw_notification->>'transaction_id';
    v_current_payment_status := coalesce(rec.current_payment_status, 'pending');
    v_next_payment_status := v_current_payment_status;
    v_next_order_status := rec.current_order_status;
    v_expected_amount := coalesce(rec.gross_amount, rec.total_amount + coalesce(rec.shipping_cost, 0));
    v_webhook_amount := nullif(v_gross_amount, '')::numeric;
    v_expected_currency := upper(nullif(btrim(coalesce(rec.expected_currency, 'IDR')), ''));
    v_notification_currency := upper(nullif(btrim(coalesce(rec.raw_notification->>'currency', '')), ''));

    if v_notification_currency is null
       or v_expected_currency is null
       or v_notification_currency <> 'IDR'
       or v_expected_currency <> 'IDR'
       or v_notification_currency <> v_expected_currency then
      continue;
    end if;

    if v_webhook_amount is null or round(v_webhook_amount) <> round(v_expected_amount) then
      continue;
    end if;

    if v_transaction_status = 'capture' then
      if v_fraud_status = 'deny' then
        v_next_payment_status := 'deny';
        v_next_order_status := 'cancelled';
      elsif v_fraud_status = 'challenge' then
        v_next_payment_status := 'pending';
      elsif v_fraud_status = 'accept' then
        v_next_payment_status := 'settlement';
        v_next_order_status := 'processing';
      end if;
    elsif v_transaction_status = 'settlement' then
      v_next_payment_status := 'settlement';
      v_next_order_status := 'processing';
    elsif v_transaction_status in ('cancel', 'deny', 'expire') then
      v_next_payment_status := v_transaction_status;
      v_next_order_status := 'cancelled';
    elsif v_transaction_status = 'refund' then
      v_next_payment_status := 'refund';
    elsif v_transaction_status = 'partial_refund' then
      v_next_payment_status := 'partial_refund';
    elsif v_transaction_status = 'chargeback' then
      v_next_payment_status := 'chargeback';
    elsif v_transaction_status = 'partial_chargeback' then
      v_next_payment_status := 'partial_chargeback';
    elsif v_transaction_status = 'authorize' then
      v_next_payment_status := 'authorize';
    elsif v_transaction_status = 'pending' then
      v_next_payment_status := 'pending';
    elsif v_transaction_status = 'failure' then
      v_next_payment_status := 'deny';
      v_next_order_status := 'cancelled';
    end if;

    v_event_key := format(
      'reconcile:%s:%s:%s:%s:%s',
      rec.midtrans_order_id,
      v_transaction_status,
      v_status_code,
      v_gross_amount,
      v_fraud_status
    );

    v_transition_applied := false;
    select t.applied
    into v_transition_applied
    from public.apply_midtrans_webhook_transition(
      'midtrans',
      v_event_key,
      rec.order_id,
      v_next_payment_status,
      v_next_order_status,
      v_transaction_id,
      v_payment_type,
      null,
      null
    ) as t
    limit 1;

    if coalesce(v_transition_applied, false)
       or (
         rec.current_payment_status = v_next_payment_status
         and rec.current_order_status = v_next_order_status
       ) then
      update public.payments
      set
        order_id = rec.order_id,
        user_id = rec.user_id,
        updated_at = timezone('utc'::text, now())
      where id = rec.payment_id;

      v_processed := v_processed + 1;
    end if;
  end loop;

  return v_processed;
end;
$$;

revoke all on function public.reconcile_midtrans_orphan_notifications(integer) from public, anon, authenticated;
grant execute on function public.reconcile_midtrans_orphan_notifications(integer) to service_role;

commit;
