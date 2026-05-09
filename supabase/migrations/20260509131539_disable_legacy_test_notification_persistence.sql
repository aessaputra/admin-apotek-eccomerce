begin;

create or replace function public.create_test_notification()
returns public.notifications
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication required to create test notification.' using errcode = '42501';
  end if;

  return null::public.notifications;
end;
$$;

comment on function public.create_test_notification() is
  'Legacy mobile compatibility RPC for test notifications. Authenticated calls succeed without persisting notifications or push delivery rows.';

drop policy if exists "Users can insert own test notifications" on public.notifications;
revoke insert on public.notifications from authenticated;

revoke all on function public.create_test_notification() from public, anon;
grant execute on function public.create_test_notification() to authenticated;

commit;
