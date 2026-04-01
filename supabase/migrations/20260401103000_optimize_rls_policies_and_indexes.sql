begin;

create schema if not exists private;

create or replace function private.is_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  user_role text;
  request_user_id uuid;
begin
  select auth.jwt() ->> 'user_role' into user_role;
  if user_role = 'admin' then
    return true;
  end if;

  select auth.uid() into request_user_id;
  if request_user_id is null then
    return false;
  end if;

  select p.role
  into user_role
  from public.profiles as p
  where p.id = request_user_id;

  return user_role = 'admin';
end;
$$;

drop policy if exists "Users can manage their own addresses" on public.addresses;
create policy "Users can manage their own addresses"
  on public.addresses
  for all
  to public
  using ((select auth.uid()) = profile_id)
  with check ((select auth.uid()) = profile_id);

drop policy if exists "Users can manage their own cart" on public.carts;
create policy "Users can manage their own cart"
  on public.carts
  for all
  to public
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can manage their own cart items" on public.cart_items;
create policy "Users can manage their own cart items"
  on public.cart_items
  for all
  to public
  using (
    exists (
      select 1
      from public.carts
      where carts.id = cart_items.cart_id
        and carts.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.carts
      where carts.id = cart_items.cart_id
        and carts.user_id = (select auth.uid())
    )
  );
drop policy if exists "Users can select their own cart items" on public.cart_items;

drop policy if exists "Admins can view all profiles" on public.profiles;
drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile"
  on public.profiles
  for select
  to authenticated
  using (((select auth.uid()) = id) or (select private.is_admin()));

drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile"
  on public.profiles
  for insert
  to authenticated
  with check ((select auth.uid()) = id);

drop policy if exists "Users can update own profile data" on public.profiles;
create policy "Users can update own profile data"
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists "Admins can manage categories" on public.categories;
drop policy if exists "Public can read categories" on public.categories;
create policy "Public can read categories"
  on public.categories
  for select
  to anon
  using (true);
create policy "Authenticated users can read categories"
  on public.categories
  for select
  to authenticated
  using (true);
create policy "Admins can insert categories"
  on public.categories
  for insert
  to authenticated
  with check ((select private.is_admin()));
create policy "Admins can update categories"
  on public.categories
  for update
  to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));
create policy "Admins can delete categories"
  on public.categories
  for delete
  to authenticated
  using ((select private.is_admin()));

drop policy if exists "Admins can manage products" on public.products;
drop policy if exists "Public can read products" on public.products;
create policy "Public can read products"
  on public.products
  for select
  to anon
  using (is_active = true);
create policy "Authenticated users can read products"
  on public.products
  for select
  to authenticated
  using (is_active = true or (select private.is_admin()));
create policy "Admins can insert products"
  on public.products
  for insert
  to authenticated
  with check ((select private.is_admin()));
create policy "Admins can update products"
  on public.products
  for update
  to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));
create policy "Admins can delete products"
  on public.products
  for delete
  to authenticated
  using ((select private.is_admin()));

drop policy if exists "Admins can manage product images" on public.product_images;
drop policy if exists "Public can read product images" on public.product_images;
create policy "Public can read product images"
  on public.product_images
  for select
  to anon
  using (true);
create policy "Authenticated users can read product images"
  on public.product_images
  for select
  to authenticated
  using (true);
create policy "Admins can insert product images"
  on public.product_images
  for insert
  to authenticated
  with check ((select private.is_admin()));
create policy "Admins can update product images"
  on public.product_images
  for update
  to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));
create policy "Admins can delete product images"
  on public.product_images
  for delete
  to authenticated
  using ((select private.is_admin()));

drop policy if exists "Admins can manage all orders" on public.orders;
drop policy if exists "Users can view their own orders" on public.orders;
drop policy if exists "Users can insert their own orders" on public.orders;
create policy "Users can view their own orders"
  on public.orders
  for select
  to authenticated
  using (((select auth.uid()) = user_id) or (select private.is_admin()));
create policy "Users can insert their own orders"
  on public.orders
  for insert
  to authenticated
  with check (((select auth.uid()) = user_id) or (select private.is_admin()));
create policy "Admins can update all orders"
  on public.orders
  for update
  to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));
create policy "Admins can delete all orders"
  on public.orders
  for delete
  to authenticated
  using ((select private.is_admin()));

drop policy if exists "Admins can manage all order items" on public.order_items;
drop policy if exists "Users can insert order items for own orders" on public.order_items;
drop policy if exists "Users can view their own order items" on public.order_items;
create policy "Users can view their own order items"
  on public.order_items
  for select
  to authenticated
  using (
    (select private.is_admin())
    or exists (
      select 1
      from public.orders
      where orders.id = order_items.order_id
        and orders.user_id = (select auth.uid())
    )
  );
create policy "Users can insert order items for own orders"
  on public.order_items
  for insert
  to authenticated
  with check (
    (select private.is_admin())
    or exists (
      select 1
      from public.orders
      where orders.id = order_items.order_id
        and orders.user_id = (select auth.uid())
    )
  );
create policy "Admins can update all order items"
  on public.order_items
  for update
  to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));
create policy "Admins can delete all order items"
  on public.order_items
  for delete
  to authenticated
  using ((select private.is_admin()));

drop policy if exists "Admins can manage all payments" on public.payments;
drop policy if exists "Users can view own payments" on public.payments;
create policy "Users can view own payments"
  on public.payments
  for select
  to authenticated
  using (
    (select private.is_admin())
    or (select auth.uid()) = user_id
    or exists (
      select 1
      from public.orders as o
      where o.id = payments.order_id
        and o.user_id = (select auth.uid())
    )
  );
create policy "Admins can insert all payments"
  on public.payments
  for insert
  to authenticated
  with check ((select private.is_admin()));
create policy "Admins can update all payments"
  on public.payments
  for update
  to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));
create policy "Admins can delete all payments"
  on public.payments
  for delete
  to authenticated
  using ((select private.is_admin()));

drop policy if exists "Allow authenticated users to update settings" on public.settings;
create policy "Allow authenticated users to update settings"
  on public.settings
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = (select auth.uid())
        and profiles.role = 'admin'
    )
  )
  with check (
    exists (
      select 1
      from public.profiles
      where profiles.id = (select auth.uid())
        and profiles.role = 'admin'
    )
  );

create index if not exists idx_order_item_stock_deductions_product_id
  on public.order_item_stock_deductions (product_id);

drop index if exists public.cart_items_cart_id_idx;
drop index if exists public.carts_user_id_idx;
drop index if exists public.idx_orders_payment_status_created_at;

commit;
