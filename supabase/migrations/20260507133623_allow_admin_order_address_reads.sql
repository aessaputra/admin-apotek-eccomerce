begin;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'addresses'
      and policyname = 'Admins can view all addresses'
  ) then
    create policy "Admins can view all addresses"
      on public.addresses
      for select
      to authenticated
      using ((select private.is_admin()));
  end if;
end
$$;

comment on policy "Admins can view all addresses" on public.addresses is
  'Allows verified admins to view shipping addresses for order fulfillment and customer support.';

commit;
