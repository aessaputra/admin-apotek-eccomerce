begin;
do $$
begin
  if not exists (select 1 from pg_type where typname = 'payment_status') then
    create type public.payment_status as enum (
      'pending',
      'settlement',
      'deny',
      'expire',
      'cancel',
      'refund',
      'partial_refund',
      'chargeback',
      'partial_chargeback',
      'authorize'
    );
  end if;
end
$$;
do $$
begin
  if not exists (select 1 from pg_type where typname = 'payment_type') then
    create type public.payment_type as enum (
      'credit_card',
      'bank_transfer',
      'echannel',
      'gopay',
      'shopeepay',
      'qris',
      'akulaku',
      'kredivo',
      'indomaret',
      'alfamart',
      'bca_klikbca',
      'bca_klikpay',
      'bri_epay',
      'cimb_clicks',
      'danamon_online',
      'uob_ezpay',
      'other'
    );
  end if;
end
$$;
alter table public.orders
  add column if not exists checkout_idempotency_key text,
  add column if not exists midtrans_order_id text,
  add column if not exists snap_token text,
  add column if not exists snap_redirect_url text,
  add column if not exists gross_amount numeric(12,2),
  add column if not exists paid_at timestamptz,
  add column if not exists expired_at timestamptz,
  add column if not exists snap_token_created_at timestamptz;
create temp table if not exists pg_temp.orders_payment_dependent_views (
  view_schema text not null,
  view_name text not null,
  view_definition text not null,
  primary key (view_schema, view_name)
) on commit drop;
insert into pg_temp.orders_payment_dependent_views (view_schema, view_name, view_definition)
select distinct
  n.nspname as view_schema,
  c.relname as view_name,
  pg_get_viewdef(c.oid, true) as view_definition
from pg_depend d
join pg_rewrite r
  on r.oid = d.objid
join pg_class c
  on c.oid = r.ev_class
join pg_namespace n
  on n.oid = c.relnamespace
join pg_attribute a
  on a.attrelid = d.refobjid
 and a.attnum = d.refobjsubid
where d.refobjid = 'public.orders'::regclass
  and c.relkind = 'v'
  and a.attname in ('payment_status', 'payment_type')
on conflict (view_schema, view_name) do nothing;
do $$
declare
  v_view record;
begin
  for v_view in
    select view_schema, view_name
    from pg_temp.orders_payment_dependent_views
    order by view_schema, view_name
  loop
    execute format('drop view if exists %I.%I', v_view.view_schema, v_view.view_name);
  end loop;
end
$$;
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'orders'
      and column_name = 'payment_status'
      and udt_name <> 'payment_status'
  ) then
    alter table public.orders
      alter column payment_status drop default;

    alter table public.orders
      alter column payment_status type public.payment_status
      using (
        case payment_status
          when 'unpaid' then 'pending'::public.payment_status
          when 'pending' then 'pending'::public.payment_status
          when 'success' then 'settlement'::public.payment_status
          when 'failed' then 'deny'::public.payment_status
          when 'settlement' then 'settlement'::public.payment_status
          when 'deny' then 'deny'::public.payment_status
          when 'expire' then 'expire'::public.payment_status
          when 'cancel' then 'cancel'::public.payment_status
          when 'refund' then 'refund'::public.payment_status
          when 'partial_refund' then 'partial_refund'::public.payment_status
          when 'chargeback' then 'chargeback'::public.payment_status
          when 'partial_chargeback' then 'partial_chargeback'::public.payment_status
          when 'authorize' then 'authorize'::public.payment_status
          else 'pending'::public.payment_status
        end
      );
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'orders'
      and column_name = 'payment_type'
      and udt_name <> 'payment_type'
  ) then
    alter table public.orders
      alter column payment_type type public.payment_type
      using (
        case payment_type
          when 'credit_card' then 'credit_card'::public.payment_type
          when 'bank_transfer' then 'bank_transfer'::public.payment_type
          when 'echannel' then 'echannel'::public.payment_type
          when 'gopay' then 'gopay'::public.payment_type
          when 'shopeepay' then 'shopeepay'::public.payment_type
          when 'qris' then 'qris'::public.payment_type
          when 'akulaku' then 'akulaku'::public.payment_type
          when 'kredivo' then 'kredivo'::public.payment_type
          when 'indomaret' then 'indomaret'::public.payment_type
          when 'alfamart' then 'alfamart'::public.payment_type
          when 'bca_klikbca' then 'bca_klikbca'::public.payment_type
          when 'bca_klikpay' then 'bca_klikpay'::public.payment_type
          when 'bri_epay' then 'bri_epay'::public.payment_type
          when 'cimb_clicks' then 'cimb_clicks'::public.payment_type
          when 'danamon_online' then 'danamon_online'::public.payment_type
          when 'uob_ezpay' then 'uob_ezpay'::public.payment_type
          else 'other'::public.payment_type
        end
      );
  end if;
end
$$;
alter table public.orders
  alter column payment_status set default 'pending'::public.payment_status,
  alter column payment_type drop default;
do $$
declare
  v_view record;
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'orders'
      and column_name = 'payment_status'
      and udt_name = 'payment_status'
  ) then
    for v_view in
      select view_schema, view_name, view_definition
      from pg_temp.orders_payment_dependent_views
      order by view_schema, view_name
    loop
      execute format(
        'create view %I.%I as %s',
        v_view.view_schema,
        v_view.view_name,
        regexp_replace(
          v_view.view_definition,
          '''paid''::text',
          '''settlement''::public.payment_status',
          'g'
        )
      );
    end loop;
  end if;
end
$$;
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  checkout_idempotency_key text,
  midtrans_order_id text not null,
  midtrans_transaction_id text,
  status public.payment_status not null default 'pending'::public.payment_status,
  payment_type public.payment_type,
  transaction_status text,
  fraud_status text,
  status_code text,
  status_message text,
  currency text not null default 'IDR',
  gross_amount numeric(12,2) not null,
  signature_key text,
  merchant_id text,
  transaction_time timestamptz,
  settlement_time timestamptz,
  expiry_time timestamptz,
  paid_at timestamptz,
  payment_code text,
  store text,
  va_numbers jsonb not null default '[]'::jsonb,
  biller_code text,
  bill_key text,
  bank text,
  acquirer text,
  issuer text,
  card_type text,
  masked_card text,
  approval_code text,
  eci text,
  channel_response_code text,
  channel_response_message text,
  redirect_url text,
  raw_notification jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);
create unique index if not exists orders_checkout_idempotency_key_uidx
  on public.orders (checkout_idempotency_key)
  where checkout_idempotency_key is not null;
create unique index if not exists orders_midtrans_order_id_uidx
  on public.orders (midtrans_order_id)
  where midtrans_order_id is not null;
create index if not exists orders_payment_status_created_idx
  on public.orders (payment_status, created_at desc);
create index if not exists orders_expired_at_idx
  on public.orders (expired_at)
  where expired_at is not null;
create unique index if not exists payments_midtrans_order_id_uidx
  on public.payments (midtrans_order_id);
create unique index if not exists payments_midtrans_transaction_id_uidx
  on public.payments (midtrans_transaction_id)
  where midtrans_transaction_id is not null;
create index if not exists payments_order_id_created_idx
  on public.payments (order_id, created_at desc);
create index if not exists payments_user_id_created_idx
  on public.payments (user_id, created_at desc);
create index if not exists payments_status_created_idx
  on public.payments (status, created_at desc);
alter table public.payments enable row level security;
drop policy if exists "Admins can manage all payments" on public.payments;
create policy "Admins can manage all payments"
  on public.payments
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
drop policy if exists "Users can view own payments" on public.payments;
create policy "Users can view own payments"
  on public.payments
  for select
  to authenticated
  using (
    auth.uid() = user_id
    or exists (
      select 1
      from public.orders o
      where o.id = payments.order_id
        and o.user_id = auth.uid()
    )
  );
create or replace function public.update_payments_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$;
drop trigger if exists trigger_update_payments_updated_at on public.payments;
create trigger trigger_update_payments_updated_at
before update on public.payments
for each row
execute function public.update_payments_updated_at();
commit;
