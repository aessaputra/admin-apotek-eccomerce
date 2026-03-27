begin;
create table if not exists public.order_item_stock_deductions (
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  created_at timestamptz not null default timezone('utc'::text, now()),
  primary key (order_id, product_id)
);
create or replace function public.apply_order_item_stock_deduction(
  p_order_id uuid,
  p_product_id uuid,
  p_quantity integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rowcount integer := 0;
begin
  if p_quantity is null or p_quantity <= 0 then
    return;
  end if;

  insert into public.order_item_stock_deductions (order_id, product_id, quantity)
  values (p_order_id, p_product_id, p_quantity)
  on conflict (order_id, product_id) do nothing;

  get diagnostics v_rowcount = row_count;
  if v_rowcount = 0 then
    return;
  end if;

  update public.products
  set
    stock = stock - p_quantity,
    updated_at = timezone('utc'::text, now())
  where id = p_product_id
    and stock >= p_quantity;

  if not found then
    delete from public.order_item_stock_deductions
    where order_id = p_order_id and product_id = p_product_id;
    raise exception 'Unable to deduct stock for product %', p_product_id;
  end if;
end;
$$;
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
  v_expected_amount numeric;
  v_webhook_amount numeric;
  v_transition_applied boolean := false;
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
      o.payment_type::text as current_payment_type,
      o.total_amount,
      o.shipping_cost,
      o.gross_amount
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
    v_expected_amount := coalesce(rec.gross_amount, rec.total_amount + coalesce(rec.shipping_cost, 0));
    v_webhook_amount := nullif(v_gross_amount, '')::numeric;

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
commit;
