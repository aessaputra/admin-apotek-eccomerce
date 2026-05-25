begin;

-- True orphan payments cannot be mapped to an order from midtrans_order_id after legacy orders.midtrans_order_id was dropped; attachment must happen in order/session persistence paths.
create or replace function public.reconcile_midtrans_orphan_notifications(p_limit integer default 20)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_processed integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service_role required'
      using errcode = '42501';
  end if;

  return v_processed;
end;
$$;

revoke all on function public.reconcile_midtrans_orphan_notifications(integer) from public, anon, authenticated;
grant execute on function public.reconcile_midtrans_orphan_notifications(integer) to service_role;

commit;
