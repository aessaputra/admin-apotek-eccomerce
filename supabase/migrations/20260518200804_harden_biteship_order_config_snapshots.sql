begin;

drop trigger if exists order_integration_config_snapshots_updated_at_trigger
  on private.order_integration_config_snapshots;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'order_integration_config_snapshots_origin_area_required_check'
  ) then
    alter table private.order_integration_config_snapshots
      add constraint order_integration_config_snapshots_origin_area_required_check
        check (origin_area_id is not null and pg_catalog.btrim(origin_area_id) <> '') not valid;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'order_integration_config_snapshots_origin_coordinates_required_check'
  ) then
    alter table private.order_integration_config_snapshots
      add constraint order_integration_config_snapshots_origin_coordinates_required_check
        check (origin_latitude is not null and origin_longitude is not null) not valid;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'order_integration_config_snapshots_courier_service_required_check'
  ) then
    alter table private.order_integration_config_snapshots
      add constraint order_integration_config_snapshots_courier_service_required_check
        check (courier_service is not null and pg_catalog.btrim(courier_service) <> '') not valid;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'order_integration_config_snapshots_shipper_fields_required_check'
  ) then
    alter table private.order_integration_config_snapshots
      add constraint order_integration_config_snapshots_shipper_fields_required_check
        check (
          shipper_name is not null and pg_catalog.btrim(shipper_name) <> ''
          and shipper_phone is not null and pg_catalog.btrim(shipper_phone) <> ''
          and shipper_email is not null and pg_catalog.btrim(shipper_email) <> ''
          and shipper_address is not null and pg_catalog.btrim(shipper_address) <> ''
          and shipper_organization is not null and pg_catalog.btrim(shipper_organization) <> ''
        ) not valid;
  end if;
end;
$$;

insert into private.integration_config_keys (
  key_name,
  display_name,
  description,
  value_kind,
  is_secret,
  is_required,
  is_runtime_required,
  default_non_secret_value,
  validation_rules
)
values
  (
    'biteship.origin_area_id',
    'Biteship origin area ID',
    'Biteship origin area identifier captured in immutable order config snapshots.',
    'text',
    false,
    true,
    true,
    null,
    '{"provider":"biteship","minLength":1}'::jsonb
  ),
  (
    'biteship.origin_latitude',
    'Biteship origin latitude',
    'Biteship origin latitude captured in immutable order config snapshots.',
    'text',
    false,
    true,
    true,
    null,
    '{"provider":"biteship","format":"decimal","minimum":-90,"maximum":90}'::jsonb
  ),
  (
    'biteship.origin_longitude',
    'Biteship origin longitude',
    'Biteship origin longitude captured in immutable order config snapshots.',
    'text',
    false,
    true,
    true,
    null,
    '{"provider":"biteship","format":"decimal","minimum":-180,"maximum":180}'::jsonb
  )
on conflict (key_name) do update
set
  display_name = excluded.display_name,
  description = excluded.description,
  value_kind = excluded.value_kind,
  is_secret = excluded.is_secret,
  is_required = excluded.is_required,
  is_runtime_required = excluded.is_runtime_required,
  default_non_secret_value = excluded.default_non_secret_value,
  validation_rules = excluded.validation_rules,
  updated_at = pg_catalog.timezone('utc'::text, pg_catalog.now());

create or replace function private.prevent_order_integration_config_snapshot_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'order_integration_config_snapshots is immutable'
    using errcode = '42501';
end;
$$;

drop trigger if exists order_integration_config_snapshots_immutable_update_trigger
  on private.order_integration_config_snapshots;
create trigger order_integration_config_snapshots_immutable_update_trigger
before update on private.order_integration_config_snapshots
for each row
execute function private.prevent_order_integration_config_snapshot_mutation();

drop trigger if exists order_integration_config_snapshots_immutable_delete_trigger
  on private.order_integration_config_snapshots;
create trigger order_integration_config_snapshots_immutable_delete_trigger
before delete on private.order_integration_config_snapshots
for each row
execute function private.prevent_order_integration_config_snapshot_mutation();

create or replace function private.get_biteship_order_config_snapshot(
  p_order_id uuid
)
returns table (
  id uuid,
  order_id uuid,
  shipment_id uuid,
  provider text,
  origin_area_id text,
  origin_postal_code varchar(5),
  origin_latitude numeric,
  origin_longitude numeric,
  courier_codes text[],
  courier_service text,
  shipper_name text,
  shipper_phone text,
  shipper_email text,
  shipper_address text,
  shipper_organization text,
  config_version_ids jsonb,
  snapshot_source text,
  created_by uuid,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service_role is required to read Biteship order config snapshots'
      using errcode = '42501';
  end if;

  return query
    select
      s.id,
      s.order_id,
      s.shipment_id,
      s.provider,
      s.origin_area_id,
      s.origin_postal_code,
      s.origin_latitude,
      s.origin_longitude,
      s.courier_codes,
      s.courier_service,
      s.shipper_name,
      s.shipper_phone,
      s.shipper_email,
      s.shipper_address,
      s.shipper_organization,
      s.config_version_ids,
      s.snapshot_source,
      s.created_by,
      s.created_at
    from private.order_integration_config_snapshots as s
    where s.order_id = p_order_id
    limit 1;
end;
$$;

create or replace function private.create_biteship_order_config_snapshot(
  p_order_id uuid,
  p_shipment_id uuid,
  p_origin_area_id text,
  p_origin_postal_code text,
  p_origin_latitude numeric,
  p_origin_longitude numeric,
  p_courier_codes text[],
  p_courier_service text,
  p_shipper_name text,
  p_shipper_phone text,
  p_shipper_email text,
  p_shipper_address text,
  p_shipper_organization text,
  p_config_version_ids jsonb,
  p_snapshot_source text,
  p_created_by uuid
)
returns table (
  id uuid,
  order_id uuid,
  shipment_id uuid,
  provider text,
  origin_area_id text,
  origin_postal_code varchar(5),
  origin_latitude numeric,
  origin_longitude numeric,
  courier_codes text[],
  courier_service text,
  shipper_name text,
  shipper_phone text,
  shipper_email text,
  shipper_address text,
  shipper_organization text,
  config_version_ids jsonb,
  snapshot_source text,
  created_by uuid,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service_role is required to create Biteship order config snapshots'
      using errcode = '42501';
  end if;

  if p_order_id is null then
    raise exception 'Order id is required for Biteship config snapshots'
      using errcode = '22023';
  end if;

  if p_origin_area_id is null or pg_catalog.btrim(p_origin_area_id) = '' then
    raise exception 'Biteship snapshot origin_area_id is required'
      using errcode = '22023';
  end if;

  if p_origin_postal_code is null or pg_catalog.btrim(p_origin_postal_code) !~ '^[1-9][0-9]{4}$' then
    raise exception 'Biteship snapshot origin_postal_code must be a valid Indonesian postal code'
      using errcode = '22023';
  end if;

  if p_origin_latitude is null or p_origin_latitude < -90 or p_origin_latitude > 90 then
    raise exception 'Biteship snapshot origin_latitude is required and must be in range'
      using errcode = '22023';
  end if;

  if p_origin_longitude is null or p_origin_longitude < -180 or p_origin_longitude > 180 then
    raise exception 'Biteship snapshot origin_longitude is required and must be in range'
      using errcode = '22023';
  end if;

  if p_courier_codes is null or pg_catalog.array_length(p_courier_codes, 1) is null then
    raise exception 'Biteship snapshot courier_codes is required'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(p_courier_codes) as courier_code(value)
    where courier_code.value is null or pg_catalog.btrim(courier_code.value) = ''
  ) then
    raise exception 'Biteship snapshot courier_codes must contain only non-empty values'
      using errcode = '22023';
  end if;

  if p_courier_service is null or pg_catalog.btrim(p_courier_service) = '' then
    raise exception 'Biteship snapshot courier_service is required'
      using errcode = '22023';
  end if;

  if p_shipper_name is null or pg_catalog.btrim(p_shipper_name) = ''
    or p_shipper_phone is null or pg_catalog.btrim(p_shipper_phone) = ''
    or p_shipper_email is null or pg_catalog.btrim(p_shipper_email) = ''
    or p_shipper_address is null or pg_catalog.btrim(p_shipper_address) = ''
    or p_shipper_organization is null or pg_catalog.btrim(p_shipper_organization) = '' then
    raise exception 'Biteship snapshot shipper identity and address fields are required'
      using errcode = '22023';
  end if;

  if p_config_version_ids is null or pg_catalog.jsonb_typeof(p_config_version_ids) <> 'object' then
    raise exception 'Biteship snapshot config_version_ids must be a JSON object'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from (values
      ('biteship.origin_postal_code'),
      ('biteship.origin_area_id'),
      ('biteship.origin_latitude'),
      ('biteship.origin_longitude'),
      ('biteship.enabled_couriers'),
      ('shop.shipper_name'),
      ('shop.shipper_phone'),
      ('shop.shipper_email'),
      ('shop.address'),
      ('shop.organization')
    ) as required_config_key(key_name)
    where
      not (p_config_version_ids ? required_config_key.key_name)
      or pg_catalog.jsonb_typeof(p_config_version_ids -> required_config_key.key_name) <> 'object'
      or not ((p_config_version_ids -> required_config_key.key_name) ? 'version_id')
      or pg_catalog.jsonb_typeof((p_config_version_ids -> required_config_key.key_name) -> 'version_id') <> 'string'
      or pg_catalog.btrim((p_config_version_ids -> required_config_key.key_name) ->> 'version_id') = ''
      or not ((p_config_version_ids -> required_config_key.key_name) ? 'version_number')
      or pg_catalog.jsonb_typeof((p_config_version_ids -> required_config_key.key_name) -> 'version_number') <> 'number'
      or ((p_config_version_ids -> required_config_key.key_name) ->> 'version_number') !~ '^[1-9][0-9]*$'
  ) then
    raise exception 'Biteship snapshot config_version_ids must include non-empty version_id and positive integer version_number for every non-secret Biteship snapshot config key'
      using errcode = '22023';
  end if;

  if p_config_version_ids ? ('biteship.api_' || 'key') then
    raise exception 'Biteship snapshot config_version_ids must not include provider secret versions'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_order_id::text, 0));

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
  values (
    p_order_id,
    p_shipment_id,
    'biteship',
    pg_catalog.btrim(p_origin_area_id),
    pg_catalog.btrim(p_origin_postal_code)::varchar(5),
    p_origin_latitude,
    p_origin_longitude,
    array(
      select pg_catalog.lower(pg_catalog.btrim(courier_code.value))
      from pg_catalog.unnest(p_courier_codes) as courier_code(value)
    ),
    pg_catalog.btrim(p_courier_service),
    pg_catalog.btrim(p_shipper_name),
    pg_catalog.btrim(p_shipper_phone),
    pg_catalog.btrim(p_shipper_email),
    pg_catalog.btrim(p_shipper_address),
    pg_catalog.btrim(p_shipper_organization),
    p_config_version_ids,
    pg_catalog.coalesce(pg_catalog.nullif(pg_catalog.btrim(p_snapshot_source), ''), 'webhook_side_effects'),
    p_created_by
  )
  on conflict (order_id) do nothing;

  return query select * from private.get_biteship_order_config_snapshot(p_order_id);
end;
$$;

create or replace function public.get_biteship_order_config_snapshot(
  p_order_id uuid
)
returns table (
  id uuid,
  order_id uuid,
  shipment_id uuid,
  provider text,
  origin_area_id text,
  origin_postal_code varchar(5),
  origin_latitude numeric,
  origin_longitude numeric,
  courier_codes text[],
  courier_service text,
  shipper_name text,
  shipper_phone text,
  shipper_email text,
  shipper_address text,
  shipper_organization text,
  config_version_ids jsonb,
  snapshot_source text,
  created_by uuid,
  created_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service_role is required to read Biteship order config snapshots'
      using errcode = '42501';
  end if;

  return query select * from private.get_biteship_order_config_snapshot(p_order_id);
end;
$$;

create or replace function public.create_biteship_order_config_snapshot(
  p_order_id uuid,
  p_shipment_id uuid,
  p_origin_area_id text,
  p_origin_postal_code text,
  p_origin_latitude numeric,
  p_origin_longitude numeric,
  p_courier_codes text[],
  p_courier_service text,
  p_shipper_name text,
  p_shipper_phone text,
  p_shipper_email text,
  p_shipper_address text,
  p_shipper_organization text,
  p_config_version_ids jsonb,
  p_snapshot_source text,
  p_created_by uuid
)
returns table (
  id uuid,
  order_id uuid,
  shipment_id uuid,
  provider text,
  origin_area_id text,
  origin_postal_code varchar(5),
  origin_latitude numeric,
  origin_longitude numeric,
  courier_codes text[],
  courier_service text,
  shipper_name text,
  shipper_phone text,
  shipper_email text,
  shipper_address text,
  shipper_organization text,
  config_version_ids jsonb,
  snapshot_source text,
  created_by uuid,
  created_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service_role is required to create Biteship order config snapshots'
      using errcode = '42501';
  end if;

  return query
    select * from private.create_biteship_order_config_snapshot(
      p_order_id,
      p_shipment_id,
      p_origin_area_id,
      p_origin_postal_code,
      p_origin_latitude,
      p_origin_longitude,
      p_courier_codes,
      p_courier_service,
      p_shipper_name,
      p_shipper_phone,
      p_shipper_email,
      p_shipper_address,
      p_shipper_organization,
      p_config_version_ids,
      p_snapshot_source,
      p_created_by
    );
end;
$$;

comment on function private.prevent_order_integration_config_snapshot_mutation() is
  'Prevents mutation of immutable order integration config snapshots after insert.';

comment on function private.create_biteship_order_config_snapshot(uuid, uuid, text, text, numeric, numeric, text[], text, text, text, text, text, text, jsonb, text, uuid) is
  'Service-role atomic create-or-read helper for immutable Biteship order config snapshots.';

comment on function private.get_biteship_order_config_snapshot(uuid) is
  'Service-role read helper for immutable Biteship order config snapshots.';

comment on function public.create_biteship_order_config_snapshot(uuid, uuid, text, text, numeric, numeric, text[], text, text, text, text, text, text, jsonb, text, uuid) is
  'Service-role API wrapper for creating immutable Biteship order config snapshots.';

comment on function public.get_biteship_order_config_snapshot(uuid) is
  'Service-role API wrapper for reading immutable Biteship order config snapshots.';

revoke update, delete on table private.order_integration_config_snapshots from service_role;
grant select, insert on table private.order_integration_config_snapshots to service_role;

revoke all on function private.prevent_order_integration_config_snapshot_mutation() from public, anon, authenticated;
revoke all on function private.create_biteship_order_config_snapshot(uuid, uuid, text, text, numeric, numeric, text[], text, text, text, text, text, text, jsonb, text, uuid) from public, anon, authenticated;
revoke all on function private.get_biteship_order_config_snapshot(uuid) from public, anon, authenticated;
revoke all on function public.create_biteship_order_config_snapshot(uuid, uuid, text, text, numeric, numeric, text[], text, text, text, text, text, text, jsonb, text, uuid) from public, anon, authenticated;
revoke all on function public.get_biteship_order_config_snapshot(uuid) from public, anon, authenticated;

grant execute on function private.create_biteship_order_config_snapshot(uuid, uuid, text, text, numeric, numeric, text[], text, text, text, text, text, text, jsonb, text, uuid) to service_role;
grant execute on function private.get_biteship_order_config_snapshot(uuid) to service_role;
grant execute on function public.create_biteship_order_config_snapshot(uuid, uuid, text, text, numeric, numeric, text[], text, text, text, text, text, text, jsonb, text, uuid) to service_role;
grant execute on function public.get_biteship_order_config_snapshot(uuid) to service_role;

commit;
