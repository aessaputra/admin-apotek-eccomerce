begin;

create or replace function public.create_test_notification()
returns public.notifications
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_notification public.notifications;
begin
  if v_user_id is null then
    raise exception 'Authentication required to create test notification.' using errcode = '42501';
  end if;

  insert into public.notifications (
    user_id,
    type,
    title,
    body,
    cta_route,
    data,
    priority,
    source_event_key
  ) values (
    v_user_id,
    'test_notification',
    'Tes Notifikasi',
    'Ini adalah notifikasi tes dari aplikasi Apotek Ecommerce.',
    null,
    '{}'::jsonb,
    'normal',
    'mobile-test-' || v_user_id::text || '-' || floor(extract(epoch from clock_timestamp()) * 1000)::text
  )
  returning * into v_notification;

  return v_notification;
end;
$$;

comment on function public.create_test_notification() is
  'Creates a customer-owned test notification so the existing notification insert trigger can dispatch a push notification.';

grant insert on public.notifications to authenticated;

drop policy if exists "Users can insert own test notifications" on public.notifications;
create policy "Users can insert own test notifications"
  on public.notifications
  for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and type = 'test_notification'
    and title = 'Tes Notifikasi'
    and body = 'Ini adalah notifikasi tes dari aplikasi Apotek Ecommerce.'
    and cta_route is null
    and data = '{}'::jsonb
    and priority = 'normal'
    and source_event_key like ('mobile-test-' || (select auth.uid())::text || '-%')
    and read_at is null
  );

revoke all on function public.create_test_notification() from public, anon;
grant execute on function public.create_test_notification() to authenticated;

commit;
