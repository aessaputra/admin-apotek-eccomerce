begin;

-- Remove the legacy duplicate updated_at trigger on public.orders while preserving
-- the canonical trigger_update_orders_updated_at -> public.update_orders_updated_at() path.
do $$
declare
  v_legacy_trigger_exists boolean;
begin
  select exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace cn on cn.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace pn on pn.oid = p.pronamespace
    where not t.tgisinternal
      and cn.nspname = 'public'
      and c.relname = 'orders'
      and t.tgname = 'orders_set_updated_at'
      and pn.nspname = 'public'
      and p.proname = 'set_orders_updated_at'
  ) into v_legacy_trigger_exists;

  if v_legacy_trigger_exists then
    execute 'drop trigger if exists orders_set_updated_at on public.orders';
  end if;
end
$$;

do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'set_orders_updated_at'
  )
  and not exists (
    select 1
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace n on n.oid = p.pronamespace
    where not t.tgisinternal
      and n.nspname = 'public'
      and p.proname = 'set_orders_updated_at'
  ) then
    execute 'drop function public.set_orders_updated_at()';
  end if;
end
$$;

commit;
