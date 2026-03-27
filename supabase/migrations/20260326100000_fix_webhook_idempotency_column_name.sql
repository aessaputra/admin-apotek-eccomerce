-- Fix: Rename webhook_idempotency.external_id back to event_key
-- The function apply_midtrans_webhook_transition expects event_key column
-- but the live database had external_id column name (likely manual change).

begin;
-- Rename column back to match function expectations
alter table public.webhook_idempotency
  rename column external_id to event_key;
-- Add processed_at column if it doesn't exist (for idempotency tracking)
alter table public.webhook_idempotency
  add column if not exists processed_at timestamptz;
-- Recreate the unique constraint on (provider, event_key)
drop index if exists webhook_idempotency_provider_created_idx;
create unique index if not exists webhook_idempotency_provider_event_key_uidx
  on public.webhook_idempotency (provider, event_key);
create index if not exists webhook_idempotency_provider_created_idx
  on public.webhook_idempotency (provider, created_at desc);
commit;
