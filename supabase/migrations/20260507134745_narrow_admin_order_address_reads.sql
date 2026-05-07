begin;

drop policy if exists "Admins can view all addresses" on public.addresses;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'addresses'
      and policyname = 'Admins can view order shipping addresses'
  ) then
    create policy "Admins can view order shipping addresses"
      on public.addresses
      for select
      to authenticated
      using (
        (select private.is_admin())
        and exists (
          select 1
          from public.orders
          where orders.shipping_address_id = addresses.id
        )
      );
  end if;
end
$$;

comment on policy "Admins can view order shipping addresses" on public.addresses is
  'Allows verified admins to view only addresses linked to orders for fulfillment and customer support.';

commit;
