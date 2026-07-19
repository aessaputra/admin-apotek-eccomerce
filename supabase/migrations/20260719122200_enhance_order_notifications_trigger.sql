begin;

-- Redefine function with search path locked
create or replace function private.notify_admins_of_new_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  notification_route text := '/orders/show/' || new.id::text;
  v_item_count bigint;
begin
  -- Since this trigger is a deferred constraint trigger, it fires at commit time.
  -- This guarantees order_items have already been inserted in the transaction.
  select coalesce(sum(quantity), 0) into v_item_count
  from public.order_items
  where order_id = new.id;

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
      'totalAmount', new.total_amount,
      'itemCount', v_item_count,
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
  do update set
    data = excluded.data;

  return new;
end;
$$;

revoke all on function private.notify_admins_of_new_order() from public, anon, authenticated;

-- Drop the old trigger
drop trigger if exists orders_admin_new_order_notifications_trigger on public.orders;

-- Create constraint trigger that is deferred initially
create constraint trigger orders_admin_new_order_notifications_trigger
after insert on public.orders
deferrable initially deferred
for each row
execute function private.notify_admins_of_new_order();

commit;
