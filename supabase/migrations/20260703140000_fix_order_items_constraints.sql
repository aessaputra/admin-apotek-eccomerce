-- Fix order_items constraints to align with Supabase Postgres best practices.
-- 1. Enforce positive quantity (matches cart_items.quantity semantics and business rule).
-- 2. Clean orphaned source_cart_item_id values and add the missing foreign key so
--    cart item deletion sets the audit reference to NULL instead of leaving invalid UUIDs.

-- Guard: only add the positive-quantity check if it does not already exist.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.order_items'::regclass
      and conname = 'order_items_quantity_positive_chk'
  ) then
    alter table public.order_items
      add constraint order_items_quantity_positive_chk
      check (quantity > 0);
  end if;
end
$$;

-- Remove cart-item references that no longer exist before adding the FK.
-- This mirrors the ON DELETE SET NULL behavior we want going forward.
update public.order_items
set source_cart_item_id = null
where source_cart_item_id is not null
  and not exists (
    select 1 from public.cart_items ci
    where ci.id = order_items.source_cart_item_id
  );

-- Guard: only add the FK if it does not already exist.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.order_items'::regclass
      and conname = 'order_items_source_cart_item_id_fkey'
  ) then
    alter table public.order_items
      add constraint order_items_source_cart_item_id_fkey
      foreign key (source_cart_item_id)
      references public.cart_items(id)
      on delete set null;
  end if;
end
$$;

comment on constraint order_items_quantity_positive_chk on public.order_items is
  'Ensures every order line has a positive quantity.';
comment on constraint order_items_source_cart_item_id_fkey on public.order_items is
  'Optional audit link to the originating cart item; cleared automatically when the cart item is deleted.';
