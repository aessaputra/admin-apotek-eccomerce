begin;

drop index if exists public.cart_items_product_id_idx;
drop index if exists public.idx_webhook_idempotency_lookup;
drop index if exists public.webhook_idempotency_provider_event_key_uidx;

commit;
