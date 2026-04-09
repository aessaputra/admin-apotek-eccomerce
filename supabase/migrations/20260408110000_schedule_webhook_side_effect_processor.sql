begin;

create or replace function public.trigger_process_webhook_side_effects(
  p_limit integer default 10
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
    where t.lease_until is null or t.lease_until < timezone('utc'::text, now())
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
      'limit', greatest(1, least(coalesce(p_limit, 10), 50))
    )
  ) into v_request_id;

  return v_request_id;
end;
$$;

comment on function public.trigger_process_webhook_side_effects(integer) is
  'Asynchronously invokes the process-webhook-side-effects Edge Function for due webhook_side_effect_tasks. Requires Vault secrets named project_url and service_role_key.';

select cron.unschedule('process-webhook-side-effects-every-minute');

select cron.schedule(
  'process-webhook-side-effects-every-minute',
  '* * * * *',
  $$
  select public.trigger_process_webhook_side_effects(10);
  $$
);

commit;
