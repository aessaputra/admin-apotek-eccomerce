begin;

create table if not exists private.midtrans_payment_config_bindings (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete cascade,
  midtrans_order_id text not null,
  server_key_config_key_name text not null default 'midtrans.server_key',
  server_key_version_id uuid not null,
  server_key_version_number integer not null,
  is_production_config_key_name text not null default 'midtrans.is_production',
  is_production_version_id uuid not null,
  is_production_version_number integer not null,
  is_production boolean not null,
  binding_source text not null default 'create_snap_token',
  created_at timestamptz not null default pg_catalog.timezone('utc'::text, pg_catalog.now()),
  updated_at timestamptz not null default pg_catalog.timezone('utc'::text, pg_catalog.now()),
  constraint midtrans_payment_config_bindings_payment_uidx unique (payment_id),
  constraint midtrans_payment_config_bindings_midtrans_order_uidx unique (midtrans_order_id),
  constraint midtrans_payment_config_bindings_server_key_name_check
    check (server_key_config_key_name = 'midtrans.server_key'),
  constraint midtrans_payment_config_bindings_is_production_name_check
    check (is_production_config_key_name = 'midtrans.is_production'),
  constraint midtrans_payment_config_bindings_server_key_version_positive_check
    check (server_key_version_number > 0),
  constraint midtrans_payment_config_bindings_is_production_version_positive_check
    check (is_production_version_number > 0),
  constraint midtrans_payment_config_bindings_source_check
    check (binding_source = any (array['create_snap_token'::text, 'snap_token_created'::text, 'snap_token_reuse'::text, 'legacy_backfill'::text])),
  constraint midtrans_payment_config_bindings_server_key_version_fk
    foreign key (server_key_config_key_name, server_key_version_number, server_key_version_id)
    references private.integration_config_versions(key_name, version_number, id)
    on delete restrict,
  constraint midtrans_payment_config_bindings_is_production_version_fk
    foreign key (is_production_config_key_name, is_production_version_number, is_production_version_id)
    references private.integration_config_versions(key_name, version_number, id)
    on delete restrict
);

create index if not exists midtrans_payment_config_bindings_server_key_version_idx
  on private.midtrans_payment_config_bindings (server_key_config_key_name, server_key_version_number);

create index if not exists midtrans_payment_config_bindings_is_production_version_idx
  on private.midtrans_payment_config_bindings (is_production_config_key_name, is_production_version_number);

alter table private.midtrans_payment_config_bindings enable row level security;
alter table private.midtrans_payment_config_bindings force row level security;

create or replace function private.set_midtrans_payment_config_binding_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.timezone('utc'::text, pg_catalog.now());
  return new;
end;
$$;

drop trigger if exists midtrans_payment_config_bindings_updated_at_trigger on private.midtrans_payment_config_bindings;
create trigger midtrans_payment_config_bindings_updated_at_trigger
before update on private.midtrans_payment_config_bindings
for each row
execute function private.set_midtrans_payment_config_binding_updated_at();

drop function if exists private.bind_midtrans_payment_config_versions(uuid, text, text);
drop function if exists private.bind_midtrans_payment_config_versions(uuid, text, text, uuid);

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
  v_binding_source text := pg_catalog.coalesce(pg_catalog.nullif(pg_catalog.btrim(p_binding_source), ''), 'create_snap_token');
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

  if found then
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
      server_key_config_key_name = private.midtrans_payment_config_bindings.server_key_config_key_name,
      server_key_version_id = private.midtrans_payment_config_bindings.server_key_version_id,
      server_key_version_number = private.midtrans_payment_config_bindings.server_key_version_number,
      is_production_config_key_name = private.midtrans_payment_config_bindings.is_production_config_key_name,
      is_production_version_id = private.midtrans_payment_config_bindings.is_production_version_id,
      is_production_version_number = private.midtrans_payment_config_bindings.is_production_version_number,
      is_production = private.midtrans_payment_config_bindings.is_production,
      binding_source = private.midtrans_payment_config_bindings.binding_source,
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

drop function if exists public.bind_midtrans_payment_config_versions(uuid, text, text);
drop function if exists public.bind_midtrans_payment_config_versions(uuid, text, text, uuid);

create or replace function public.bind_midtrans_payment_config_versions(
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
security invoker
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service_role is required to bind Midtrans payment config versions'
      using errcode = '42501';
  end if;

  return query
    select * from private.bind_midtrans_payment_config_versions(
      p_payment_id,
      p_midtrans_order_id,
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

-- Legacy Midtrans payments are bound to whichever active Midtrans config versions exist at migration time.
-- Historical provider key/mode versions were not captured before this table existed, so no older version can be inferred.
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
)
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
  p.id,
  p.midtrans_order_id,
  'midtrans.server_key',
  active_config.server_key_version_id,
  active_config.server_key_version_number,
  'midtrans.is_production',
  active_config.is_production_version_id,
  active_config.is_production_version_number,
  active_config.is_production,
  'legacy_backfill'
from public.payments as p
cross join active_midtrans_config as active_config
where p.midtrans_order_id is not null
on conflict (payment_id) do nothing;

comment on table private.midtrans_payment_config_bindings is
  'Private transaction binding for Midtrans payment config versions. Stores version identifiers and production mode only, never raw Midtrans credentials.';

comment on function private.bind_midtrans_payment_config_versions(uuid, text, text, uuid, uuid, integer, uuid, integer, boolean) is
  'Service-role binding routine that records selected Midtrans config version metadata for fresh Snap tokens and preserves existing/source bindings on Snap token reuse.';

comment on function public.bind_midtrans_payment_config_versions(uuid, text, text, uuid, uuid, integer, uuid, integer, boolean) is
  'Service-role API wrapper for private Midtrans payment config binding.';

revoke all on table private.midtrans_payment_config_bindings from public, anon, authenticated;
grant select, insert, update, delete on table private.midtrans_payment_config_bindings to service_role;

revoke all on function private.set_midtrans_payment_config_binding_updated_at() from public, anon, authenticated;
revoke all on function private.bind_midtrans_payment_config_versions(uuid, text, text, uuid, uuid, integer, uuid, integer, boolean) from public, anon, authenticated;
revoke all on function public.bind_midtrans_payment_config_versions(uuid, text, text, uuid, uuid, integer, uuid, integer, boolean) from public, anon, authenticated;

grant execute on function private.bind_midtrans_payment_config_versions(uuid, text, text, uuid, uuid, integer, uuid, integer, boolean) to service_role;
grant execute on function public.bind_midtrans_payment_config_versions(uuid, text, text, uuid, uuid, integer, uuid, integer, boolean) to service_role;

commit;
