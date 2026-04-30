begin;

-- These SECURITY DEFINER functions are internal server-side entry points.
-- Direct browser roles must not execute them via PostgREST RPC, while Edge
-- Functions continue to call them with the service-role client. Existing
-- triggers run as triggers and pg_cron jobs run as postgres, so revoking
-- direct anon/authenticated EXECUTE does not disable those paths.
revoke all on function public.apply_midtrans_webhook_transition(
  text,
  text,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  timestamp with time zone
) from public, anon, authenticated;

grant execute on function public.apply_midtrans_webhook_transition(
  text,
  text,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  timestamp with time zone
) to service_role;

revoke all on function public.apply_order_item_stock_deduction(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.apply_order_item_stock_deduction(uuid, uuid, integer) to service_role;

revoke all on function public.enqueue_side_effect_task_on_settlement() from public, anon, authenticated;
grant execute on function public.enqueue_side_effect_task_on_settlement() to service_role;

revoke all on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to service_role;

revoke all on function public.reconcile_midtrans_orphan_notifications(integer) from public, anon, authenticated;
grant execute on function public.reconcile_midtrans_orphan_notifications(integer) to service_role;

revoke all on function public.reduce_product_stock(uuid, integer) from public, anon, authenticated;
grant execute on function public.reduce_product_stock(uuid, integer) to service_role;

revoke all on function public.trigger_cleanup_orphan_storage_dry_run(integer, integer) from public, anon, authenticated;
grant execute on function public.trigger_cleanup_orphan_storage_dry_run(integer, integer) to service_role;

revoke all on function public.trigger_process_webhook_side_effects(integer) from public, anon, authenticated;
grant execute on function public.trigger_process_webhook_side_effects(integer) to service_role;

revoke all on function public.trigger_reconcile_pending_midtrans_payments(integer) from public, anon, authenticated;
grant execute on function public.trigger_reconcile_pending_midtrans_payments(integer) to service_role;

commit;
