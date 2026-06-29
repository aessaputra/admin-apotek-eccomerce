begin;

create or replace function public.enqueue_side_effect_task_on_settlement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.order_id is not null
     and new.status = 'settlement'::public.payment_status
     and old.status is distinct from new.status then
    insert into public.webhook_side_effect_tasks (order_id, needs_stock, updated_at)
    values (new.order_id, true, timezone('utc'::text, now()))
    on conflict (order_id)
    do update
      set needs_stock = true,
          updated_at = timezone('utc'::text, now());
  end if;

  return new;
end;
$$;

commit;