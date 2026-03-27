begin;
create or replace function public.enqueue_side_effect_task_on_settlement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.payment_status = 'settlement'::public.payment_status
     and old.payment_status is distinct from new.payment_status then
    insert into public.webhook_side_effect_tasks (order_id, needs_stock, needs_biteship, updated_at)
    values (new.id, true, true, timezone('utc'::text, now()))
    on conflict (order_id)
    do update
      set needs_stock = true,
          needs_biteship = true,
          updated_at = timezone('utc'::text, now());
  end if;

  return new;
end;
$$;
drop trigger if exists trg_orders_enqueue_side_effect_task_on_settlement on public.orders;
create trigger trg_orders_enqueue_side_effect_task_on_settlement
after update on public.orders
for each row
execute function public.enqueue_side_effect_task_on_settlement();
commit;
