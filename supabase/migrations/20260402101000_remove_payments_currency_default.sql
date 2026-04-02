alter table public.payments
  alter column currency drop default;

comment on column public.payments.currency is
  'Payment currency reported by Midtrans. Required and must be provided explicitly by the webhook/status payload.';
