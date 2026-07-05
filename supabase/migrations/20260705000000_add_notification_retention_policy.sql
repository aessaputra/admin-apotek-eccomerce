begin;

-- =============================================================================
-- Notification retention: automatically delete notifications older than 14 days.
--
-- This runs daily via pg_cron and removes notifications (and their push
-- delivery records via ON DELETE CASCADE) whose created_at is older than
-- 14 days. Both read and unread notifications are removed.
--
-- If you later want to keep unread notifications, change the WHERE clause in
-- private.delete_old_notifications() to "read_at is not null and ...".
-- =============================================================================

-- Batch-delete function. Security definer is required because pg_cron runs
-- as postgres; the function executes with the privileges of the migration owner.
create or replace function private.delete_old_notifications()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count int;
begin
  loop
    delete from public.notifications
    where id in (
      select n.id
      from public.notifications n
      where n.created_at < timezone('utc'::text, now()) - interval '14 days'
      order by n.created_at
      limit 1000
    );

    get diagnostics deleted_count = row_count;
    exit when deleted_count = 0;
  end loop;
end;
$$;

comment on function private.delete_old_notifications() is
  'Batch-deletes notifications older than 14 days. Called daily by pg_cron.';

-- Idempotently remove any existing schedule before creating it.
do $$
begin
  perform cron.unschedule('notification-retention-cleanup');
exception
  when others then
    -- Job did not exist; safe to ignore.
    null;
end;
$$;

-- Schedule daily cleanup at 03:00 UTC.
select cron.schedule(
  'notification-retention-cleanup',
  '0 3 * * *',
  'select private.delete_old_notifications();'
);

commit;
