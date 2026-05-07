begin;

create schema if not exists private;

create table if not exists public.profile_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  device_id text not null,
  expo_push_token text not null,
  platform text not null,
  last_seen_at timestamptz not null default timezone('utc'::text, now()),
  revoked_at timestamptz,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

alter table public.profile_push_tokens
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists user_id uuid,
  add column if not exists device_id text,
  add column if not exists expo_push_token text,
  add column if not exists platform text,
  add column if not exists last_seen_at timestamptz default timezone('utc'::text, now()),
  add column if not exists revoked_at timestamptz,
  add column if not exists created_at timestamptz default timezone('utc'::text, now()),
  add column if not exists updated_at timestamptz default timezone('utc'::text, now());

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profile_push_tokens_user_id_fkey'
      and conrelid = 'public.profile_push_tokens'::regclass
  ) then
    alter table public.profile_push_tokens
      add constraint profile_push_tokens_user_id_fkey
      foreign key (user_id) references public.profiles(id) on delete cascade;
  end if;
end;
$$;

update public.profile_push_tokens
set
  last_seen_at = coalesce(last_seen_at, timezone('utc'::text, now())),
  created_at = coalesce(created_at, timezone('utc'::text, now())),
  updated_at = coalesce(updated_at, timezone('utc'::text, now()));

alter table public.profile_push_tokens
  alter column id set not null,
  alter column user_id set not null,
  alter column device_id set not null,
  alter column expo_push_token set not null,
  alter column platform set not null,
  alter column last_seen_at set not null,
  alter column created_at set not null,
  alter column updated_at set not null;

create unique index if not exists profile_push_tokens_user_device_uidx
  on public.profile_push_tokens (user_id, device_id);

create unique index if not exists profile_push_tokens_active_expo_push_token_uidx
  on public.profile_push_tokens (expo_push_token)
  where revoked_at is null;

create index if not exists profile_push_tokens_user_active_seen_idx
  on public.profile_push_tokens (user_id, last_seen_at desc)
  where revoked_at is null;

create table if not exists public.notification_push_deliveries (
  notification_id uuid not null references public.notifications(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  expo_push_token text not null,
  status text not null,
  ticket_id text,
  receipt_id text,
  error_code text,
  error_message text,
  attempt_count integer not null default 0,
  next_retry_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint notification_push_deliveries_attempt_count_nonnegative check (attempt_count >= 0),
  constraint notification_push_deliveries_pkey primary key (notification_id, expo_push_token)
);

alter table public.notification_push_deliveries
  add column if not exists notification_id uuid,
  add column if not exists user_id uuid,
  add column if not exists expo_push_token text,
  add column if not exists status text,
  add column if not exists ticket_id text,
  add column if not exists receipt_id text,
  add column if not exists error_code text,
  add column if not exists error_message text,
  add column if not exists attempt_count integer default 0,
  add column if not exists next_retry_at timestamptz,
  add column if not exists delivered_at timestamptz,
  add column if not exists failed_at timestamptz,
  add column if not exists created_at timestamptz default timezone('utc'::text, now()),
  add column if not exists updated_at timestamptz default timezone('utc'::text, now());

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'notification_push_deliveries_notification_id_fkey'
      and conrelid = 'public.notification_push_deliveries'::regclass
  ) then
    alter table public.notification_push_deliveries
      add constraint notification_push_deliveries_notification_id_fkey
      foreign key (notification_id) references public.notifications(id) on delete cascade;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'notification_push_deliveries_user_id_fkey'
      and conrelid = 'public.notification_push_deliveries'::regclass
  ) then
    alter table public.notification_push_deliveries
      add constraint notification_push_deliveries_user_id_fkey
      foreign key (user_id) references public.profiles(id) on delete cascade;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'notification_push_deliveries_attempt_count_nonnegative'
      and conrelid = 'public.notification_push_deliveries'::regclass
  ) then
    alter table public.notification_push_deliveries
      add constraint notification_push_deliveries_attempt_count_nonnegative
      check (attempt_count >= 0);
  end if;
end;
$$;

update public.notification_push_deliveries
set
  status = coalesce(status, 'unknown'),
  attempt_count = coalesce(attempt_count, 0),
  created_at = coalesce(created_at, timezone('utc'::text, now())),
  updated_at = coalesce(updated_at, timezone('utc'::text, now()));

alter table public.notification_push_deliveries
  alter column notification_id set not null,
  alter column user_id set not null,
  alter column expo_push_token set not null,
  alter column status set not null,
  alter column attempt_count set not null,
  alter column created_at set not null,
  alter column updated_at set not null;

create index if not exists notification_push_deliveries_user_created_idx
  on public.notification_push_deliveries (user_id, created_at desc);

create index if not exists notification_push_deliveries_pending_receipts_idx
  on public.notification_push_deliveries (ticket_id, next_retry_at, created_at)
  where ticket_id is not null
    and receipt_id is null
    and delivered_at is null
    and failed_at is null;

create index if not exists notification_push_deliveries_retry_idx
  on public.notification_push_deliveries (next_retry_at, attempt_count)
  where next_retry_at is not null
    and failed_at is null
    and delivered_at is null;

create or replace function public.set_profile_push_tokens_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$;

drop trigger if exists trigger_set_profile_push_tokens_updated_at on public.profile_push_tokens;
create trigger trigger_set_profile_push_tokens_updated_at
before update on public.profile_push_tokens
for each row
execute function public.set_profile_push_tokens_updated_at();

create or replace function public.set_notification_push_deliveries_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$;

drop trigger if exists trigger_set_notification_push_deliveries_updated_at on public.notification_push_deliveries;
create trigger trigger_set_notification_push_deliveries_updated_at
before update on public.notification_push_deliveries
for each row
execute function public.set_notification_push_deliveries_updated_at();

alter table public.profile_push_tokens enable row level security;
alter table public.notification_push_deliveries enable row level security;

drop policy if exists "Users can view own profile push tokens" on public.profile_push_tokens;
create policy "Users can view own profile push tokens"
  on public.profile_push_tokens
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own profile push tokens" on public.profile_push_tokens;
create policy "Users can insert own profile push tokens"
  on public.profile_push_tokens
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own profile push tokens" on public.profile_push_tokens;
create policy "Users can update own profile push tokens"
  on public.profile_push_tokens
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete own profile push tokens" on public.profile_push_tokens;
create policy "Users can delete own profile push tokens"
  on public.profile_push_tokens
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.profile_push_tokens to authenticated;
revoke all on public.notification_push_deliveries from anon, authenticated;

create or replace function private.invoke_push_for_notification_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_url text;
  v_service_role_key text;
  v_request_id bigint;
begin
  if new.data ->> 'audience' = 'admin_dashboard' then
    return new;
  end if;

  select decrypted_secret
  into v_project_url
  from vault.decrypted_secrets
  where name = 'project_url'
  limit 1;

  select decrypted_secret
  into v_service_role_key
  from vault.decrypted_secrets
  where name = 'service_role_key'
  limit 1;

  if v_project_url is null
    or btrim(v_project_url) = ''
    or v_service_role_key is null
    or btrim(v_service_role_key) = '' then
    raise warning 'Skipping push invocation for notification %, missing project_url or service_role_key Vault secret', new.id;
    return new;
  end if;

  select net.http_post(
    url := rtrim(v_project_url, '/') || '/functions/v1/push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_role_key
    ),
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'notifications',
      'schema', 'public',
      'record', to_jsonb(new),
      'old_record', null
    )
  ) into v_request_id;

  return new;
exception
  when others then
    raise warning 'Skipping push invocation for notification %, error: %', new.id, sqlerrm;
    return new;
end;
$$;

comment on function private.invoke_push_for_notification_insert() is
  'After-insert notification trigger that asynchronously invokes the push Edge Function using Vault project_url and service_role_key secrets.';

revoke all on function private.invoke_push_for_notification_insert() from public, anon, authenticated;

drop trigger if exists notifications_push_after_insert_trigger on public.notifications;
create trigger notifications_push_after_insert_trigger
after insert on public.notifications
for each row
execute function private.invoke_push_for_notification_insert();

create or replace function public.trigger_process_push_receipts(
  p_limit integer default 100
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_due_receipt_exists boolean := false;
  v_project_url text;
  v_service_role_key text;
  v_request_id bigint;
begin
  select exists (
    select 1
    from public.notification_push_deliveries d
    where d.ticket_id is not null
      and d.receipt_id is null
      and d.delivered_at is null
      and d.failed_at is null
      and (d.next_retry_at is null or d.next_retry_at <= timezone('utc'::text, now()))
  ) into v_due_receipt_exists;

  if not v_due_receipt_exists then
    return null;
  end if;

  select decrypted_secret
  into v_project_url
  from vault.decrypted_secrets
  where name = 'project_url'
  limit 1;

  if v_project_url is null or btrim(v_project_url) = '' then
    raise exception 'Missing vault secret "project_url" for push receipt processor schedule';
  end if;

  select decrypted_secret
  into v_service_role_key
  from vault.decrypted_secrets
  where name = 'service_role_key'
  limit 1;

  if v_service_role_key is null or btrim(v_service_role_key) = '' then
    raise exception 'Missing vault secret "service_role_key" for push receipt processor schedule';
  end if;

  select net.http_post(
    url := rtrim(v_project_url, '/') || '/functions/v1/push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_role_key
    ),
    body := jsonb_build_object(
      'action', 'process_receipts',
      'limit', greatest(1, least(coalesce(p_limit, 100), 100))
    )
  ) into v_request_id;

  return v_request_id;
end;
$$;

comment on function public.trigger_process_push_receipts(integer) is
  'Asynchronously invokes the push Edge Function receipt polling action for pending Expo tickets. Requires Vault secrets named project_url and service_role_key.';

revoke all on function public.trigger_process_push_receipts(integer) from public, anon, authenticated;

do $$
begin
  if exists (
    select 1
    from cron.job
    where jobname = 'process-push-receipts-every-5-minutes'
  ) then
    perform cron.unschedule('process-push-receipts-every-5-minutes');
  end if;
end;
$$;

select cron.schedule(
  'process-push-receipts-every-5-minutes',
  '*/5 * * * *',
  $$
  select public.trigger_process_push_receipts(100);
  $$
);

commit;
