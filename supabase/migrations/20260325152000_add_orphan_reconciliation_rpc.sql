begin;
create or replace function public.reconcile_midtrans_orphan_notifications(p_limit integer default 20)
returns integer
language plpgsql
security definer
set search_path = public
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
begin
  for rec in
    select
      p.id as payment_id,
      p.midtrans_order_id,
      p.raw_notification,
      o.id as order_id,
      o.user_id,
      o.payment_status::text as current_payment_status,
      o.status as current_order_status,
      o.payment_type::text as current_payment_type
    from public.payments p
    join public.orders o on o.midtrans_order_id = p.midtrans_order_id
    where p.order_id is null
      and p.midtrans_order_id is not null
      and p.raw_notification is not null
    order by p.updated_at asc
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

    if v_transaction_status = 'capture' then
      if v_fraud_status = 'deny' then
        v_next_payment_status := 'deny';
        v_next_order_status := 'cancelled';
      elsif v_fraud_status = 'challenge' then
        v_next_payment_status := 'pending';
      elsif v_fraud_status = 'accept' then
        v_next_payment_status := 'settlement';
        v_next_order_status := 'awaiting_shipment';
      end if;
    elsif v_transaction_status = 'settlement' then
      v_next_payment_status := 'settlement';
      v_next_order_status := 'awaiting_shipment';
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

    perform applied
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
    );

    update public.payments
    set
      order_id = rec.order_id,
      user_id = rec.user_id,
      updated_at = timezone('utc'::text, now())
    where id = rec.payment_id;

    v_processed := v_processed + 1;
  end loop;

  return v_processed;
end;
$$;
comment on function public.reconcile_midtrans_orphan_notifications(integer) is
  'Reconciles orphan Midtrans payment notifications by linking payments to orders and replaying guarded status transitions.';
commit;
