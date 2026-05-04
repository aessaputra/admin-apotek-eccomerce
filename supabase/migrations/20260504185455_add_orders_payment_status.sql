begin;

do $$
begin
  if not exists (
    select 1
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'orders'
      and a.attname = 'payment_status'
      and not a.attisdropped
  ) then
    alter table public.orders
      add column payment_status public.payment_status
      not null
      default 'pending'::public.payment_status;
  end if;
end
$$;

do $$
begin
  if exists (
    select 1
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'orders'
      and a.attname = 'payment_status'
      and not a.attisdropped
      and a.atttypid <> 'public.payment_status'::regtype
  ) then
    alter table public.orders
      alter column payment_status drop default;

    alter table public.orders
      alter column payment_status type public.payment_status
      using (
        case payment_status
          when 'unpaid' then 'pending'::public.payment_status
          when 'pending' then 'pending'::public.payment_status
          when 'success' then 'settlement'::public.payment_status
          when 'failed' then 'deny'::public.payment_status
          when 'settlement' then 'settlement'::public.payment_status
          when 'deny' then 'deny'::public.payment_status
          when 'expire' then 'expire'::public.payment_status
          when 'cancel' then 'cancel'::public.payment_status
          when 'refund' then 'refund'::public.payment_status
          when 'partial_refund' then 'partial_refund'::public.payment_status
          when 'chargeback' then 'chargeback'::public.payment_status
          when 'partial_chargeback' then 'partial_chargeback'::public.payment_status
          when 'authorize' then 'authorize'::public.payment_status
          else 'pending'::public.payment_status
        end
      );

    alter table public.orders
      alter column payment_status set default 'pending'::public.payment_status;

    alter table public.orders
      alter column payment_status set not null;
  end if;
end
$$;

commit;
