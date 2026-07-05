begin;

-- =============================================================================
-- Truncate all existing notifications.
--
-- Orders have been cleaned up, so the existing notification history is no
-- longer relevant. This migration removes every row from public.notifications;
-- related push delivery records are removed automatically via ON DELETE CASCADE.
--
-- New notifications are still subject to the 14-day retention policy managed
-- by private.delete_old_notifications() and the pg_cron job scheduled in
-- 20260705000000_add_notification_retention_policy.sql.
-- =============================================================================

delete from public.notifications;

commit;
