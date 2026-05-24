begin;

create or replace function private.update_integration_config_value(
  p_key_name text,
  p_value jsonb,
  p_actor_id uuid default null,
  p_reason text default null,
  p_source text default 'service_rpc',
  p_request_id text default null
)
returns table (
  key_name text,
  version_id uuid,
  version_number integer,
  updated_value jsonb,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_key private.integration_config_keys%rowtype;
  v_next_version integer;
  v_version_id uuid;
  v_old_version_number integer;
  v_old_value jsonb;
  v_item jsonb;
  v_coordinate numeric;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service_role is required to update integration config values'
      using errcode = '42501';
  end if;

  if p_key_name is null or pg_catalog.btrim(p_key_name) = '' then
    raise exception 'Config key name is required'
      using errcode = '22023';
  end if;

  if p_value is null then
    raise exception 'Config value is required'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_key_name, 0));

  select *
    into v_key
  from private.integration_config_keys as k
  where k.key_name = p_key_name;

  if not found then
    raise exception 'Unknown integration config key: %', p_key_name
      using errcode = '22023';
  end if;

  if v_key.is_secret is true then
    raise exception 'Config key % requires secret rotation', p_key_name
      using errcode = '22023';
  end if;

  if v_key.value_kind = 'boolean' then
    if pg_catalog.jsonb_typeof(p_value) <> 'boolean' then
      raise exception 'Config key % requires a boolean value', p_key_name
        using errcode = '22023';
    end if;
  elsif v_key.value_kind = 'text' then
    if pg_catalog.jsonb_typeof(p_value) <> 'string' or pg_catalog.btrim(p_value #>> '{}') = '' then
      raise exception 'Config key % requires a non-empty text value', p_key_name
        using errcode = '22023';
    end if;
  elsif v_key.value_kind = 'text_array' then
    if pg_catalog.jsonb_typeof(p_value) <> 'array' then
      raise exception 'Config key % requires a text array value', p_key_name
        using errcode = '22023';
    end if;

    for v_item in select value from pg_catalog.jsonb_array_elements(p_value)
    loop
      if pg_catalog.jsonb_typeof(v_item) <> 'string' or pg_catalog.btrim(v_item #>> '{}') = '' then
        raise exception 'Config key % requires only non-empty text array items', p_key_name
          using errcode = '22023';
      end if;
    end loop;
  else
    raise exception 'Unsupported config value kind: %', v_key.value_kind
      using errcode = '22023';
  end if;

  if p_key_name = 'biteship.origin_postal_code' and not ((p_value #>> '{}') ~ '^[1-9][0-9]{4}$') then
    raise exception 'Biteship origin postal code must be a valid Indonesian postal code'
      using errcode = '22023';
  end if;

  if p_key_name = 'biteship.origin_latitude' then
    if not ((p_value #>> '{}') ~ '^-?([0-9]+)(\.[0-9]+)?$') then
      raise exception 'Biteship origin latitude must be a decimal between -90 and 90'
        using errcode = '22023';
    end if;

    v_coordinate := (p_value #>> '{}')::numeric;
    if v_coordinate < -90 or v_coordinate > 90 then
      raise exception 'Biteship origin latitude must be a decimal between -90 and 90'
        using errcode = '22023';
    end if;
  end if;

  if p_key_name = 'biteship.origin_longitude' then
    if not ((p_value #>> '{}') ~ '^-?([0-9]+)(\.[0-9]+)?$') then
      raise exception 'Biteship origin longitude must be a decimal between -180 and 180'
        using errcode = '22023';
    end if;

    v_coordinate := (p_value #>> '{}')::numeric;
    if v_coordinate < -180 or v_coordinate > 180 then
      raise exception 'Biteship origin longitude must be a decimal between -180 and 180'
        using errcode = '22023';
    end if;
  end if;

  if p_key_name = 'shop.shipper_email' and not ((p_value #>> '{}') ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'Shop shipper email must be a valid email address'
      using errcode = '22023';
  end if;

  select
    c.version_number,
    v.non_secret_value
  into
    v_old_version_number,
    v_old_value
  from private.integration_config_current_versions as c
  join private.integration_config_versions as v
    on v.id = c.version_id
  where c.key_name = p_key_name;

  select coalesce(pg_catalog.max(icv.version_number), 0) + 1
    into v_next_version
  from private.integration_config_versions as icv
  where icv.key_name = p_key_name;

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
  values (
    p_key_name,
    v_next_version,
    null,
    p_value,
    null,
    null,
    'superseded',
    p_actor_id,
    nullif(pg_catalog.btrim(coalesce(p_reason, '')), ''),
    coalesce(nullif(pg_catalog.btrim(p_source), ''), 'service_rpc'),
    nullif(pg_catalog.btrim(coalesce(p_request_id, '')), '')
  )
  returning id into v_version_id;

  update private.integration_config_versions as old_versions
  set
    status = 'retired',
    retired_at = pg_catalog.now()
  where old_versions.key_name = p_key_name
    and old_versions.status = 'active'
    and old_versions.id <> v_version_id;

  update private.integration_config_versions as new_version
  set status = 'active'
  where new_version.id = v_version_id;

  insert into private.integration_config_current_versions (
    key_name,
    version_id,
    version_number,
    activated_by,
    activated_at
  )
  values (
    p_key_name,
    v_version_id,
    v_next_version,
    p_actor_id,
    pg_catalog.now()
  )
  on conflict (key_name) do update
  set
    version_id = excluded.version_id,
    version_number = excluded.version_number,
    activated_by = excluded.activated_by,
    activated_at = excluded.activated_at;

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
    metadata
  )
  values (
    p_key_name,
    v_version_id,
    'value_updated',
    p_actor_id,
    (select auth.role()),
    coalesce(nullif(pg_catalog.btrim(p_source), ''), 'service_rpc'),
    nullif(pg_catalog.btrim(coalesce(p_request_id, '')), ''),
    nullif(pg_catalog.btrim(coalesce(p_reason, '')), ''),
    v_old_version_number,
    v_next_version,
    pg_catalog.jsonb_build_object('old_value', v_old_value, 'new_value', p_value)
  );

  return query
    select
      p_key_name,
      v_version_id,
      v_next_version,
      p_value,
      pg_catalog.now();
end;
$$;

revoke all on function private.update_integration_config_value(text, jsonb, uuid, text, text, text)
from public, anon, authenticated;
grant execute on function private.update_integration_config_value(text, jsonb, uuid, text, text, text)
to service_role;

commit;
