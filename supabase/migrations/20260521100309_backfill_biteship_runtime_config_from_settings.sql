begin;

with settings_source as (
  select
    nullif(btrim(enabled_couriers), '') as enabled_couriers_raw,
    nullif(btrim(origin_postal_code), '') as origin_postal_code,
    nullif(btrim(origin_area_id), '') as origin_area_id,
    origin_latitude,
    origin_longitude,
    nullif(btrim(store_name), '') as shipper_name,
    nullif(btrim(phone_number), '') as shipper_phone,
    nullif(btrim(email), '') as shipper_email,
    nullif(btrim(store_address), '') as shop_address,
    nullif(btrim(organization), '') as shop_organization
  from public.settings
  where id = 1
), enabled_courier_values as (
  select coalesce(
    jsonb_agg(to_jsonb(courier_code) order by courier_code),
    jsonb_build_array()
  ) as enabled_couriers
  from (
    select distinct lower(btrim(courier_item)) as courier_code
    from settings_source
    cross join lateral regexp_split_to_table(enabled_couriers_raw, ',') as courier_item
    where nullif(btrim(courier_item), '') is not null
  ) as normalized_couriers
), valid_settings as (
  select
    settings_source.origin_postal_code,
    settings_source.origin_area_id,
    settings_source.origin_latitude,
    settings_source.origin_longitude,
    settings_source.shipper_name,
    settings_source.shipper_phone,
    settings_source.shipper_email,
    settings_source.shop_address,
    settings_source.shop_organization,
    enabled_courier_values.enabled_couriers
  from settings_source
  cross join enabled_courier_values
  where settings_source.origin_postal_code ~ '^[1-9][0-9]{4}$'
    and settings_source.origin_area_id is not null
    and settings_source.origin_latitude between -90 and 90
    and settings_source.origin_longitude between -180 and 180
    and settings_source.shipper_name is not null
    and settings_source.shipper_phone is not null
    and settings_source.shipper_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    and settings_source.shop_address is not null
    and settings_source.shop_organization is not null
    and jsonb_array_length(enabled_courier_values.enabled_couriers) > 0
), required_backfill_values as (
  select *
  from valid_settings
  cross join lateral (
    values
      ('biteship.enabled_couriers', valid_settings.enabled_couriers),
      ('biteship.origin_postal_code', to_jsonb(valid_settings.origin_postal_code)),
      ('biteship.origin_area_id', to_jsonb(valid_settings.origin_area_id)),
      ('biteship.origin_latitude', to_jsonb(valid_settings.origin_latitude::text)),
      ('biteship.origin_longitude', to_jsonb(valid_settings.origin_longitude::text)),
      ('shop.shipper_name', to_jsonb(valid_settings.shipper_name)),
      ('shop.shipper_phone', to_jsonb(valid_settings.shipper_phone)),
      ('shop.shipper_email', to_jsonb(valid_settings.shipper_email)),
      ('shop.address', to_jsonb(valid_settings.shop_address)),
      ('shop.organization', to_jsonb(valid_settings.shop_organization))
  ) as backfill_value(key_name, non_secret_value)
), backfill_candidates as (
  select
    required_backfill_values.key_name,
    required_backfill_values.non_secret_value,
    coalesce(max(existing_versions.version_number), 0) + 1 as next_version_number
  from required_backfill_values
  join private.integration_config_keys as config_keys
    on config_keys.key_name = required_backfill_values.key_name
   and config_keys.is_secret is false
  left join private.integration_config_current_versions as current_versions
    on current_versions.key_name = required_backfill_values.key_name
  left join private.integration_config_versions as existing_versions
    on existing_versions.key_name = required_backfill_values.key_name
  where current_versions.key_name is null
  group by
    required_backfill_values.key_name,
    required_backfill_values.non_secret_value
), inserted_versions as (
  insert into private.integration_config_versions (
    key_name,
    version_number,
    vault_secret_id,
    non_secret_value,
    masked_value,
    value_fingerprint,
    status,
    created_by,
    created_reason,
    created_source,
    request_id
  )
  select
    backfill_candidates.key_name,
    backfill_candidates.next_version_number,
    null,
    backfill_candidates.non_secret_value,
    null,
    null,
    'active',
    null,
    'Backfilled from public.settings id 1 for Biteship runtime recovery',
    'settings_backfill',
    null
  from backfill_candidates
  on conflict (key_name, version_number) do nothing
  returning id, key_name, version_number, non_secret_value
), inserted_current_versions as (
  insert into private.integration_config_current_versions (
    key_name,
    version_id,
    version_number,
    activated_by,
    activated_at
  )
  select
    inserted_versions.key_name,
    inserted_versions.id,
    inserted_versions.version_number,
    null,
    timezone('utc'::text, now())
  from inserted_versions
  on conflict (key_name) do nothing
  returning key_name, version_id, version_number
)
insert into private.integration_config_audit_logs (
  key_name,
  version_id,
  action,
  actor_id,
  actor_role,
  source,
  request_id,
  reason,
  old_version_number,
  new_version_number,
  old_masked_value,
  new_masked_value,
  value_fingerprint,
  metadata
)
select
  inserted_current_versions.key_name,
  inserted_current_versions.version_id,
  'value_updated',
  null,
  'migration',
  'settings_backfill',
  null,
  'Backfilled non-secret Biteship runtime config from public.settings id 1',
  null,
  inserted_current_versions.version_number,
  null,
  null,
  null,
  jsonb_build_object(
    'source_table', 'public.settings',
    'source_id', 1,
    'contains_secret', false
  )
from inserted_current_versions;

commit;
