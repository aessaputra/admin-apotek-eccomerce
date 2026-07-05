-- Harden public read-model/reporting views and the push-token claim RPC.
--
-- Security advisor findings addressed:
--   - public.order_read_model
--   - public.admin_monthly_operational_metrics
--   - public.report_customer_sales
--   - public.report_daily_sales
--   - public.report_product_sales
--   - public.report_sold_products
-- were SECURITY DEFINER with full anon/authenticated grants, bypassing the
-- RLS policies on the underlying order/payment/shipment/item tables.
--
--   - public.claim_profile_push_token was a SECURITY DEFINER RPC directly
-- exposed to authenticated. It intentionally needs to revoke tokens previously
-- owned by other users/devices, so the privileged logic is moved to a private
-- SECURITY DEFINER core called by a public SECURITY INVOKER wrapper.

-- 1. Force caller RLS/privileges for all public read-model/report views.
alter view public.order_read_model set (security_invoker = true);
alter view public.admin_monthly_operational_metrics set (security_invoker = true);
alter view public.report_customer_sales set (security_invoker = true);
alter view public.report_daily_sales set (security_invoker = true);
alter view public.report_product_sales set (security_invoker = true);
alter view public.report_sold_products set (security_invoker = true);

comment on view public.order_read_model is
  'Canonical order read model for admin/customer/reporting semantics. Enforces caller RLS via security_invoker.';
comment on view public.admin_monthly_operational_metrics is
  'Monthly operational aggregates sourced from order_read_model. Enforces caller RLS via security_invoker.';
comment on view public.report_customer_sales is
  'Customer sales report sourced from canonical order_read_model payment state. Enforces caller RLS via security_invoker.';
comment on view public.report_daily_sales is
  'Daily sales report sourced from canonical order_read_model payment state. Enforces caller RLS via security_invoker.';
comment on view public.report_product_sales is
  'Product sales report sourced from canonical order_read_model payment state. Enforces caller RLS via security_invoker.';
comment on view public.report_sold_products is
  'Line-item sold-products report sourced from order_items and canonical order_read_model. Enforces caller RLS via security_invoker.';

-- 2. Private SECURITY DEFINER core for cross-user/device token revocation.
create or replace function private.claim_profile_push_token_core(
  p_user_id uuid,
  p_device_id text,
  p_expo_push_token text,
  p_platform text,
  p_last_seen_at timestamp with time zone
)
returns public.profile_push_tokens
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_token_row public.profile_push_tokens;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_expo_push_token, 0));

  update public.profile_push_tokens
  set
    revoked_at = p_last_seen_at,
    last_seen_at = p_last_seen_at
  where expo_push_token = p_expo_push_token
    and revoked_at is null
    and (user_id <> p_user_id or device_id <> p_device_id);

  insert into public.profile_push_tokens (
    user_id,
    device_id,
    expo_push_token,
    platform,
    last_seen_at,
    revoked_at
  ) values (
    p_user_id,
    p_device_id,
    p_expo_push_token,
    p_platform,
    p_last_seen_at,
    null
  )
  on conflict (user_id, device_id)
  do update set
    expo_push_token = excluded.expo_push_token,
    platform = excluded.platform,
    last_seen_at = excluded.last_seen_at,
    revoked_at = null
  returning * into v_token_row;

  return v_token_row;
end;
$function$;

comment on function private.claim_profile_push_token_core(uuid, text, text, text, timestamp with time zone) is
  'Privileged core for claiming/revoking profile push tokens across users/devices. Called only by the public SECURITY INVOKER wrapper.';

-- 3. Public SECURITY INVOKER wrapper that validates caller input and delegates to the private core.
create or replace function public.claim_profile_push_token(
  p_device_id text,
  p_expo_push_token text,
  p_platform text,
  p_last_seen_at timestamp with time zone default timezone('utc'::text, now())
)
returns public.profile_push_tokens
language plpgsql
security invoker
set search_path to ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_device_id text := nullif(pg_catalog.btrim(p_device_id), '');
  v_expo_push_token text := nullif(pg_catalog.btrim(p_expo_push_token), '');
  v_platform text := nullif(pg_catalog.btrim(p_platform), '');
  v_last_seen_at timestamptz := coalesce(
    p_last_seen_at,
    pg_catalog.timezone('utc'::text, pg_catalog.now())
  );
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  if v_device_id is null then
    raise exception 'device_id is required.' using errcode = '22023';
  end if;

  if v_expo_push_token is null then
    raise exception 'expo_push_token is required.' using errcode = '22023';
  end if;

  if v_expo_push_token !~ '^(ExpoPushToken|ExponentPushToken)\[[^\]]+\]$' then
    raise exception 'expo_push_token must use ExpoPushToken[...] or ExponentPushToken[...] format.' using errcode = '22023';
  end if;

  if v_platform is null then
    raise exception 'platform is required.' using errcode = '22023';
  end if;

  return private.claim_profile_push_token_core(
    v_user_id,
    v_device_id,
    v_expo_push_token,
    v_platform,
    v_last_seen_at
  );
end;
$function$;

comment on function public.claim_profile_push_token(text, text, text, timestamp with time zone) is
  'Claims a push token for the current user/device, revoking prior claims for the same token. SECURITY INVOKER wrapper around private.claim_profile_push_token_core.';

-- 4. Lock down grants. The public wrapper remains callable by authenticated;
-- the private core is callable by authenticated only so the wrapper can delegate.
revoke all on function public.claim_profile_push_token(text, text, text, timestamp with time zone) from public, anon, authenticated;
grant execute on function public.claim_profile_push_token(text, text, text, timestamp with time zone) to authenticated;

revoke all on function private.claim_profile_push_token_core(uuid, text, text, text, timestamp with time zone) from public, anon, authenticated;
grant execute on function private.claim_profile_push_token_core(uuid, text, text, text, timestamp with time zone) to authenticated;
