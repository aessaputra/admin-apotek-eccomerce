begin;

comment on column public.orders.payment_status is
  'Legacy compatibility status retained for historical admin/client contracts. Canonical payment state is the latest public.payments.status for the order, ordered by updated_at desc, created_at desc.';

comment on column public.settings.enabled_couriers is
  'candidate_deprecated legacy runtime field. Shipping runtime ownership moved to private integration config key biteship.enabled_couriers; keep only until destructive cleanup is explicitly scheduled.';

comment on column public.settings.origin_postal_code is
  'candidate_deprecated legacy runtime field. Shipping runtime ownership moved to private integration config key biteship.origin_postal_code; keep only until destructive cleanup is explicitly scheduled.';

comment on column public.settings.origin_area_id is
  'candidate_deprecated legacy runtime field. Shipping runtime ownership moved to private integration config key biteship.origin_area_id; keep only until destructive cleanup is explicitly scheduled.';

comment on column public.settings.origin_latitude is
  'candidate_deprecated legacy runtime field. Shipping runtime ownership moved to private integration config key biteship.origin_latitude; keep only until destructive cleanup is explicitly scheduled.';

comment on column public.settings.origin_longitude is
  'candidate_deprecated legacy runtime field. Shipping runtime ownership moved to private integration config key biteship.origin_longitude; keep only until destructive cleanup is explicitly scheduled.';

comment on column public.settings.store_name is
  'keep_public_profile merchant profile field retained in public settings. Runtime shipper identity is owned separately by private integration config.';

comment on column public.settings.phone_number is
  'keep_public_profile merchant profile field retained in public settings. Runtime shipper phone ownership is private integration config key shop.shipper_phone.';

comment on column public.settings.email is
  'keep_public_profile merchant profile field retained in public settings. Runtime shipper email ownership is private integration config key shop.shipper_email.';

comment on column public.settings.organization is
  'keep_public_profile merchant profile field retained in public settings. Runtime shipper organization ownership is private integration config key shop.organization.';

comment on column public.settings.store_address is
  'keep_public_profile merchant profile field retained in public settings. Runtime shipper address ownership is private integration config key shop.address.';

comment on table private.order_integration_config_snapshots is
  'immutable_snapshot order-scoped Biteship runtime config capture. Preserve as historical fulfillment evidence independent of public settings cleanup.';

create or replace function private.notify_admins_of_new_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  notification_route text := '/orders/show/' || new.id::text;
  v_payment_status public.payment_status;
begin
  select payments.status
    into v_payment_status
  from public.payments
  where payments.order_id = new.id
  order by payments.updated_at desc, payments.created_at desc
  limit 1;

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
    pg_catalog.jsonb_build_object(
      'audience', 'admin_dashboard',
      'orderId', new.id,
      'customerName', customer_profile.full_name,
      'orderStatus', new.status,
      'paymentStatus', coalesce(v_payment_status, 'pending'::public.payment_status),
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

comment on function private.notify_admins_of_new_order() is
  'Admin new-order notification producer. Derives paymentStatus from latest public.payments.status with pending fallback; does not depend on legacy public.orders.payment_status.';

revoke all on function private.notify_admins_of_new_order() from public, anon, authenticated;

create or replace trigger orders_admin_new_order_notifications_trigger
after insert on public.orders
for each row
execute function private.notify_admins_of_new_order();

commit;
