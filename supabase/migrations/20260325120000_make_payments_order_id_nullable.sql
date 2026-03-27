begin;
-- Allow payments.order_id to be NULL for orphan webhook notifications
-- When a webhook arrives before the order is created, we store it with null order_id
-- and reconcile later when the order appears

alter table public.payments
  alter column order_id drop not null;
-- Add index for reconciling orphan payments by midtrans_order_id
create index if not exists payments_midtrans_order_id_idx
  on public.payments (midtrans_order_id);
-- Add index for finding orphan payments (order_id is null)
create index if not exists payments_orphan_idx
  on public.payments (midtrans_order_id)
  where order_id is null;
comment on column public.payments.order_id is
  'Nullable: NULL for orphan webhooks that arrive before order creation; reconciled later via midtrans_order_id';
commit;
