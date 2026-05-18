begin;

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create table if not exists private.integration_config_keys (
  key_name text primary key,
  display_name text not null,
  description text not null default '',
  value_kind text not null,
  is_secret boolean not null,
  is_required boolean not null default true,
  is_runtime_required boolean not null default true,
  default_non_secret_value jsonb,
  validation_rules jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default pg_catalog.timezone('utc'::text, pg_catalog.now()),
  updated_at timestamptz not null default pg_catalog.timezone('utc'::text, pg_catalog.now()),
  constraint integration_config_keys_value_kind_check
    check (value_kind = any (array['secret'::text, 'boolean'::text, 'text'::text, 'text_array'::text])),
  constraint integration_config_keys_secret_kind_check
    check (
      (is_secret = true and value_kind = 'secret' and default_non_secret_value is null)
      or (is_secret = false and value_kind <> 'secret')
    )
);

create table if not exists private.integration_config_versions (
  id uuid primary key default gen_random_uuid(),
  key_name text not null references private.integration_config_keys(key_name) on delete restrict,
  version_number integer not null,
  vault_secret_id uuid references vault.secrets(id) on delete restrict,
  non_secret_value jsonb,
  masked_value text,
  value_fingerprint text,
  status text not null default 'active',
  created_by uuid references auth.users(id) on delete set null,
  created_reason text,
  created_source text not null default 'service_rpc',
  request_id text,
  created_at timestamptz not null default pg_catalog.timezone('utc'::text, pg_catalog.now()),
  retired_at timestamptz,
  constraint integration_config_versions_version_positive_check
    check (version_number > 0),
  constraint integration_config_versions_status_check
    check (status = any (array['active'::text, 'retired'::text])),
  constraint integration_config_versions_value_storage_check
    check (
      (vault_secret_id is not null and non_secret_value is null)
      or (vault_secret_id is null and non_secret_value is not null)
    ),
  constraint integration_config_versions_key_version_uidx
    unique (key_name, version_number)
);

create table if not exists private.integration_config_current_versions (
  key_name text primary key references private.integration_config_keys(key_name) on delete cascade,
  version_id uuid not null unique references private.integration_config_versions(id) on delete restrict,
  version_number integer not null,
  activated_by uuid references auth.users(id) on delete set null,
  activated_at timestamptz not null default pg_catalog.timezone('utc'::text, pg_catalog.now()),
  constraint integration_config_current_versions_version_matches_key
    foreign key (key_name, version_number)
    references private.integration_config_versions(key_name, version_number)
    on delete restrict
);

create table if not exists private.integration_config_audit_logs (
  id uuid primary key default gen_random_uuid(),
  key_name text not null references private.integration_config_keys(key_name) on delete restrict,
  version_id uuid references private.integration_config_versions(id) on delete set null,
  action text not null,
  actor_id uuid references auth.users(id) on delete set null,
  actor_role text,
  source text not null default 'service_rpc',
  request_id text,
  reason text,
  old_version_number integer,
  new_version_number integer,
  old_masked_value text,
  new_masked_value text,
  value_fingerprint text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default pg_catalog.timezone('utc'::text, pg_catalog.now()),
  constraint integration_config_audit_logs_action_check
    check (action = any (array['secret_rotated'::text, 'value_updated'::text, 'current_activated'::text, 'runtime_read'::text]))
);

create table if not exists private.order_integration_config_snapshots (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  shipment_id uuid references public.shipments(id) on delete set null,
  provider text not null default 'biteship',
  origin_area_id text,
  origin_postal_code varchar(5) not null,
  origin_latitude numeric(10, 8),
  origin_longitude numeric(11, 8),
  courier_codes text[] not null,
  courier_service text,
  shipper_name text not null,
  shipper_phone text not null,
  shipper_email text not null,
  shipper_address text not null,
  shipper_organization text not null,
  config_version_ids jsonb not null default '{}'::jsonb,
  snapshot_source text not null default 'service_rpc',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default pg_catalog.timezone('utc'::text, pg_catalog.now()),
  updated_at timestamptz not null default pg_catalog.timezone('utc'::text, pg_catalog.now()),
  constraint order_integration_config_snapshots_provider_check
    check (provider = 'biteship'),
  constraint order_integration_config_snapshots_origin_postal_code_check
    check (origin_postal_code ~ '^[1-9][0-9]{4}$'),
  constraint order_integration_config_snapshots_coordinates_pair_check
    check (
      (origin_latitude is null and origin_longitude is null)
      or (origin_latitude is not null and origin_longitude is not null)
    ),
  constraint order_integration_config_snapshots_origin_latitude_range_check
    check (origin_latitude is null or origin_latitude between -90 and 90),
  constraint order_integration_config_snapshots_origin_longitude_range_check
    check (origin_longitude is null or origin_longitude between -180 and 180),
  constraint order_integration_config_snapshots_courier_codes_not_empty_check
    check (pg_catalog.array_length(courier_codes, 1) > 0),
  constraint order_integration_config_snapshots_config_versions_object_check
    check (pg_catalog.jsonb_typeof(config_version_ids) = 'object')
);

create unique index if not exists order_integration_config_snapshots_order_uidx
  on private.order_integration_config_snapshots (order_id);

create index if not exists order_integration_config_snapshots_shipment_idx
  on private.order_integration_config_snapshots (shipment_id);

create index if not exists order_integration_config_snapshots_created_idx
  on private.order_integration_config_snapshots (created_at desc);

create index if not exists integration_config_versions_key_created_idx
  on private.integration_config_versions (key_name, created_at desc);

create index if not exists integration_config_versions_vault_secret_idx
  on private.integration_config_versions (vault_secret_id)
  where vault_secret_id is not null;

create index if not exists integration_config_audit_logs_key_created_idx
  on private.integration_config_audit_logs (key_name, created_at desc);

create index if not exists integration_config_audit_logs_actor_created_idx
  on private.integration_config_audit_logs (actor_id, created_at desc);

create index if not exists integration_config_audit_logs_request_idx
  on private.integration_config_audit_logs (request_id)
  where request_id is not null;

alter table private.integration_config_keys enable row level security;
alter table private.integration_config_versions enable row level security;
alter table private.integration_config_current_versions enable row level security;
alter table private.integration_config_audit_logs enable row level security;
alter table private.order_integration_config_snapshots enable row level security;

alter table private.integration_config_keys force row level security;
alter table private.integration_config_versions force row level security;
alter table private.integration_config_current_versions force row level security;
alter table private.integration_config_audit_logs force row level security;
alter table private.order_integration_config_snapshots force row level security;

create or replace function private.set_integration_config_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.timezone('utc'::text, pg_catalog.now());
  return new;
end;
$$;

drop trigger if exists integration_config_keys_updated_at_trigger on private.integration_config_keys;
create trigger integration_config_keys_updated_at_trigger
before update on private.integration_config_keys
for each row
execute function private.set_integration_config_updated_at();

drop trigger if exists order_integration_config_snapshots_updated_at_trigger on private.order_integration_config_snapshots;
create trigger order_integration_config_snapshots_updated_at_trigger
before update on private.order_integration_config_snapshots
for each row
execute function private.set_integration_config_updated_at();

create or replace function private.prevent_integration_config_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'integration_config_audit_logs is append-only'
    using errcode = '42501';
end;
$$;

drop trigger if exists integration_config_audit_logs_append_only_update_trigger on private.integration_config_audit_logs;
create trigger integration_config_audit_logs_append_only_update_trigger
before update on private.integration_config_audit_logs
for each row
execute function private.prevent_integration_config_audit_mutation();

drop trigger if exists integration_config_audit_logs_append_only_delete_trigger on private.integration_config_audit_logs;
create trigger integration_config_audit_logs_append_only_delete_trigger
before delete on private.integration_config_audit_logs
for each row
execute function private.prevent_integration_config_audit_mutation();

create or replace function private.mask_integration_config_secret(p_secret_value text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_length integer := pg_catalog.length(pg_catalog.coalesce(p_secret_value, ''));
begin
  if p_secret_value is null or v_length = 0 then
    return null;
  end if;

  if v_length <= 8 then
    return pg_catalog.repeat('*', v_length);
  end if;

  return pg_catalog.concat(
    pg_catalog.left(p_secret_value, 4),
    pg_catalog.repeat('*', pg_catalog.greatest(v_length - 8, 4)),
    pg_catalog.right(p_secret_value, 4)
  );
end;
$$;

create or replace function private.fingerprint_integration_config_secret(p_secret_value text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_secret_value is null then
    return null;
  end if;

  return pg_catalog.encode(extensions.digest(p_secret_value, 'sha256'), 'hex');
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
  ('midtrans.server_key', 'Midtrans server key', 'Vault-backed Midtrans server credential used by payment functions.', 'secret', true, true, true, null, '{"provider":"midtrans"}'::jsonb),
  ('biteship.api_key', 'Biteship API key', 'Vault-backed Biteship credential used by shipping functions.', 'secret', true, true, true, null, '{"provider":"biteship"}'::jsonb),
  ('push.expo_access_token', 'Expo access token', 'Optional Vault-backed Expo push access token.', 'secret', true, false, false, null, '{"provider":"expo"}'::jsonb),
  ('midtrans.is_production', 'Midtrans production mode', 'Controls whether Midtrans requests use production endpoints.', 'boolean', false, true, true, 'false'::jsonb, '{"provider":"midtrans"}'::jsonb),
  ('biteship.origin_postal_code', 'Biteship origin postal code', 'Five-digit Indonesian origin postal code for Biteship requests.', 'text', false, true, true, null, '{"pattern":"^[1-9][0-9]{4}$"}'::jsonb),
  ('biteship.enabled_couriers', 'Enabled Biteship couriers', 'Courier codes enabled for Biteship rates and checkout.', 'text_array', false, true, true, null, '{"minItems":1}'::jsonb),
  ('shop.shipper_name', 'Shipper name', 'Name sent to shipping providers as package sender.', 'text', false, true, true, null, '{}'::jsonb),
  ('shop.shipper_phone', 'Shipper phone', 'Phone number sent to shipping providers as package sender.', 'text', false, true, true, null, '{}'::jsonb),
  ('shop.shipper_email', 'Shipper email', 'Email sent to shipping providers as package sender.', 'text', false, true, true, null, '{}'::jsonb),
  ('shop.address', 'Shop address', 'Store or warehouse address used for shipping origin metadata.', 'text', false, true, true, null, '{}'::jsonb),
  ('shop.organization', 'Shop organization', 'Organization name used for shipping sender metadata.', 'text', false, true, true, null, '{}'::jsonb),
  ('cors.allowed_origins', 'Allowed CORS origins', 'Optional allowed origins for integration config gateway responses.', 'text_array', false, false, false, '[]'::jsonb, '{"optional":true}'::jsonb)
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

create or replace function private.get_runtime_integration_config(
  p_key_names text[] default null
)
returns table (
  key_name text,
  value_kind text,
  is_secret boolean,
  is_required boolean,
  is_runtime_required boolean,
  version_id uuid,
  version_number integer,
  runtime_value jsonb,
  masked_value text,
  value_fingerprint text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service_role is required for runtime integration config access'
      using errcode = '42501';
  end if;

  return query
    select
      k.key_name,
      k.value_kind,
      k.is_secret,
      k.is_required,
      k.is_runtime_required,
      v.id,
      v.version_number,
      case
        when k.is_secret then pg_catalog.to_jsonb(ds.decrypted_secret)
        else v.non_secret_value
      end as runtime_value,
      v.masked_value,
      v.value_fingerprint,
      v.created_at as updated_at
    from private.integration_config_keys as k
    join private.integration_config_current_versions as c
      on c.key_name = k.key_name
    join private.integration_config_versions as v
      on v.id = c.version_id
    left join vault.decrypted_secrets as ds
      on ds.id = v.vault_secret_id
    where (p_key_names is null or k.key_name = any (p_key_names))
      and v.status = 'active'
    order by k.key_name;
end;
$$;

create or replace function private.rotate_integration_config_secret(
  p_key_name text,
  p_secret_value text,
  p_actor_id uuid default null,
  p_reason text default null,
  p_source text default 'service_rpc',
  p_request_id text default null
)
returns table (
  key_name text,
  version_id uuid,
  version_number integer,
  masked_value text,
  value_fingerprint text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key private.integration_config_keys%rowtype;
  v_next_version integer;
  v_version_id uuid;
  v_vault_secret_id uuid;
  v_vault_name text;
  v_masked_value text;
  v_value_fingerprint text;
  v_old_version_number integer;
  v_old_masked_value text;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service_role is required to rotate integration config secrets'
      using errcode = '42501';
  end if;

  if p_key_name is null or pg_catalog.btrim(p_key_name) = '' then
    raise exception 'Config key name is required'
      using errcode = '22023';
  end if;

  if p_secret_value is null or pg_catalog.btrim(p_secret_value) = '' then
    raise exception 'Secret value is required'
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

  if v_key.is_secret is not true then
    raise exception 'Config key % is not a secret key', p_key_name
      using errcode = '22023';
  end if;

  select
    c.version_number,
    v.masked_value
  into
    v_old_version_number,
    v_old_masked_value
  from private.integration_config_current_versions as c
  join private.integration_config_versions as v
    on v.id = c.version_id
  where c.key_name = p_key_name;

  select pg_catalog.coalesce(pg_catalog.max(icv.version_number), 0) + 1
    into v_next_version
  from private.integration_config_versions as icv
  where icv.key_name = p_key_name;

  v_vault_name := pg_catalog.format('integration_config.%s.v%s', p_key_name, v_next_version);

  select vault.create_secret(
    p_secret_value,
    v_vault_name,
    pg_catalog.format('Integration config %s version %s', p_key_name, v_next_version)
  ) into v_vault_secret_id;

  v_masked_value := private.mask_integration_config_secret(p_secret_value);
  v_value_fingerprint := private.fingerprint_integration_config_secret(p_secret_value);

  insert into private.integration_config_versions (
    key_name,
    version_number,
    vault_secret_id,
    non_secret_value,
    masked_value,
    value_fingerprint,
    created_by,
    created_reason,
    created_source,
    request_id
  )
  values (
    p_key_name,
    v_next_version,
    v_vault_secret_id,
    null,
    v_masked_value,
    v_value_fingerprint,
    p_actor_id,
    pg_catalog.nullif(pg_catalog.btrim(pg_catalog.coalesce(p_reason, '')), ''),
    pg_catalog.coalesce(pg_catalog.nullif(pg_catalog.btrim(p_source), ''), 'service_rpc'),
    pg_catalog.nullif(pg_catalog.btrim(pg_catalog.coalesce(p_request_id, '')), '')
  )
  returning id into v_version_id;

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
    pg_catalog.timezone('utc'::text, pg_catalog.now())
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
    old_masked_value,
    new_masked_value,
    value_fingerprint,
    metadata
  )
  values (
    p_key_name,
    v_version_id,
    'secret_rotated',
    p_actor_id,
    (select auth.role()),
    pg_catalog.coalesce(pg_catalog.nullif(pg_catalog.btrim(p_source), ''), 'service_rpc'),
    pg_catalog.nullif(pg_catalog.btrim(pg_catalog.coalesce(p_request_id, '')), ''),
    pg_catalog.nullif(pg_catalog.btrim(pg_catalog.coalesce(p_reason, '')), ''),
    v_old_version_number,
    v_next_version,
    v_old_masked_value,
    v_masked_value,
    v_value_fingerprint,
    pg_catalog.jsonb_build_object('vault_secret_id', v_vault_secret_id, 'vault_secret_name', v_vault_name)
  );

  return query
    select
      p_key_name,
      v_version_id,
      v_next_version,
      v_masked_value,
      v_value_fingerprint,
      pg_catalog.timezone('utc'::text, pg_catalog.now());
end;
$$;

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
declare
  v_key private.integration_config_keys%rowtype;
  v_next_version integer;
  v_version_id uuid;
  v_old_version_number integer;
  v_old_value jsonb;
  v_item jsonb;
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

  if v_key.value_kind = 'boolean' and pg_catalog.jsonb_typeof(p_value) <> 'boolean' then
    raise exception 'Config key % requires a boolean value', p_key_name
      using errcode = '22023';
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

  select pg_catalog.coalesce(pg_catalog.max(icv.version_number), 0) + 1
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
    p_actor_id,
    pg_catalog.nullif(pg_catalog.btrim(pg_catalog.coalesce(p_reason, '')), ''),
    pg_catalog.coalesce(pg_catalog.nullif(pg_catalog.btrim(p_source), ''), 'service_rpc'),
    pg_catalog.nullif(pg_catalog.btrim(pg_catalog.coalesce(p_request_id, '')), '')
  )
  returning id into v_version_id;

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
    pg_catalog.timezone('utc'::text, pg_catalog.now())
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
    pg_catalog.coalesce(pg_catalog.nullif(pg_catalog.btrim(p_source), ''), 'service_rpc'),
    pg_catalog.nullif(pg_catalog.btrim(pg_catalog.coalesce(p_request_id, '')), ''),
    pg_catalog.nullif(pg_catalog.btrim(pg_catalog.coalesce(p_reason, '')), ''),
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
      pg_catalog.timezone('utc'::text, pg_catalog.now());
end;
$$;

create or replace function private.list_integration_config_summary(
  p_key_names text[] default null
)
returns table (
  key_name text,
  display_name text,
  description text,
  value_kind text,
  is_secret boolean,
  is_required boolean,
  is_runtime_required boolean,
  version_id uuid,
  version_number integer,
  status text,
  masked_value text,
  value_fingerprint text,
  non_secret_value jsonb,
  updated_by uuid,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service_role is required to list integration config summary'
      using errcode = '42501';
  end if;

  return query
    select
      k.key_name,
      k.display_name,
      k.description,
      k.value_kind,
      k.is_secret,
      k.is_required,
      k.is_runtime_required,
      v.id,
      v.version_number,
      v.status,
      v.masked_value,
      v.value_fingerprint,
      case when k.is_secret then null else v.non_secret_value end as non_secret_value,
      v.created_by,
      v.created_at
    from private.integration_config_keys as k
    left join private.integration_config_current_versions as c
      on c.key_name = k.key_name
    left join private.integration_config_versions as v
      on v.id = c.version_id
    where p_key_names is null or k.key_name = any (p_key_names)
    order by k.key_name;
end;
$$;

create or replace function private.list_integration_config_audit(
  p_key_name text default null,
  p_limit integer default 100
)
returns table (
  id uuid,
  key_name text,
  version_id uuid,
  action text,
  actor_id uuid,
  actor_role text,
  source text,
  request_id text,
  reason text,
  old_version_number integer,
  new_version_number integer,
  old_masked_value text,
  new_masked_value text,
  value_fingerprint text,
  metadata jsonb,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := pg_catalog.greatest(1, pg_catalog.least(pg_catalog.coalesce(p_limit, 100), 500));
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service_role is required to list integration config audit logs'
      using errcode = '42501';
  end if;

  return query
    select
      a.id,
      a.key_name,
      a.version_id,
      a.action,
      a.actor_id,
      a.actor_role,
      a.source,
      a.request_id,
      a.reason,
      a.old_version_number,
      a.new_version_number,
      a.old_masked_value,
      a.new_masked_value,
      a.value_fingerprint,
      a.metadata,
      a.created_at
    from private.integration_config_audit_logs as a
    where p_key_name is null or a.key_name = p_key_name
    order by a.created_at desc
    limit v_limit;
end;
$$;

create or replace function public.get_runtime_integration_config(
  p_key_names text[] default null
)
returns table (
  key_name text,
  value_kind text,
  is_secret boolean,
  is_required boolean,
  is_runtime_required boolean,
  version_id uuid,
  version_number integer,
  runtime_value jsonb,
  masked_value text,
  value_fingerprint text,
  updated_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service_role is required for runtime integration config access'
      using errcode = '42501';
  end if;

  return query
    select * from private.get_runtime_integration_config(p_key_names);
end;
$$;

create or replace function public.rotate_integration_config_secret(
  p_key_name text,
  p_secret_value text,
  p_actor_id uuid default null,
  p_reason text default null,
  p_source text default 'service_rpc',
  p_request_id text default null
)
returns table (
  key_name text,
  version_id uuid,
  version_number integer,
  masked_value text,
  value_fingerprint text,
  updated_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service_role is required to rotate integration config secrets'
      using errcode = '42501';
  end if;

  return query
    select *
    from private.rotate_integration_config_secret(
      p_key_name,
      p_secret_value,
      p_actor_id,
      p_reason,
      p_source,
      p_request_id
    );
end;
$$;

create or replace function public.update_integration_config_value(
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
security invoker
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service_role is required to update integration config values'
      using errcode = '42501';
  end if;

  return query
    select *
    from private.update_integration_config_value(
      p_key_name,
      p_value,
      p_actor_id,
      p_reason,
      p_source,
      p_request_id
    );
end;
$$;

create or replace function public.list_integration_config_summary(
  p_key_names text[] default null
)
returns table (
  key_name text,
  display_name text,
  description text,
  value_kind text,
  is_secret boolean,
  is_required boolean,
  is_runtime_required boolean,
  version_id uuid,
  version_number integer,
  status text,
  masked_value text,
  value_fingerprint text,
  non_secret_value jsonb,
  updated_by uuid,
  updated_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service_role is required to list integration config summary'
      using errcode = '42501';
  end if;

  return query
    select * from private.list_integration_config_summary(p_key_names);
end;
$$;

create or replace function public.list_integration_config_audit(
  p_key_name text default null,
  p_limit integer default 100
)
returns table (
  id uuid,
  key_name text,
  version_id uuid,
  action text,
  actor_id uuid,
  actor_role text,
  source text,
  request_id text,
  reason text,
  old_version_number integer,
  new_version_number integer,
  old_masked_value text,
  new_masked_value text,
  value_fingerprint text,
  metadata jsonb,
  created_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service_role is required to list integration config audit logs'
      using errcode = '42501';
  end if;

  return query
    select * from private.list_integration_config_audit(p_key_name, p_limit);
end;
$$;

comment on table private.integration_config_keys is
  'Private definitions for Vault-backed integration config keys. The schema is not exposed through PostgREST.';

comment on table private.integration_config_versions is
  'Private version metadata for integration config. Secret rows reference Vault and never store provider credentials in table columns.';

comment on table private.integration_config_current_versions is
  'One current integration config version pointer per key.';

comment on table private.integration_config_audit_logs is
  'Append-only audit metadata for integration config changes and safe operational events.';

comment on table private.order_integration_config_snapshots is
  'Immutable Biteship order config snapshot captured before fulfillment eligibility.';

comment on function private.get_runtime_integration_config(text[]) is
  'Service-role runtime config lookup. Secret values are read from Vault only inside this hardened private routine.';

comment on function private.rotate_integration_config_secret(text, text, uuid, text, text, text) is
  'Service-role secret rotation. Creates a new Vault secret per version, updates the current pointer, and writes safe audit metadata.';

comment on function private.update_integration_config_value(text, jsonb, uuid, text, text, text) is
  'Service-role non-secret config update with validation, current pointer update, and audit metadata.';

comment on function private.list_integration_config_summary(text[]) is
  'Service-role summary returning config metadata, non-secret values, and masked secret metadata only.';

comment on function private.list_integration_config_audit(text, integer) is
  'Service-role audit listing returning safe metadata only.';

comment on function public.get_runtime_integration_config(text[]) is
  'Service-role API wrapper for private runtime integration config lookup.';

comment on function public.rotate_integration_config_secret(text, text, uuid, text, text, text) is
  'Service-role API wrapper for private integration config secret rotation.';

comment on function public.update_integration_config_value(text, jsonb, uuid, text, text, text) is
  'Service-role API wrapper for private non-secret integration config updates.';

comment on function public.list_integration_config_summary(text[]) is
  'Service-role API wrapper for private integration config summary metadata.';

comment on function public.list_integration_config_audit(text, integer) is
  'Service-role API wrapper for private integration config audit metadata.';

revoke all on table private.integration_config_keys from public, anon, authenticated;
revoke all on table private.integration_config_versions from public, anon, authenticated;
revoke all on table private.integration_config_current_versions from public, anon, authenticated;
revoke all on table private.integration_config_audit_logs from public, anon, authenticated;
revoke all on table private.order_integration_config_snapshots from public, anon, authenticated;

grant select, insert, update, delete on table private.integration_config_keys to service_role;
grant select, insert, update, delete on table private.integration_config_versions to service_role;
grant select, insert, update, delete on table private.integration_config_current_versions to service_role;
grant select, insert, update, delete on table private.integration_config_audit_logs to service_role;
grant select, insert, update, delete on table private.order_integration_config_snapshots to service_role;

revoke all on function private.set_integration_config_updated_at() from public, anon, authenticated;
revoke all on function private.prevent_integration_config_audit_mutation() from public, anon, authenticated;
revoke all on function private.mask_integration_config_secret(text) from public, anon, authenticated;
revoke all on function private.fingerprint_integration_config_secret(text) from public, anon, authenticated;

revoke all on function private.get_runtime_integration_config(text[]) from public, anon, authenticated;
revoke all on function private.rotate_integration_config_secret(text, text, uuid, text, text, text) from public, anon, authenticated;
revoke all on function private.update_integration_config_value(text, jsonb, uuid, text, text, text) from public, anon, authenticated;
revoke all on function private.list_integration_config_summary(text[]) from public, anon, authenticated;
revoke all on function private.list_integration_config_audit(text, integer) from public, anon, authenticated;

revoke all on function public.get_runtime_integration_config(text[]) from public, anon, authenticated;
revoke all on function public.rotate_integration_config_secret(text, text, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.update_integration_config_value(text, jsonb, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.list_integration_config_summary(text[]) from public, anon, authenticated;
revoke all on function public.list_integration_config_audit(text, integer) from public, anon, authenticated;

grant execute on function private.get_runtime_integration_config(text[]) to service_role;
grant execute on function private.rotate_integration_config_secret(text, text, uuid, text, text, text) to service_role;
grant execute on function private.update_integration_config_value(text, jsonb, uuid, text, text, text) to service_role;
grant execute on function private.list_integration_config_summary(text[]) to service_role;
grant execute on function private.list_integration_config_audit(text, integer) to service_role;

grant execute on function public.get_runtime_integration_config(text[]) to service_role;
grant execute on function public.rotate_integration_config_secret(text, text, uuid, text, text, text) to service_role;
grant execute on function public.update_integration_config_value(text, jsonb, uuid, text, text, text) to service_role;
grant execute on function public.list_integration_config_summary(text[]) to service_role;
grant execute on function public.list_integration_config_audit(text, integer) to service_role;

commit;
