begin;

create schema if not exists private;

create or replace function private.notify_admins_of_new_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  notification_route text := '/orders/show/' || new.id::text;
begin
  insert into public.notifications (
    user_id,
    type,
    title,
    body,
    cta_route,
    data,
    priority,
    source_event_key
  )
  select
    admin_profile.id,
    'new_order',
    'New order received',
    'Open the order detail to review it',
    notification_route,
    jsonb_build_object(
      'audience', 'admin_dashboard',
      'orderId', new.id,
      'customerName', customer_profile.full_name,
      'orderStatus', new.status,
      'paymentStatus', new.payment_status,
      'createdAt', new.created_at,
      'route', notification_route
    ),
    'high',
    'admin:new-order:' || new.id::text
  from public.profiles as admin_profile
  left join public.profiles as customer_profile
    on customer_profile.id = new.user_id
  where admin_profile.role = 'admin'
  on conflict (user_id, source_event_key) where source_event_key is not null
  do nothing;

  return new;
end;
$$;

revoke all on function private.notify_admins_of_new_order() from public, anon, authenticated;

drop trigger if exists orders_admin_new_order_notifications_trigger on public.orders;
create trigger orders_admin_new_order_notifications_trigger
after insert on public.orders
for each row
execute function private.notify_admins_of_new_order();

do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_publication
    where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;

commit;
