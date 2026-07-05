begin;

-- Idempotent stock restoration RPC. Reverses deductions recorded in
-- order_item_stock_deductions. Uses DELETE ... RETURNING to atomically
-- remove the deduction record and capture the quantity, mirroring the
-- INSERT ... ON CONFLICT DO NOTHING pattern in the deduction RPC.
create or replace function public.reverse_order_item_stock_deduction(
  p_order_id uuid,
  p_product_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quantity integer;
begin
  -- Atomically remove the deduction record and capture the quantity.
  -- If no row exists (already reversed or never deducted), this is a no-op.
  delete from public.order_item_stock_deductions
  where order_id = p_order_id
    and product_id = p_product_id
  returning quantity into v_quantity;

  if v_quantity is null then
    return;
  end if;

  update public.products
  set
    stock = stock + v_quantity,
    updated_at = timezone('utc'::text, now())
  where id = p_product_id;
end;
$$;

-- Restrict to service_role only, matching the deduction RPC privilege pattern
revoke all on function public.reverse_order_item_stock_deduction(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.reverse_order_item_stock_deduction(uuid, uuid)
  to service_role;

commit;
