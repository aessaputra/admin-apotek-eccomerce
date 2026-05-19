begin;

-- Task 11 operator guidance uses placeholders only. Store real provider secrets in an
-- uncommitted env file and load them with `supabase secrets set --env-file <path>`;
-- verify presence with `supabase secrets list`, which does not print values.
-- Example placeholder env file lines:
-- MIDTRANS_SERVER_KEY=YOUR_MIDTRANS_SERVER_KEY_PLACEHOLDER
-- BITESHIP_API_KEY=YOUR_BITESHIP_API_KEY_PLACEHOLDER
-- For Vault-backed runtime config, rotate through the service-role-only RPC with
-- placeholders such as `YOUR_MIDTRANS_SERVER_KEY_PLACEHOLDER`; never paste real
-- values into committed SQL, migrations, tests, evidence, or terminal output.
-- Dashboard SQL one-time examples must call vault.create_secret only with local
-- placeholder text during documentation review, then operators replace it privately.

create table if not exists private.integration_config_rollout_status (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  target_type text not null,
  target_id uuid not null,
  status text not null,
  reason text not null,
  safe_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default pg_catalog.timezone('utc'::text, pg_catalog.now()),
  updated_at timestamptz not null default pg_catalog.timezone('utc'::text, pg_catalog.now()),
  constraint integration_config_rollout_status_provider_check
    check (provider = any (array['midtrans'::text, 'biteship'::text])),
  constraint integration_config_rollout_status_target_type_check
    check (target_type = any (array['payment'::text, 'order'::text])),
  constraint integration_config_rollout_status_state_check
    check (status = any (array['backfilled'::text, 'retryable'::text, 'skipped'::text])),
  constraint integration_config_rollout_status_safe_metadata_object_check
    check (pg_catalog.jsonb_typeof(safe_metadata) = 'object'),
  constraint integration_config_rollout_status_target_uidx
    unique (provider, target_type, target_id)
);

create index if not exists integration_config_rollout_status_provider_status_idx
  on private.integration_config_rollout_status (provider, status, created_at desc);

alter table private.integration_config_rollout_status enable row level security;
alter table private.integration_config_rollout_status force row level security;

create or replace function private.set_integration_config_rollout_status_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.timezone('utc'::text, pg_catalog.now());
  return new;
end;
$$;

drop trigger if exists integration_config_rollout_status_updated_at_trigger
  on private.integration_config_rollout_status;
create trigger integration_config_rollout_status_updated_at_trigger
before update on private.integration_config_rollout_status
for each row
execute function private.set_integration_config_rollout_status_updated_at();

do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'midtrans_payment_config_bindings_source_check'
  ) then
    alter table private.midtrans_payment_config_bindings
      drop constraint midtrans_payment_config_bindings_source_check;
  end if;
end;
$$;

alter table private.midtrans_payment_config_bindings
  add constraint midtrans_payment_config_bindings_source_check
    check (binding_source = any (array[
      'create_snap_token'::text,
      'snap_token_created'::text,
      'snap_token_reuse'::text,
      'legacy_backfill'::text,
      'legacy_rollout_backfill'::text
    ]));

with active_midtrans_config as (
  select
    server_version.id as server_key_version_id,
    server_version.version_number as server_key_version_number,
    production_version.id as is_production_version_id,
    production_version.version_number as is_production_version_number,
    (production_version.non_secret_value::text)::boolean as is_production
  from private.integration_config_current_versions as server_current
  join private.integration_config_versions as server_version
    on server_version.id = server_current.version_id
   and server_version.key_name = server_current.key_name
   and server_version.version_number = server_current.version_number
  join private.integration_config_current_versions as production_current
    on production_current.key_name = 'midtrans.is_production'
  join private.integration_config_versions as production_version
    on production_version.id = production_current.version_id
   and production_version.key_name = production_current.key_name
   and production_version.version_number = production_current.version_number
  where server_current.key_name = 'midtrans.server_key'
    and server_version.key_name = 'midtrans.server_key'
    and production_version.key_name = 'midtrans.is_production'
    and server_version.status = 'active'
    and production_version.status = 'active'
    and pg_catalog.jsonb_typeof(production_version.non_secret_value) = 'boolean'
  limit 1
), legacy_midtrans_candidates as (
  select
    p.id as payment_id,
    p.midtrans_order_id,
    p.status,
    existing_binding.id as existing_binding_id
  from public.payments as p
  left join private.midtrans_payment_config_bindings as existing_binding
    on existing_binding.payment_id = p.id
  where p.midtrans_order_id is not null
    and p.status in ('pending'::public.payment_status, 'authorize'::public.payment_status)
), inserted_midtrans_bindings as (
  insert into private.midtrans_payment_config_bindings (
    payment_id,
    midtrans_order_id,
    server_key_config_key_name,
    server_key_version_id,
    server_key_version_number,
    is_production_config_key_name,
    is_production_version_id,
    is_production_version_number,
    is_production,
    binding_source
  )
  select
    candidate.payment_id,
    candidate.midtrans_order_id,
    'midtrans.server_key',
    active_config.server_key_version_id,
    active_config.server_key_version_number,
    'midtrans.is_production',
    active_config.is_production_version_id,
    active_config.is_production_version_number,
    active_config.is_production,
    'legacy_rollout_backfill'
  from legacy_midtrans_candidates as candidate
  cross join active_midtrans_config as active_config
  where candidate.existing_binding_id is null
  on conflict (payment_id) do nothing
  returning payment_id
)
insert into private.integration_config_rollout_status (
  provider,
  target_type,
  target_id,
  status,
  reason,
  safe_metadata
)
select
  'midtrans',
  'payment',
  candidate.payment_id,
  case
    when candidate.existing_binding_id is not null then 'skipped'
    when inserted.payment_id is not null then 'backfilled'
    else 'retryable'
  end,
  case
    when candidate.existing_binding_id is not null then 'already_bound'
    when inserted.payment_id is not null then 'legacy_midtrans_binding_backfilled'
    else 'retryable_missing_midtrans_config'
  end,
  pg_catalog.jsonb_build_object(
    'midtrans_order_id_present', candidate.midtrans_order_id is not null,
    'payment_status', candidate.status::text
  )
from legacy_midtrans_candidates as candidate
left join inserted_midtrans_bindings as inserted
  on inserted.payment_id = candidate.payment_id
on conflict (provider, target_type, target_id) do update
set
  status = excluded.status,
  reason = excluded.reason,
  safe_metadata = excluded.safe_metadata,
  updated_at = pg_catalog.timezone('utc'::text, pg_catalog.now());

with required_biteship_config_versions as (
  select
    v.key_name,
    v.id,
    v.version_number
  from private.integration_config_current_versions as c
  join private.integration_config_versions as v
    on v.id = c.version_id
   and v.key_name = c.key_name
   and v.version_number = c.version_number
  where v.status = 'active'
    and v.key_name in (
      'biteship.origin_postal_code',
      'biteship.origin_area_id',
      'biteship.origin_latitude',
      'biteship.origin_longitude',
      'biteship.enabled_couriers',
      'shop.shipper_name',
      'shop.shipper_phone',
      'shop.shipper_email',
      'shop.address',
      'shop.organization'
    )
), biteship_config_metadata as (
  select
    pg_catalog.count(*) as config_count,
    pg_catalog.jsonb_object_agg(
      key_name,
      pg_catalog.jsonb_build_object(
        'version_id', id,
        'version_number', version_number,
        'source', 'database',
        'status', 'active'
      )
    ) as config_version_ids
  from required_biteship_config_versions
), active_settings as (
  select
    pg_catalog.nullif(pg_catalog.btrim(origin_area_id), '') as origin_area_id,
    pg_catalog.nullif(pg_catalog.btrim(origin_postal_code), '') as origin_postal_code,
    origin_latitude,
    origin_longitude,
    pg_catalog.nullif(pg_catalog.btrim(store_name), '') as shipper_name,
    pg_catalog.nullif(pg_catalog.btrim(phone_number), '') as shipper_phone,
    pg_catalog.nullif(pg_catalog.btrim(email), '') as shipper_email,
    pg_catalog.nullif(pg_catalog.btrim(store_address), '') as shipper_address,
    pg_catalog.nullif(pg_catalog.btrim(organization), '') as shipper_organization
  from public.settings
  where id = 1
), legacy_biteship_candidates as (
  select
    o.id as order_id,
    s.id as shipment_id,
    pg_catalog.lower(pg_catalog.btrim(s.courier_code)) as courier_code,
    pg_catalog.lower(pg_catalog.btrim(s.courier_service)) as courier_service,
    existing_snapshot.id as existing_snapshot_id,
    settings.origin_area_id,
    settings.origin_postal_code,
    settings.origin_latitude,
    settings.origin_longitude,
    settings.shipper_name,
    settings.shipper_phone,
    settings.shipper_email,
    settings.shipper_address,
    settings.shipper_organization,
    metadata.config_count,
    metadata.config_version_ids
  from public.orders as o
  join public.shipments as s
    on s.order_id = o.id
  cross join active_settings as settings
  cross join biteship_config_metadata as metadata
  left join private.order_integration_config_snapshots as existing_snapshot
    on existing_snapshot.order_id = o.id
  where s.provider = 'biteship'
    and s.biteship_order_id is null
    and s.courier_code is not null
    and s.courier_service is not null
    and o.status in ('processing', 'awaiting_shipment')
), inserted_biteship_snapshots as (
  insert into private.order_integration_config_snapshots (
    order_id,
    shipment_id,
    provider,
    origin_area_id,
    origin_postal_code,
    origin_latitude,
    origin_longitude,
    courier_codes,
    courier_service,
    shipper_name,
    shipper_phone,
    shipper_email,
    shipper_address,
    shipper_organization,
    config_version_ids,
    snapshot_source,
    created_by
  )
  select
    candidate.order_id,
    candidate.shipment_id,
    'biteship',
    candidate.origin_area_id,
    candidate.origin_postal_code::varchar(5),
    candidate.origin_latitude,
    candidate.origin_longitude,
    array[candidate.courier_code],
    candidate.courier_service,
    candidate.shipper_name,
    candidate.shipper_phone,
    candidate.shipper_email,
    candidate.shipper_address,
    candidate.shipper_organization,
    candidate.config_version_ids,
    'legacy_rollout_backfill',
    null
  from legacy_biteship_candidates as candidate
  where candidate.existing_snapshot_id is null
    and candidate.config_count = 10
    and candidate.origin_area_id is not null
    and candidate.origin_postal_code ~ '^[1-9][0-9]{4}$'
    and candidate.origin_latitude between -90 and 90
    and candidate.origin_longitude between -180 and 180
    and candidate.shipper_name is not null
    and candidate.shipper_phone is not null
    and candidate.shipper_email is not null
    and candidate.shipper_address is not null
    and candidate.shipper_organization is not null
  on conflict (order_id) do nothing
  returning order_id
)
insert into private.integration_config_rollout_status (
  provider,
  target_type,
  target_id,
  status,
  reason,
  safe_metadata
)
select
  'biteship',
  'order',
  candidate.order_id,
  case
    when candidate.existing_snapshot_id is not null then 'skipped'
    when inserted.order_id is not null then 'backfilled'
    else 'retryable'
  end,
  case
    when candidate.existing_snapshot_id is not null then 'already_snapshotted'
    when inserted.order_id is not null then 'legacy_biteship_snapshot_backfilled'
    else 'retryable_missing_biteship_snapshot_inputs'
  end,
  pg_catalog.jsonb_build_object(
    'shipment_id', candidate.shipment_id,
    'courier_code_present', candidate.courier_code is not null,
    'courier_service_present', candidate.courier_service is not null,
    'config_version_count', candidate.config_count
  )
from legacy_biteship_candidates as candidate
left join inserted_biteship_snapshots as inserted
  on inserted.order_id = candidate.order_id
on conflict (provider, target_type, target_id) do update
set
  status = excluded.status,
  reason = excluded.reason,
  safe_metadata = excluded.safe_metadata,
  updated_at = pg_catalog.timezone('utc'::text, pg_catalog.now());

comment on table private.integration_config_rollout_status is
  'Safe rollout/backfill status for database-backed integration config. Metadata is operational only and must never include provider plaintext secrets.';

comment on function private.set_integration_config_rollout_status_updated_at() is
  'Maintains updated_at for safe integration config rollout status rows.';

revoke all on table private.integration_config_rollout_status from public, anon, authenticated;
grant select, insert, update on table private.integration_config_rollout_status to service_role;

revoke all on function private.set_integration_config_rollout_status_updated_at() from public, anon, authenticated;

commit;
