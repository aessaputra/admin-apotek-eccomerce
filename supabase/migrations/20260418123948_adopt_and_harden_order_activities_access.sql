create table if not exists public.order_activities (
  id uuid primary key default extensions.uuid_generate_v4(),
  order_id uuid not null references public.orders(id) on delete cascade,
  action character varying not null,
  old_status character varying,
  new_status character varying,
  actor_id uuid references auth.users(id),
  actor_type character varying default 'system'::character varying,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_order_activities_order_id
  on public.order_activities using btree (order_id);

create index if not exists idx_order_activities_actor_id
  on public.order_activities using btree (actor_id);

create index if not exists idx_order_activities_created_at
  on public.order_activities using btree (created_at desc);

alter table public.order_activities enable row level security;

revoke all on table public.order_activities from anon;
revoke insert, update, delete, truncate, trigger on table public.order_activities from authenticated;
grant select on table public.order_activities to authenticated;

do $$
declare
  policy_record record;
begin
  for policy_record in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'order_activities'
  loop
    execute format(
      'drop policy if exists %I on public.order_activities',
      policy_record.policyname
    );
  end loop;
end;
$$;

create policy "Users can view own order activities"
  on public.order_activities
  for select
  to authenticated
  using (
    (select private.is_admin())
    or exists (
      select 1
      from public.orders as o
      where o.id = order_activities.order_id
        and o.user_id = (select auth.uid())
    )
  );

create policy "Service can insert order activities"
  on public.order_activities
  for insert
  to service_role
  with check (true);
