begin;

alter table public.orders
  add column if not exists biteship_tracking_id text;

comment on column public.orders.biteship_tracking_id is
  'Canonical Biteship tracking identifier returned by courier tracking APIs.';

alter table public.webhook_side_effect_tasks
  add column if not exists lease_owner text,
  add column if not exists next_retry_at timestamptz,
  add column if not exists last_attempted_at timestamptz,
  add column if not exists last_error_code text,
  add column if not exists failed_permanently_at timestamptz,
  add column if not exists pending_tracking_id text;

create index if not exists webhook_side_effect_tasks_due_retry_idx
  on public.webhook_side_effect_tasks (next_retry_at, lease_until)
  where failed_permanently_at is null;

create index if not exists webhook_side_effect_tasks_lease_owner_idx
  on public.webhook_side_effect_tasks (lease_owner, lease_until);

alter table public.settings
  drop constraint if exists settings_origin_postal_code_format;

alter table public.settings
  add constraint settings_origin_postal_code_format
    check (origin_postal_code ~ '^[0-9]{5}$');

comment on column public.settings.origin_postal_code is
  'Five-digit Indonesian origin postal code used for Biteship shipping requests.';

create or replace function public.trigger_process_webhook_side_effects(
  p_limit integer default 3
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_due_task_exists boolean := false;
  v_project_url text;
  v_service_role_key text;
  v_request_id bigint;
begin
  select exists (
    select 1
    from public.webhook_side_effect_tasks t
    where t.failed_permanently_at is null
      and (t.next_retry_at is null or t.next_retry_at <= timezone('utc'::text, now()))
      and (t.lease_until is null or t.lease_until < timezone('utc'::text, now()))
  ) into v_due_task_exists;

  if not v_due_task_exists then
    return null;
  end if;

  select decrypted_secret
  into v_project_url
  from vault.decrypted_secrets
  where name = 'project_url'
  limit 1;

  if v_project_url is null or btrim(v_project_url) = '' then
    raise exception 'Missing vault secret "project_url" for webhook side effect processor schedule';
  end if;

  select decrypted_secret
  into v_service_role_key
  from vault.decrypted_secrets
  where name = 'service_role_key'
  limit 1;

  if v_service_role_key is null or btrim(v_service_role_key) = '' then
    raise exception 'Missing vault secret "service_role_key" for webhook side effect processor schedule';
  end if;

  select net.http_post(
    url := rtrim(v_project_url, '/') || '/functions/v1/process-webhook-side-effects',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_role_key
    ),
    body := jsonb_build_object(
      'limit', greatest(1, least(coalesce(p_limit, 3), 3))
    )
  ) into v_request_id;

  return v_request_id;
end;
$$;

comment on function public.trigger_process_webhook_side_effects(integer) is
  'Asynchronously invokes the process-webhook-side-effects Edge Function for due webhook_side_effect_tasks. Requires Vault secrets named project_url and service_role_key.';

do $$
begin
  if exists (
    select 1
    from cron.job
    where jobname = 'process-webhook-side-effects-every-minute'
  ) then
    perform cron.unschedule('process-webhook-side-effects-every-minute');
  end if;
end;
$$;

select cron.schedule(
  'process-webhook-side-effects-every-minute',
  '* * * * *',
  $$
  select public.trigger_process_webhook_side_effects(3);
  $$
);

commit;
