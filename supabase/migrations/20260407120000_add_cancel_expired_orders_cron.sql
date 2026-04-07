create or replace function cancel_expired_orders()
returns jsonb
language plpgsql
as $$
declare
    v_cancelled_count int := 0;
    v_batch_size int := 1000;
begin
    with expired_orders as (
        select o.id
        from orders o
        where o.status = 'pending'
          and o.payment_status = 'pending'
          and o.expired_at < now()
        for update skip locked
        limit v_batch_size
    )
    update orders
    set 
        status = 'cancelled',
        payment_status = 'cancelled',
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
$$;

select cron.unschedule('cancel-expired-orders-every-5min');

select cron.schedule(
    'cancel-expired-orders-every-5min',
    '*/5 * * * *',
    $$
    select cancel_expired_orders();
    $$
);

create index if not exists idx_orders_expired_pending 
    on orders(expired_at) 
    where status = 'pending' and payment_status = 'pending';

comment on function cancel_expired_orders() is 
'Atomically cancels orders that have passed their expired_at timestamp';
