begin;

alter table public.payments
  add column if not exists snap_token text,
  add column if not exists snap_token_created_at timestamptz;

create table if not exists public.shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  provider text not null default 'biteship',
  status text not null default 'pending',
  courier_code text,
  courier_service text,
  shipping_etd text,
  origin_area_id text,
  destination_area_id text,
  destination_postal_code integer,
  biteship_order_id text,
  biteship_tracking_id text,
  waybill_number text,
  waybill_source text,
  waybill_overridden_by uuid references auth.users(id) on delete set null,
  waybill_override_reason text,
  waybill_overridden_at timestamptz,
  latest_biteship_status text,
  latest_biteship_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint shipments_provider_check
    check (provider in ('biteship', 'manual')),
  constraint shipments_waybill_source_check
    check (waybill_source is null or waybill_source = any (array['system'::text, 'manual'::text]))
);

create unique index if not exists shipments_order_id_uidx
  on public.shipments (order_id);

create unique index if not exists shipments_biteship_order_id_uidx
  on public.shipments (biteship_order_id)
  where biteship_order_id is not null;

create unique index if not exists shipments_biteship_tracking_id_uidx
  on public.shipments (biteship_tracking_id)
  where biteship_tracking_id is not null;

create index if not exists shipments_courier_status_idx
  on public.shipments (courier_code, status, updated_at desc);

alter table public.shipments enable row level security;

drop policy if exists "Admins can manage all shipments" on public.shipments;
create policy "Admins can manage all shipments"
  on public.shipments
  for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  );

drop policy if exists "Users can view own shipments" on public.shipments;
create policy "Users can view own shipments"
  on public.shipments
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.orders o
      where o.id = shipments.order_id
        and o.user_id = auth.uid()
    )
  );

create or replace function public.update_shipments_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$;

drop trigger if exists trigger_update_shipments_updated_at on public.shipments;
create trigger trigger_update_shipments_updated_at
before update on public.shipments
for each row
execute function public.update_shipments_updated_at();

with order_payment_backfill as (
  select
    o.id as order_id,
    o.user_id,
    o.checkout_idempotency_key,
    o.midtrans_order_id,
    o.midtrans_transaction_id,
    o.payment_status as status,
    o.payment_type,
    coalesce(o.gross_amount, o.total_amount + coalesce(o.shipping_cost, 0)) as gross_amount,
    o.paid_at,
    o.expired_at as expiry_time,
    o.snap_token,
    o.snap_redirect_url as redirect_url,
    o.snap_token_created_at,
    o.created_at,
    coalesce(o.updated_at, o.created_at) as updated_at
  from public.orders o
  where o.midtrans_order_id is not null
)
insert into public.payments (
  order_id,
  user_id,
  checkout_idempotency_key,
  midtrans_order_id,
  midtrans_transaction_id,
  status,
  payment_type,
  currency,
  gross_amount,
  paid_at,
  expiry_time,
  snap_token,
  redirect_url,
  snap_token_created_at,
  created_at,
  updated_at
)
select
  order_id,
  user_id,
  checkout_idempotency_key,
  midtrans_order_id,
  midtrans_transaction_id,
  status,
  payment_type,
  'IDR',
  gross_amount,
  paid_at,
  expiry_time,
  snap_token,
  redirect_url,
  snap_token_created_at,
  created_at,
  updated_at
from order_payment_backfill
on conflict (midtrans_order_id) do update
set
  order_id = coalesce(public.payments.order_id, excluded.order_id),
  user_id = coalesce(public.payments.user_id, excluded.user_id),
  checkout_idempotency_key = coalesce(public.payments.checkout_idempotency_key, excluded.checkout_idempotency_key),
  midtrans_transaction_id = coalesce(public.payments.midtrans_transaction_id, excluded.midtrans_transaction_id),
  payment_type = coalesce(public.payments.payment_type, excluded.payment_type),
  gross_amount = coalesce(public.payments.gross_amount, excluded.gross_amount),
  paid_at = coalesce(public.payments.paid_at, excluded.paid_at),
  expiry_time = coalesce(public.payments.expiry_time, excluded.expiry_time),
  snap_token = coalesce(public.payments.snap_token, excluded.snap_token),
  redirect_url = coalesce(public.payments.redirect_url, excluded.redirect_url),
  snap_token_created_at = coalesce(public.payments.snap_token_created_at, excluded.snap_token_created_at),
  updated_at = greatest(public.payments.updated_at, excluded.updated_at);

insert into public.shipments (
  order_id,
  provider,
  status,
  courier_code,
  courier_service,
  shipping_etd,
  origin_area_id,
  destination_area_id,
  destination_postal_code,
  biteship_order_id,
  biteship_tracking_id,
  waybill_number,
  waybill_source,
  waybill_overridden_by,
  waybill_override_reason,
  waybill_overridden_at,
  created_at,
  updated_at
)
select
  o.id,
  case when o.biteship_order_id is not null then 'biteship' else 'manual' end,
  case
    when o.status in ('awaiting_shipment', 'shipped', 'in_transit', 'delivered', 'cancelled') then o.status
    else 'pending'
  end,
  o.courier_code,
  o.courier_service,
  o.shipping_etd,
  o.origin_area_id,
  o.destination_area_id,
  o.destination_postal_code,
  o.biteship_order_id,
  o.biteship_tracking_id,
  o.waybill_number,
  o.waybill_source,
  o.waybill_overridden_by,
  o.waybill_override_reason,
  o.waybill_overridden_at,
  o.created_at,
  coalesce(o.updated_at, o.created_at)
from public.orders o
where o.courier_code is not null
   or o.courier_service is not null
   or o.shipping_etd is not null
   or o.origin_area_id is not null
   or o.destination_area_id is not null
   or o.destination_postal_code is not null
   or o.biteship_order_id is not null
   or o.biteship_tracking_id is not null
   or o.waybill_number is not null
on conflict (order_id) do update
set
  provider = excluded.provider,
  status = excluded.status,
  courier_code = excluded.courier_code,
  courier_service = excluded.courier_service,
  shipping_etd = excluded.shipping_etd,
  origin_area_id = excluded.origin_area_id,
  destination_area_id = excluded.destination_area_id,
  destination_postal_code = excluded.destination_postal_code,
  biteship_order_id = excluded.biteship_order_id,
  biteship_tracking_id = excluded.biteship_tracking_id,
  waybill_number = excluded.waybill_number,
  waybill_source = excluded.waybill_source,
  waybill_overridden_by = excluded.waybill_overridden_by,
  waybill_override_reason = excluded.waybill_override_reason,
  waybill_overridden_at = excluded.waybill_overridden_at,
  updated_at = greatest(public.shipments.updated_at, excluded.updated_at);

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
  s.waybill_overridden_at
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

create or replace function public.enqueue_side_effect_task_on_settlement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.order_id is not null
     and new.status = 'settlement'::public.payment_status
     and old.status is distinct from new.status then
    insert into public.webhook_side_effect_tasks (order_id, needs_stock, needs_biteship, updated_at)
    values (new.order_id, true, true, timezone('utc'::text, now()))
    on conflict (order_id)
    do update
      set needs_stock = true,
          needs_biteship = true,
          updated_at = timezone('utc'::text, now());
  end if;

  return new;
end;
$$;

drop trigger if exists trg_orders_enqueue_side_effect_task_on_settlement on public.orders;
drop trigger if exists trg_payments_enqueue_side_effect_task_on_settlement on public.payments;
create trigger trg_payments_enqueue_side_effect_task_on_settlement
after update on public.payments
for each row
execute function public.enqueue_side_effect_task_on_settlement();

create or replace function public.cancel_expired_orders()
returns jsonb
language plpgsql
set search_path = public
as $function$
declare
  v_cancelled_count int := 0;
  v_batch_size int := 1000;
begin
  with expired_orders as (
    select o.id
    from public.orders as o
    join public.payments p on p.order_id = o.id
    where o.status = 'pending'
      and p.status = 'pending'
      and p.expiry_time < now()
    for update of o, p skip locked
    limit v_batch_size
  )
  update public.orders
  set
    status = 'cancelled',
    updated_at = now()
  where id in (select id from expired_orders);

  get diagnostics v_cancelled_count = row_count;

  update public.payments
  set
    status = 'expire'::public.payment_status,
    updated_at = now()
  where order_id in (select id from expired_orders)
    and status = 'pending'::public.payment_status;

  return jsonb_build_object(
    'cancelled_count', v_cancelled_count,
    'executed_at', now()
  );
exception when others then
  return jsonb_build_object(
    'error', sqlerrm,
    'executed_at', now()
  );
end;
$function$;

create or replace function public.trigger_reconcile_pending_midtrans_payments(
  p_limit integer default 10
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_due_order_exists boolean := false;
  v_project_url text;
  v_service_role_key text;
  v_request_id bigint;
begin
  select exists (
    select 1
    from public.order_read_model orm
    where orm.payment_status in ('pending', 'authorize')
      and orm.midtrans_order_id is not null
      and orm.snap_token is not null
  ) into v_due_order_exists;

  if not v_due_order_exists then
    return null;
  end if;

  select decrypted_secret
  into v_project_url
  from vault.decrypted_secrets
  where name = 'project_url'
  limit 1;

  if v_project_url is null or btrim(v_project_url) = '' then
    raise exception 'Missing vault secret "project_url" for pending Midtrans reconciliation schedule';
  end if;

  select decrypted_secret
  into v_service_role_key
  from vault.decrypted_secrets
  where name = 'service_role_key'
  limit 1;

  if v_service_role_key is null or btrim(v_service_role_key) = '' then
    raise exception 'Missing vault secret "service_role_key" for pending Midtrans reconciliation schedule';
  end if;

  select net.http_post(
    url := rtrim(v_project_url, '/') || '/functions/v1/reconcile-pending-midtrans-payments',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_role_key
    ),
    body := jsonb_build_object(
      'limit', greatest(1, least(coalesce(p_limit, 10), 50))
    )
  ) into v_request_id;

  return v_request_id;
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
      orphan_payment.id as payment_id,
      orphan_payment.midtrans_order_id,
      orphan_payment.raw_notification,
      canonical_payment.order_id,
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
        user_id = o.user_id,
        updated_at = timezone('utc'::text, now())
      from public.orders o
      where public.payments.id = rec.payment_id
        and o.id = rec.order_id;

      v_processed := v_processed + 1;
    end if;
  end loop;

  return v_processed;
end;
$$;

-- NOTE:
-- Legacy payment/shipment columns intentionally remain on public.orders in this
-- migration. Remote report views and existing clients still depend on them.
-- Cleanup/drop of legacy columns must happen in a later contract migration after
-- all dependent views and application reads have been migrated away.

commit;
