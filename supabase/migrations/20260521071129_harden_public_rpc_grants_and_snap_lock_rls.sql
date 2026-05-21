-- Least-privilege hardening for selected RPCs and lock state in public.
-- claim_profile_push_token intentionally remains authenticated SECURITY DEFINER
-- for signed-in profile token registration; this is an accepted Supabase advisor exception
-- until the API is moved out of the exposed schema.
-- admin_operational_metrics keeps authenticated admin-app access, while
-- internal cron and storage-cleanup RPCs remain service-role only.
revoke all on function public.claim_profile_push_token(text, text, text, timestamptz) from public, anon, service_role;
grant execute on function public.claim_profile_push_token(text, text, text, timestamptz) to authenticated;

revoke all on function public.admin_operational_metrics(text, date, date) from public, anon, service_role;
grant execute on function public.admin_operational_metrics(text, date, date) to authenticated;

revoke all on function public.cancel_expired_orders() from public, anon, authenticated;
grant execute on function public.cancel_expired_orders() to service_role;

revoke all on function public.list_cleanup_storage_objects(text, timestamptz, integer, integer) from public, anon, authenticated;
grant execute on function public.list_cleanup_storage_objects(text, timestamptz, integer, integer) to service_role;

-- The lock table lives in the exposed public schema for function access, so keep
-- service-role table grants available while explicitly denying direct browser access.
alter table public.snap_token_generation_locks enable row level security;

drop policy if exists snap_token_generation_locks_deny_browser_access
on public.snap_token_generation_locks;

create policy snap_token_generation_locks_deny_browser_access
on public.snap_token_generation_locks
as restrictive
for all
to anon, authenticated
using (false)
with check (false);
