begin;
create table if not exists public.webhook_side_effect_tasks (
  order_id uuid primary key references public.orders(id) on delete cascade,
  needs_stock boolean not null default false,
  needs_biteship boolean not null default false,
  retry_count integer not null default 0,
  last_error text,
  updated_at timestamptz not null default timezone('utc'::text, now()),
  created_at timestamptz not null default timezone('utc'::text, now())
);
create index if not exists webhook_side_effect_tasks_updated_idx
  on public.webhook_side_effect_tasks (updated_at desc);
commit;
