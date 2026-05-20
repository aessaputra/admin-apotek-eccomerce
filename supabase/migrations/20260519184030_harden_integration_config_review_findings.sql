begin;

revoke select on table public.payments from anon, authenticated;
grant select (
  id,
  order_id,
  user_id,
  checkout_idempotency_key,
  midtrans_order_id,
  midtrans_transaction_id,
  status,
  payment_type,
  transaction_status,
  fraud_status,
  status_code,
  status_message,
  currency,
  gross_amount,
  merchant_id,
  transaction_time,
  settlement_time,
  expiry_time,
  paid_at,
  payment_code,
  store,
  va_numbers,
  biller_code,
  bill_key,
  bank,
  acquirer,
  issuer,
  card_type,
  masked_card,
  approval_code,
  eci,
  channel_response_code,
  channel_response_message,
  snap_token,
  redirect_url,
  snap_token_created_at,
  created_at,
  updated_at
) on table public.payments to authenticated;
grant select on table public.payments to service_role;

drop function if exists public.get_midtrans_payment_config_binding(text);
drop function if exists private.get_midtrans_payment_config_binding(text);

create or replace function private.get_midtrans_payment_config_binding(
  p_midtrans_order_id text
)
returns table (
  payment_id uuid,
  midtrans_order_id text,
  server_key_version_id uuid,
  server_key_version_number integer,
  is_production_version_id uuid,
  is_production_version_number integer,
  is_production boolean,
  binding_source text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service_role is required to read Midtrans payment config bindings'
      using errcode = '42501';
  end if;

  if p_midtrans_order_id is null or pg_catalog.btrim(p_midtrans_order_id) = '' then
    raise exception 'p_midtrans_order_id is required'
      using errcode = '22023';
  end if;

  return query
    select
      binding.payment_id,
      binding.midtrans_order_id,
      binding.server_key_version_id,
      binding.server_key_version_number,
      binding.is_production_version_id,
      binding.is_production_version_number,
      binding.is_production,
      binding.binding_source
    from private.midtrans_payment_config_bindings as binding
    where binding.midtrans_order_id = pg_catalog.btrim(p_midtrans_order_id)
    limit 1;
end;
$$;

create or replace function public.get_midtrans_payment_config_binding(
  p_midtrans_order_id text
)
returns table (
  payment_id uuid,
  midtrans_order_id text,
  server_key_version_id uuid,
  server_key_version_number integer,
  is_production_version_id uuid,
  is_production_version_number integer,
  is_production boolean,
  binding_source text
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service_role is required to read Midtrans payment config bindings'
      using errcode = '42501';
  end if;

  return query
    select * from private.get_midtrans_payment_config_binding(p_midtrans_order_id);
end;
$$;

create or replace function private.bind_midtrans_payment_config_versions(
  p_payment_id uuid,
  p_midtrans_order_id text,
  p_binding_source text default 'create_snap_token',
  p_source_payment_id uuid default null,
  p_server_key_version_id uuid default null,
  p_server_key_version_number integer default null,
  p_is_production_version_id uuid default null,
  p_is_production_version_number integer default null,
  p_is_production boolean default null
)
returns table (
  payment_id uuid,
  midtrans_order_id text,
  server_key_version_id uuid,
  server_key_version_number integer,
  is_production_version_id uuid,
  is_production_version_number integer,
  is_production boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing_binding private.midtrans_payment_config_bindings%rowtype;
  v_source_binding private.midtrans_payment_config_bindings%rowtype;
  v_server_key_version_id uuid;
  v_server_key_version_number integer;
  v_is_production_version_id uuid;
  v_is_production_version_number integer;
  v_is_production boolean;
  v_has_explicit_config boolean;
  v_has_partial_explicit_config boolean;
  v_binding_source text := pg_catalog.coalesce(nullif(pg_catalog.btrim(p_binding_source), ''), 'create_snap_token');
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service_role is required to bind Midtrans payment config versions'
      using errcode = '42501';
  end if;

  if p_payment_id is null then
    raise exception 'p_payment_id is required'
      using errcode = '22023';
  end if;

  if p_midtrans_order_id is null or pg_catalog.btrim(p_midtrans_order_id) = '' then
    raise exception 'p_midtrans_order_id is required'
      using errcode = '22023';
  end if;

  if v_binding_source = 'snap_token_reuse' and p_source_payment_id is null then
    raise exception 'Source Midtrans payment config binding is required for Snap token reuse'
      using errcode = '23514';
  end if;

  v_has_explicit_config :=
    p_server_key_version_id is not null
    and p_server_key_version_number is not null
    and p_is_production_version_id is not null
    and p_is_production_version_number is not null
    and p_is_production is not null;

  v_has_partial_explicit_config :=
    p_server_key_version_id is not null
    or p_server_key_version_number is not null
    or p_is_production_version_id is not null
    or p_is_production_version_number is not null
    or p_is_production is not null;

  if v_has_partial_explicit_config and not v_has_explicit_config then
    raise exception 'Explicit Midtrans config version metadata must be provided as a complete set'
      using errcode = '22023';
  end if;

  if v_has_explicit_config
     and (p_server_key_version_number <= 0 or p_is_production_version_number <= 0) then
    raise exception 'Explicit Midtrans config version numbers must be positive'
      using errcode = '22023';
  end if;

  select *
    into v_existing_binding
  from private.midtrans_payment_config_bindings as target_binding
  where target_binding.payment_id = p_payment_id;

  if found and p_source_payment_id is null and not v_has_explicit_config then
    return query
      select
        v_existing_binding.payment_id,
        v_existing_binding.midtrans_order_id,
        v_existing_binding.server_key_version_id,
        v_existing_binding.server_key_version_number,
        v_existing_binding.is_production_version_id,
        v_existing_binding.is_production_version_number,
        v_existing_binding.is_production;
    return;
  end if;

  if p_source_payment_id is not null then
    select *
      into v_source_binding
    from private.midtrans_payment_config_bindings as source_binding
    where source_binding.payment_id = p_source_payment_id;

    if not found then
      raise exception 'Source Midtrans payment config binding is required for Snap token reuse'
        using errcode = '23514';
    end if;

    v_server_key_version_id := v_source_binding.server_key_version_id;
    v_server_key_version_number := v_source_binding.server_key_version_number;
    v_is_production_version_id := v_source_binding.is_production_version_id;
    v_is_production_version_number := v_source_binding.is_production_version_number;
    v_is_production := v_source_binding.is_production;
  elsif v_has_explicit_config then
    v_server_key_version_id := p_server_key_version_id;
    v_server_key_version_number := p_server_key_version_number;
    v_is_production_version_id := p_is_production_version_id;
    v_is_production_version_number := p_is_production_version_number;
    v_is_production := p_is_production;
  else
    select
      server_version.id,
      server_version.version_number,
      production_version.id,
      production_version.version_number,
      (production_version.non_secret_value::text)::boolean
    into
      v_server_key_version_id,
      v_server_key_version_number,
      v_is_production_version_id,
      v_is_production_version_number,
      v_is_production
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
    limit 1;
  end if;

  if v_server_key_version_id is null or v_is_production_version_id is null then
    raise exception 'Active Midtrans config versions are required before binding payment transactions'
      using errcode = '23514';
  end if;

  return query
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
    values (
      p_payment_id,
      pg_catalog.btrim(p_midtrans_order_id),
      'midtrans.server_key',
      v_server_key_version_id,
      v_server_key_version_number,
      'midtrans.is_production',
      v_is_production_version_id,
      v_is_production_version_number,
      v_is_production,
      v_binding_source
    )
    on conflict (payment_id) do update
    set
      midtrans_order_id = excluded.midtrans_order_id,
      server_key_config_key_name = excluded.server_key_config_key_name,
      server_key_version_id = excluded.server_key_version_id,
      server_key_version_number = excluded.server_key_version_number,
      is_production_config_key_name = excluded.is_production_config_key_name,
      is_production_version_id = excluded.is_production_version_id,
      is_production_version_number = excluded.is_production_version_number,
      is_production = excluded.is_production,
      binding_source = excluded.binding_source,
      updated_at = pg_catalog.timezone('utc'::text, pg_catalog.now())
    returning
      private.midtrans_payment_config_bindings.payment_id,
      private.midtrans_payment_config_bindings.midtrans_order_id,
      private.midtrans_payment_config_bindings.server_key_version_id,
      private.midtrans_payment_config_bindings.server_key_version_number,
      private.midtrans_payment_config_bindings.is_production_version_id,
      private.midtrans_payment_config_bindings.is_production_version_number,
      private.midtrans_payment_config_bindings.is_production;
end;
$$;

create or replace function private.persist_midtrans_payment_session(
  p_order_id uuid,
  p_user_id uuid,
  p_checkout_idempotency_key text,
  p_midtrans_order_id text,
  p_status public.payment_status,
  p_payment_type public.payment_type default null,
  p_gross_amount numeric default null,
  p_expiry_time timestamptz default null,
  p_snap_token text default null,
  p_redirect_url text default null,
  p_snap_token_created_at timestamptz default null,
  p_binding_source text default 'snap_token_created',
  p_source_payment_id uuid default null,
  p_server_key_version_id uuid default null,
  p_server_key_version_number integer default null,
  p_is_production_version_id uuid default null,
  p_is_production_version_number integer default null,
  p_is_production boolean default null
)
returns table (
  id uuid,
  midtrans_order_id text,
  snap_token text,
  redirect_url text,
  snap_token_created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment_id uuid;
  v_existing_midtrans_payment_id uuid;
  v_existing_payment_order_id uuid;
  v_binding_source text := pg_catalog.coalesce(nullif(pg_catalog.btrim(p_binding_source), ''), 'snap_token_created');
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service_role is required to persist Midtrans payment sessions'
      using errcode = '42501';
  end if;

  if p_order_id is null then
    raise exception 'p_order_id is required'
      using errcode = '22023';
  end if;

  if p_midtrans_order_id is null or pg_catalog.btrim(p_midtrans_order_id) = '' then
    raise exception 'p_midtrans_order_id is required'
      using errcode = '22023';
  end if;

  if p_status is null then
    raise exception 'p_status is required'
      using errcode = '22023';
  end if;

  if p_gross_amount is null then
    raise exception 'p_gross_amount is required'
      using errcode = '22023';
  end if;

  select
      payments.id,
      payments.order_id
    into
      v_existing_midtrans_payment_id,
      v_existing_payment_order_id
  from public.payments as payments
  where payments.midtrans_order_id = pg_catalog.btrim(p_midtrans_order_id)
  limit 1;

  if found and v_existing_payment_order_id is not null and v_existing_payment_order_id <> p_order_id then
    raise exception 'Midtrans order id is already bound to a different order'
      using errcode = '23505';
  end if;

  select payments.id
    into v_payment_id
  from public.payments as payments
  where payments.order_id = p_order_id
  order by payments.updated_at desc, payments.created_at desc
  limit 1;

  if not found and v_existing_midtrans_payment_id is not null then
    v_payment_id := v_existing_midtrans_payment_id;
  end if;

  if v_payment_id is not null then
    update public.payments as payments
    set
      user_id = p_user_id,
      checkout_idempotency_key = p_checkout_idempotency_key,
      midtrans_order_id = pg_catalog.btrim(p_midtrans_order_id),
      status = p_status,
      payment_type = p_payment_type,
      gross_amount = p_gross_amount,
      expiry_time = p_expiry_time,
      snap_token = p_snap_token,
      redirect_url = p_redirect_url,
      snap_token_created_at = p_snap_token_created_at
    where payments.id = v_payment_id
    returning payments.id into v_payment_id;
  else
    insert into public.payments (
      order_id,
      user_id,
      checkout_idempotency_key,
      midtrans_order_id,
      status,
      payment_type,
      gross_amount,
      expiry_time,
      snap_token,
      redirect_url,
      snap_token_created_at
    )
    values (
      p_order_id,
      p_user_id,
      p_checkout_idempotency_key,
      pg_catalog.btrim(p_midtrans_order_id),
      p_status,
      p_payment_type,
      p_gross_amount,
      p_expiry_time,
      p_snap_token,
      p_redirect_url,
      p_snap_token_created_at
    )
    returning public.payments.id into v_payment_id;
  end if;

  perform * from private.bind_midtrans_payment_config_versions(
    v_payment_id,
    pg_catalog.btrim(p_midtrans_order_id),
    v_binding_source,
    p_source_payment_id,
    p_server_key_version_id,
    p_server_key_version_number,
    p_is_production_version_id,
    p_is_production_version_number,
    p_is_production
  );

  return query
    select
      payments.id,
      payments.midtrans_order_id,
      payments.snap_token,
      payments.redirect_url,
      payments.snap_token_created_at
    from public.payments as payments
    where payments.id = v_payment_id;
end;
$$;

create or replace function public.persist_midtrans_payment_session(
  p_order_id uuid,
  p_user_id uuid,
  p_checkout_idempotency_key text,
  p_midtrans_order_id text,
  p_status public.payment_status,
  p_payment_type public.payment_type default null,
  p_gross_amount numeric default null,
  p_expiry_time timestamptz default null,
  p_snap_token text default null,
  p_redirect_url text default null,
  p_snap_token_created_at timestamptz default null,
  p_binding_source text default 'snap_token_created',
  p_source_payment_id uuid default null,
  p_server_key_version_id uuid default null,
  p_server_key_version_number integer default null,
  p_is_production_version_id uuid default null,
  p_is_production_version_number integer default null,
  p_is_production boolean default null
)
returns table (
  id uuid,
  midtrans_order_id text,
  snap_token text,
  redirect_url text,
  snap_token_created_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service_role is required to persist Midtrans payment sessions'
      using errcode = '42501';
  end if;

  return query
    select * from private.persist_midtrans_payment_session(
      p_order_id,
      p_user_id,
      p_checkout_idempotency_key,
      p_midtrans_order_id,
      p_status,
      p_payment_type,
      p_gross_amount,
      p_expiry_time,
      p_snap_token,
      p_redirect_url,
      p_snap_token_created_at,
      p_binding_source,
      p_source_payment_id,
      p_server_key_version_id,
      p_server_key_version_number,
      p_is_production_version_id,
      p_is_production_version_number,
      p_is_production
    );
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
    nullif(pg_catalog.btrim(pg_catalog.coalesce(p_reason, '')), ''),
    pg_catalog.coalesce(nullif(pg_catalog.btrim(p_source), ''), 'service_rpc'),
    nullif(pg_catalog.btrim(pg_catalog.coalesce(p_request_id, '')), '')
  )
  returning id into v_version_id;

  update private.integration_config_versions as old_versions
  set
    status = 'retired',
    retired_at = pg_catalog.timezone('utc'::text, pg_catalog.now())
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
    pg_catalog.coalesce(nullif(pg_catalog.btrim(p_source), ''), 'service_rpc'),
    nullif(pg_catalog.btrim(pg_catalog.coalesce(p_request_id, '')), ''),
    nullif(pg_catalog.btrim(pg_catalog.coalesce(p_reason, '')), ''),
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

revoke all on function private.get_midtrans_payment_config_binding(text) from public, anon, authenticated;
revoke all on function public.get_midtrans_payment_config_binding(text) from public, anon, authenticated;
grant execute on function private.get_midtrans_payment_config_binding(text) to service_role;
grant execute on function public.get_midtrans_payment_config_binding(text) to service_role;

revoke all on function private.persist_midtrans_payment_session(uuid, uuid, text, text, public.payment_status, public.payment_type, numeric, timestamptz, text, text, timestamptz, text, uuid, uuid, integer, uuid, integer, boolean) from public, anon, authenticated;
revoke all on function public.persist_midtrans_payment_session(uuid, uuid, text, text, public.payment_status, public.payment_type, numeric, timestamptz, text, text, timestamptz, text, uuid, uuid, integer, uuid, integer, boolean) from public, anon, authenticated;
grant execute on function private.persist_midtrans_payment_session(uuid, uuid, text, text, public.payment_status, public.payment_type, numeric, timestamptz, text, text, timestamptz, text, uuid, uuid, integer, uuid, integer, boolean) to service_role;
grant execute on function public.persist_midtrans_payment_session(uuid, uuid, text, text, public.payment_status, public.payment_type, numeric, timestamptz, text, text, timestamptz, text, uuid, uuid, integer, uuid, integer, boolean) to service_role;

revoke all on function private.update_integration_config_value(text, jsonb, uuid, text, text, text) from public, anon, authenticated;
grant execute on function private.update_integration_config_value(text, jsonb, uuid, text, text, text) to service_role;

comment on function private.persist_midtrans_payment_session(uuid, uuid, text, text, public.payment_status, public.payment_type, numeric, timestamptz, text, text, timestamptz, text, uuid, uuid, integer, uuid, integer, boolean) is
  'Service-role atomic payment-session persistence plus Midtrans config binding. Stores version metadata only; never raw provider credentials.';
comment on function public.persist_midtrans_payment_session(uuid, uuid, text, text, public.payment_status, public.payment_type, numeric, timestamptz, text, text, timestamptz, text, uuid, uuid, integer, uuid, integer, boolean) is
  'Service-role API wrapper for atomic Midtrans payment-session persistence plus config binding.';

commit;
