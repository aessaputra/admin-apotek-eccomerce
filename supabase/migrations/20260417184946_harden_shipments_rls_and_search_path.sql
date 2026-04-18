begin;

create index if not exists shipments_waybill_overridden_by_idx
  on public.shipments (waybill_overridden_by)
  where waybill_overridden_by is not null;

create or replace function public.update_shipments_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$;

drop policy if exists "Admins can manage all shipments" on public.shipments;
create policy "Admins can manage all shipments"
  on public.shipments
  for all
  to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

commit;
