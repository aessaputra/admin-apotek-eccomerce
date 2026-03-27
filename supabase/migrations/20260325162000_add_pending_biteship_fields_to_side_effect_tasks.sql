begin;
alter table public.webhook_side_effect_tasks
  add column if not exists pending_biteship_order_id text,
  add column if not exists pending_waybill_number text;
commit;
