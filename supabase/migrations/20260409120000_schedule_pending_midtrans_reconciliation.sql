begin;

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
    from public.orders o
    where o.payment_status in ('pending', 'authorize')
      and o.midtrans_order_id is not null
      and o.snap_token is not null
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

comment on function public.trigger_reconcile_pending_midtrans_payments(integer) is
  'Asynchronously invokes the reconcile-pending-midtrans-payments Edge Function for orders still stuck in pending or authorize payment states. Requires Vault secrets named project_url and service_role_key.';

do $$
begin
  if exists (
    select 1
    from cron.job
    where jobname = 'reconcile-pending-midtrans-payments-every-5min'
  ) then
    perform cron.unschedule('reconcile-pending-midtrans-payments-every-5min');
  end if;
end;
$$;

select cron.schedule(
  'reconcile-pending-midtrans-payments-every-5min',
  '*/5 * * * *',
  $$
  select public.trigger_reconcile_pending_midtrans_payments(10);
  $$
);

commit;
