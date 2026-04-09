begin;

update public.orders
set
  status = 'processing',
  updated_at = timezone('utc'::text, now())
where status = 'paid';

commit;
