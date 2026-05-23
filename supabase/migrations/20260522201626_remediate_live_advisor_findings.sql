-- Remediate rls_enabled_no_policy advisor findings with explicit deny policies.
-- These tables intentionally remain service-role/private-operational surfaces.

alter table private.integration_config_audit_logs enable row level security;

drop policy if exists integration_config_audit_logs_deny_direct_access
on private.integration_config_audit_logs;

-- Intended actors: service_role integration-configuration maintenance and audit writers only; direct browser/API actors are denied.
create policy integration_config_audit_logs_deny_direct_access
on private.integration_config_audit_logs
for all
to public
using (false)
with check (false);

comment on policy integration_config_audit_logs_deny_direct_access
on private.integration_config_audit_logs
is 'Explicit deny policy: private.integration_config_audit_logs remains service-role only for integration configuration audit history; direct browser/API access is not an intended actor.';

alter table private.integration_config_current_versions enable row level security;

drop policy if exists integration_config_current_versions_deny_direct_access
on private.integration_config_current_versions;

-- Intended actors: service_role integration-configuration readers/writers only; direct browser/API actors are denied.
create policy integration_config_current_versions_deny_direct_access
on private.integration_config_current_versions
for all
to public
using (false)
with check (false);

comment on policy integration_config_current_versions_deny_direct_access
on private.integration_config_current_versions
is 'Explicit deny policy: private.integration_config_current_versions remains service-role only for active integration configuration resolution; direct browser/API access is not an intended actor.';

alter table private.integration_config_keys enable row level security;

drop policy if exists integration_config_keys_deny_direct_access
on private.integration_config_keys;

-- Intended actors: service_role integration-configuration key management only; direct browser/API actors are denied.
create policy integration_config_keys_deny_direct_access
on private.integration_config_keys
for all
to public
using (false)
with check (false);

comment on policy integration_config_keys_deny_direct_access
on private.integration_config_keys
is 'Explicit deny policy: private.integration_config_keys remains service-role only for integration configuration metadata; direct browser/API access is not an intended actor.';

alter table private.integration_config_rollout_status enable row level security;

drop policy if exists integration_config_rollout_status_deny_direct_access
on private.integration_config_rollout_status;

-- Intended actors: service_role integration-configuration rollout workers only; direct browser/API actors are denied.
create policy integration_config_rollout_status_deny_direct_access
on private.integration_config_rollout_status
for all
to public
using (false)
with check (false);

comment on policy integration_config_rollout_status_deny_direct_access
on private.integration_config_rollout_status
is 'Explicit deny policy: private.integration_config_rollout_status remains service-role only for integration rollout state; direct browser/API access is not an intended actor.';

alter table private.integration_config_versions enable row level security;

drop policy if exists integration_config_versions_deny_direct_access
on private.integration_config_versions;

-- Intended actors: service_role integration-configuration version management only; direct browser/API actors are denied.
create policy integration_config_versions_deny_direct_access
on private.integration_config_versions
for all
to public
using (false)
with check (false);

comment on policy integration_config_versions_deny_direct_access
on private.integration_config_versions
is 'Explicit deny policy: private.integration_config_versions remains service-role only for versioned integration secrets and metadata; direct browser/API access is not an intended actor.';

alter table private.midtrans_payment_config_bindings enable row level security;

drop policy if exists midtrans_payment_config_bindings_deny_direct_access
on private.midtrans_payment_config_bindings;

-- Intended actors: service_role Midtrans payment configuration resolvers only; direct browser/API actors are denied.
create policy midtrans_payment_config_bindings_deny_direct_access
on private.midtrans_payment_config_bindings
for all
to public
using (false)
with check (false);

comment on policy midtrans_payment_config_bindings_deny_direct_access
on private.midtrans_payment_config_bindings
is 'Explicit deny policy: private.midtrans_payment_config_bindings remains service-role only for Midtrans payment configuration binding resolution; direct browser/API access is not an intended actor.';

alter table private.order_integration_config_snapshots enable row level security;

drop policy if exists order_integration_config_snapshots_deny_direct_access
on private.order_integration_config_snapshots;

-- Intended actors: service_role order/payment/shipping integration snapshot writers only; direct browser/API actors are denied.
create policy order_integration_config_snapshots_deny_direct_access
on private.order_integration_config_snapshots
for all
to public
using (false)
with check (false);

comment on policy order_integration_config_snapshots_deny_direct_access
on private.order_integration_config_snapshots
is 'Explicit deny policy: private.order_integration_config_snapshots remains service-role only for order integration configuration snapshots; direct browser/API access is not an intended actor.';

alter table public.notification_push_deliveries enable row level security;

drop policy if exists notification_push_deliveries_deny_direct_access
on public.notification_push_deliveries;

-- Intended actors: service_role push Edge Function usage only; notification_push_deliveries intentionally remains service-role only and direct browser/API actors are denied.
create policy notification_push_deliveries_deny_direct_access
on public.notification_push_deliveries
for all
to public
using (false)
with check (false);

comment on policy notification_push_deliveries_deny_direct_access
on public.notification_push_deliveries
is 'Explicit deny policy: notification_push_deliveries intentionally remains service-role only for push Edge Function delivery tracking; direct browser/API access is not an intended actor.';

-- Accepted Supabase advisor exception: claim_profile_push_token intentionally remains
-- an authenticated SECURITY DEFINER RPC because the customer frontend calls it directly
-- for signed-in Expo push-token registration. Authenticated execute retained intentionally:
-- the function body reads auth.uid(), rejects unauthenticated callers, validates bounded
-- token inputs, revokes conflicting active token rows, and upserts only the caller-owned
-- (user_id, device_id) row. The current definition is hardened with SET search_path TO ''.
revoke all on function public.claim_profile_push_token(text, text, text, timestamptz)
from public, anon, service_role;

grant execute on function public.claim_profile_push_token(text, text, text, timestamptz) to authenticated;

comment on function public.claim_profile_push_token(text, text, text, timestamptz)
is 'Accepted authenticated SECURITY DEFINER exception for customer frontend Expo push-token registration. Authenticated execute retained intentionally; body-level auth.uid() ownership validation, bounded token upsert/revocation behavior, and SET search_path TO '''' hardening limit the exposed RPC surface.';

-- Remediate unindexed_foreign_keys advisor findings with exact FK-column covering indexes.
-- integration_config_audit_logs_version_id_fkey
create index if not exists integration_config_audit_logs_version_id_fk_idx
on private.integration_config_audit_logs (version_id);

-- integration_config_current_versions_activated_by_fkey
create index if not exists integration_config_current_versions_activated_by_fk_idx
on private.integration_config_current_versions (activated_by);

-- integration_config_current_versions_version_matches_key
create index if not exists integration_config_current_versions_version_matches_key_fk_idx
on private.integration_config_current_versions (key_name, version_number, version_id);

-- integration_config_versions_created_by_fkey
create index if not exists integration_config_versions_created_by_fk_idx
on private.integration_config_versions (created_by);

-- midtrans_payment_config_bindings_is_production_version_fk
create index if not exists midtrans_payment_config_bindings_is_production_version_fk_idx
on private.midtrans_payment_config_bindings (is_production_config_key_name, is_production_version_number, is_production_version_id);

-- midtrans_payment_config_bindings_server_key_version_fk
create index if not exists midtrans_payment_config_bindings_server_key_version_fk_idx
on private.midtrans_payment_config_bindings (server_key_config_key_name, server_key_version_number, server_key_version_id);

-- order_integration_config_snapshots_created_by_fkey
create index if not exists order_integration_config_snapshots_created_by_fk_idx
on private.order_integration_config_snapshots (created_by);

-- Consolidate public.addresses SELECT access so authenticated owner reads and admin order-shipping reads share one permissive SELECT policy.
drop policy if exists "Admins can view order shipping addresses" on public.addresses;
drop policy if exists "Users can manage their own addresses" on public.addresses;
drop policy if exists addresses_authenticated_select on public.addresses;

create policy addresses_authenticated_select
on public.addresses
as permissive
for select
to authenticated
using (
  ((select auth.uid()) = profile_id)
  or (
    (select private.is_admin())
    and exists (
      select 1
      from public.orders
      where orders.shipping_address_id = addresses.id
    )
  )
);

drop policy if exists addresses_owner_insert on public.addresses;

create policy addresses_owner_insert
on public.addresses
for insert
to authenticated
with check (((select auth.uid()) = profile_id));

drop policy if exists addresses_owner_update on public.addresses;

create policy addresses_owner_update
on public.addresses
for update
to authenticated
using (((select auth.uid()) = profile_id))
with check (((select auth.uid()) = profile_id));

drop policy if exists addresses_owner_delete on public.addresses;

create policy addresses_owner_delete
on public.addresses
for delete
to authenticated
using (((select auth.uid()) = profile_id));
