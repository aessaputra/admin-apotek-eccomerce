begin;

create or replace function public.cancel_expired_orders()
returns jsonb
language plpgsql
set search_path = public
as $function$
declare
    v_cancelled_count int := 0;
    v_batch_size int := 1000;
begin
    with expired_orders as (
        select o.id
        from public.orders as o
        where o.status = 'pending'
          and o.payment_status = 'pending'
          and o.expired_at < now()
        for update skip locked
        limit v_batch_size
    )
    update public.orders
    set
        status = 'cancelled',
        payment_status = 'expire',
        updated_at = now()
    where id in (select id from expired_orders);

    get diagnostics v_cancelled_count = row_count;

    return jsonb_build_object(
        'cancelled_count', v_cancelled_count,
        'executed_at', now()
    );
exception when others then
    return jsonb_build_object(
        'error', sqlerrm,
        'executed_at', now()
    );
end;
$function$;

do $$
begin
  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'cancel-expired-orders-every-5min';
exception
  when undefined_table then
    null;
end
$$;

select cron.schedule(
  'cancel-expired-orders-every-5min',
  '*/5 * * * *',
  $$
  select public.cancel_expired_orders();
  $$
);

comment on function public.cancel_expired_orders() is
  'Atomically cancels orders that have passed their expired_at timestamp.';

commit;
