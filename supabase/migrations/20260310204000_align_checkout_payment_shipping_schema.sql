begin;
alter table public.orders
  add column if not exists origin_area_id text,
  add column if not exists destination_area_id text,
  add column if not exists destination_postal_code integer,
  add column if not exists biteship_order_id text,
  add column if not exists updated_at timestamptz default timezone('utc'::text, now());
alter table public.orders
  alter column status set default 'pending',
  alter column payment_status set default 'unpaid';
alter table public.products
  add column if not exists weight integer default 200;
update public.products
set weight = 200
where weight is null;
alter table public.products
  alter column weight set not null;
alter table public.addresses
  add column if not exists area_id text;
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'addresses'
      and column_name = 'latitude'
      and data_type = 'double precision'
  ) then
    alter table public.addresses
      alter column latitude type text using latitude::text;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'addresses'
      and column_name = 'longitude'
      and data_type = 'double precision'
  ) then
    alter table public.addresses
      alter column longitude type text using longitude::text;
  end if;
end
$$;
create table if not exists public.webhook_idempotency (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_key text not null,
  created_at timestamptz default timezone('utc'::text, now()),
  unique (provider, event_key)
);
alter table public.webhook_idempotency
  add column if not exists created_at timestamptz default timezone('utc'::text, now());
create index if not exists webhook_idempotency_provider_created_idx
  on public.webhook_idempotency (provider, created_at desc);
create or replace function public.update_orders_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$;
drop trigger if exists trigger_update_orders_updated_at on public.orders;
create trigger trigger_update_orders_updated_at
before update on public.orders
for each row
execute function public.update_orders_updated_at();
commit;
