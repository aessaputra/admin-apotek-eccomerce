begin;

create index if not exists orders_customer_completed_by_idx
  on public.orders (customer_completed_by)
  where customer_completed_by is not null;

create or replace function public.sync_order_delivery_metadata()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'delivered' then
    new.delivered_at := coalesce(
      new.delivered_at,
      case
        when tg_op = 'UPDATE' and old.status = 'delivered' then old.delivered_at
        else null
      end,
      timezone('utc'::text, now())
    );

    new.complaint_window_expires_at := coalesce(
      new.complaint_window_expires_at,
      case
        when tg_op = 'UPDATE' and old.status = 'delivered' then old.complaint_window_expires_at
        else null
      end,
      new.delivered_at + interval '2 days'
    );
  end if;

  return new;
end;
$$;

drop policy if exists "Admins can manage all shipments" on public.shipments;
drop policy if exists "Users can view own shipments" on public.shipments;

create policy "Admins can insert shipments"
  on public.shipments
  for insert
  to authenticated
  with check ((select private.is_admin()));

create policy "Admins can update shipments"
  on public.shipments
  for update
  to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy "Admins can delete shipments"
  on public.shipments
  for delete
  to authenticated
  using ((select private.is_admin()));

create policy "Authenticated users can view shipments"
  on public.shipments
  for select
  to authenticated
  using (
    (select private.is_admin())
    or exists (
      select 1
      from public.orders as o
      where o.id = shipments.order_id
        and o.user_id = (select auth.uid())
    )
  );

drop policy if exists "Allow authenticated users to select settings" on public.settings;
drop policy if exists "Allow public read store branding" on public.settings;

create policy "Public and authenticated users can read settings"
  on public.settings
  for select
  to public
  using ((id = 1) or (select private.is_admin()));

commit;
