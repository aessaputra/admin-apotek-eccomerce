begin;

alter table public.profiles
  add column if not exists expo_push_token text,
  add column if not exists expo_push_token_updated_at timestamptz;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  cta_route text,
  data jsonb not null default '{}'::jsonb,
  priority text not null default 'normal',
  source_event_key text,
  read_at timestamptz,
  created_at timestamptz not null default timezone('utc'::text, now())
);

alter table public.notifications
  add column if not exists user_id uuid,
  add column if not exists type text,
  add column if not exists title text,
  add column if not exists body text,
  add column if not exists cta_route text,
  add column if not exists data jsonb,
  add column if not exists priority text,
  add column if not exists source_event_key text,
  add column if not exists read_at timestamptz,
  add column if not exists created_at timestamptz;

alter table public.notifications
  alter column data set default '{}'::jsonb,
  alter column priority set default 'normal',
  alter column created_at set default timezone('utc'::text, now());

update public.notifications
set data = '{}'::jsonb
where data is null;

update public.notifications
set priority = 'normal'
where priority is null;

update public.notifications
set created_at = timezone('utc'::text, now())
where created_at is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'notifications_user_id_fkey'
      and conrelid = 'public.notifications'::regclass
  ) then
    alter table public.notifications
      add constraint notifications_user_id_fkey
      foreign key (user_id) references public.profiles(id) on delete cascade;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'notifications_priority_check'
      and conrelid = 'public.notifications'::regclass
  ) then
    alter table public.notifications
      add constraint notifications_priority_check
      check (priority = any (array['low'::text, 'normal'::text, 'high'::text]));
  end if;
end;
$$;

alter table public.notifications
  alter column user_id set not null,
  alter column type set not null,
  alter column title set not null,
  alter column body set not null,
  alter column data set not null,
  alter column priority set not null,
  alter column created_at set not null;

create index if not exists notifications_user_created_at_idx
  on public.notifications (user_id, created_at desc);

create index if not exists notifications_user_read_at_created_at_idx
  on public.notifications (user_id, read_at, created_at desc);

create unique index if not exists notifications_user_source_event_key_uidx
  on public.notifications (user_id, source_event_key)
  where source_event_key is not null;

alter table public.notifications enable row level security;

drop policy if exists "Users can view own notifications" on public.notifications;
create policy "Users can view own notifications"
  on public.notifications
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can update own notifications" on public.notifications;
create policy "Users can update own notifications"
  on public.notifications
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

commit;
