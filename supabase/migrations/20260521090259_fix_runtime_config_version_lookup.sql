begin;

create or replace function private.get_runtime_integration_config_versions(
  p_key_names text[] default null,
  p_version_numbers jsonb default '{}'::jsonb,
  p_include_grace boolean default true
)
returns table (
  key_name text,
  value_kind text,
  is_secret boolean,
  is_required boolean,
  is_runtime_required boolean,
  version_id uuid,
  version_number integer,
  status text,
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
    raise exception 'service_role is required for runtime integration config version access'
      using errcode = '42501';
  end if;

  p_version_numbers := coalesce(p_version_numbers, '{}'::jsonb);

  if pg_catalog.jsonb_typeof(p_version_numbers) <> 'object' then
    raise exception 'Runtime config version requests must be a JSON object'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_each_text(p_version_numbers) as requested_version(key_name, version_number)
    where requested_version.version_number !~ '^[1-9][0-9]*$'
  ) then
    raise exception 'Runtime config version numbers must be positive integers'
      using errcode = '22023';
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
      v.status,
      case
        when k.is_secret then pg_catalog.to_jsonb(ds.decrypted_secret)
        else v.non_secret_value
      end as runtime_value,
      v.masked_value,
      v.value_fingerprint,
      v.created_at as updated_at
    from private.integration_config_keys as k
    join private.integration_config_versions as v
      on v.key_name = k.key_name
    left join vault.decrypted_secrets as ds
      on ds.id = v.vault_secret_id
    where (p_key_names is null or k.key_name = any (p_key_names))
      and (
        (
          p_version_numbers ? k.key_name
          and v.version_number = (p_version_numbers ->> k.key_name)::integer
        )
        or (
          not (p_version_numbers ? k.key_name)
          and (
            v.status = 'active'
            or (p_include_grace is true and v.status = 'grace')
          )
        )
      )
    order by
      k.key_name,
      case v.status when 'active' then 0 when 'grace' then 1 else 2 end,
      v.version_number desc;
end;
$$;

create or replace function public.get_runtime_integration_config_versions(
  p_key_names text[] default null,
  p_version_numbers jsonb default '{}'::jsonb,
  p_include_grace boolean default true
)
returns table (
  key_name text,
  value_kind text,
  is_secret boolean,
  is_required boolean,
  is_runtime_required boolean,
  version_id uuid,
  version_number integer,
  status text,
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
    raise exception 'service_role is required for runtime integration config version access'
      using errcode = '42501';
  end if;

  return query
    select * from private.get_runtime_integration_config_versions(
      p_key_names,
      p_version_numbers,
      p_include_grace
    );
end;
$$;

comment on function private.get_runtime_integration_config_versions(text[], jsonb, boolean) is
  'Service-role runtime config lookup returning active, grace, or explicit versions. Secret values are read from Vault only inside this hardened private routine.';

comment on function public.get_runtime_integration_config_versions(text[], jsonb, boolean) is
  'Service-role API wrapper for private runtime integration config version lookup.';

revoke all on function private.get_runtime_integration_config_versions(text[], jsonb, boolean) from public, anon, authenticated;
revoke all on function public.get_runtime_integration_config_versions(text[], jsonb, boolean) from public, anon, authenticated;

grant execute on function private.get_runtime_integration_config_versions(text[], jsonb, boolean) to service_role;
grant execute on function public.get_runtime_integration_config_versions(text[], jsonb, boolean) to service_role;

do $$
declare
  v_signature text;
  v_function_oid oid;
  v_definition text;
begin
  foreach v_signature in array array[
    'private.mask_integration_config_secret(text)',
    'private.rotate_integration_config_secret(text, text, uuid, text, text, text)',
    'private.update_integration_config_value(text, jsonb, uuid, text, text, text)',
    'private.list_integration_config_audit(text, integer)',
    'private.bind_midtrans_payment_config_versions(uuid, text, text, uuid, uuid, integer, uuid, integer, boolean)',
    'private.create_biteship_order_config_snapshot(uuid, uuid, text, text, numeric, numeric, text[], text, text, text, text, text, text, jsonb, text, uuid)',
    'private.persist_midtrans_payment_session(uuid, uuid, text, text, public.payment_status, public.payment_type, numeric, timestamp with time zone, text, text, timestamp with time zone, text, uuid, uuid, integer, uuid, integer, boolean)'
  ]
  loop
    v_function_oid := pg_catalog.to_regprocedure(v_signature);

    if v_function_oid is null then
      raise exception 'Missing function during integration config special-form repair: %', v_signature
        using errcode = '42883';
    end if;

    v_definition := pg_catalog.pg_get_functiondef(v_function_oid);
    v_definition := replace(v_definition, 'pg_catalog.' || 'coalesce', 'coalesce');
    v_definition := replace(v_definition, 'pg_catalog.' || 'nullif', 'nullif');

    execute v_definition;
  end loop;
end;
$$;

commit;
