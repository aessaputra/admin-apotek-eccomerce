create index concurrently if not exists orders_payment_status_created_idx
  on public.orders (payment_status, created_at desc);
