begin;

drop index if exists public.webhook_side_effect_tasks_cart_cleanup_idx;
drop index if exists public.shipments_waybill_overridden_by_idx;
drop index if exists public.webhook_idempotency_provider_created_idx;
drop index if exists public.idx_order_item_stock_deductions_product_id;
drop index if exists public.storage_cleanup_runs_finished_at_idx;
drop index if exists public.shipments_courier_status_idx;

commit;
