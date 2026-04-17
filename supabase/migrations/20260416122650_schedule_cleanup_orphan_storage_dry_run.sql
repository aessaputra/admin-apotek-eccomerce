begin;

create or replace function public.trigger_cleanup_orphan_storage_dry_run(
  p_sample_limit integer default 25,
  p_max_delete_count integer default 200
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_managed_media_exists boolean := false;
  v_project_url text;
  v_service_role_key text;
  v_request_id bigint;
begin
  select exists (
    select 1
    from storage.objects o
    where o.bucket_id = 'media'
      and (
        (storage.foldername(o.name))[1] = any (array['categories', 'products', 'avatars', 'settings'])
        or (
          (storage.foldername(o.name))[1] = 'banners'
          and (storage.foldername(o.name))[2] = any (array['home_banner_top', 'home_banner_bottom'])
        )
      )
  ) into v_managed_media_exists;

  if not v_managed_media_exists then
    return null;
  end if;

  select decrypted_secret
  into v_project_url
  from vault.decrypted_secrets
  where name = 'project_url'
  limit 1;

  if v_project_url is null or btrim(v_project_url) = '' then
    raise exception 'Missing vault secret "project_url" for cleanup orphan storage dry-run schedule';
  end if;

  select decrypted_secret
  into v_service_role_key
  from vault.decrypted_secrets
  where name = 'service_role_key'
  limit 1;

  if v_service_role_key is null or btrim(v_service_role_key) = '' then
    raise exception 'Missing vault secret "service_role_key" for cleanup orphan storage dry-run schedule';
  end if;

  select net.http_post(
    url := rtrim(v_project_url, '/') || '/functions/v1/cleanup-orphan-storage',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_role_key
    ),
    body := jsonb_build_object(
      'mode', 'dry-run',
      'sampleLimit', greatest(1, least(coalesce(p_sample_limit, 25), 100)),
      'maxDeleteCount', greatest(1, least(coalesce(p_max_delete_count, 200), 10000)),
      'triggerSource', 'schedule'
    )
  ) into v_request_id;

  return v_request_id;
end;
$$;

comment on function public.trigger_cleanup_orphan_storage_dry_run(integer, integer) is
  'Asynchronously invokes the cleanup-orphan-storage Edge Function in dry-run mode. Requires Vault secrets named project_url and service_role_key.';

do $$
begin
  if exists (
    select 1
    from cron.job
    where jobname = 'cleanup-orphan-storage-dry-run-daily'
  ) then
    perform cron.unschedule('cleanup-orphan-storage-dry-run-daily');
  end if;
end;
$$;

select cron.schedule(
  'cleanup-orphan-storage-dry-run-daily',
  '0 3 * * *',
  $$
  select public.trigger_cleanup_orphan_storage_dry_run(25, 200);
  $$
);

commit;
