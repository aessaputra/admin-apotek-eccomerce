begin;

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
  is_production boolean
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
      binding.is_production
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
  is_production boolean
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

comment on function private.get_midtrans_payment_config_binding(text) is
  'Service-role transaction-bound Midtrans config binding lookup by Midtrans order ID. Returns version metadata only; never plaintext provider secrets.';

comment on function public.get_midtrans_payment_config_binding(text) is
  'Service-role API wrapper for transaction-bound Midtrans config binding lookup.';

revoke all on function private.get_midtrans_payment_config_binding(text) from public, anon, authenticated;
revoke all on function public.get_midtrans_payment_config_binding(text) from public, anon, authenticated;

grant execute on function private.get_midtrans_payment_config_binding(text) to service_role;
grant execute on function public.get_midtrans_payment_config_binding(text) to service_role;

commit;
