begin;

-- RLS filters rows only; SKU privacy is enforced with column privileges and admin-only views.
-- Admin reads should use these views before the SKU column revokes are applied in production.
create or replace view public.admin_products
with (security_barrier = true)
as
select
  p.id,
  p.category_id,
  c.name as category_name,
  c.slug as category_slug,
  p.name,
  p.slug,
  p.description,
  p.price,
  p.stock,
  p.is_active,
  p.weight,
  p.sku,
  p.created_at,
  p.updated_at,
  coalesce(pi.images, '[]'::jsonb) as images
from public.products p
left join public.categories c on c.id = p.category_id
left join lateral (
  select jsonb_agg(
    jsonb_build_object(
      'id', product_images.id,
      'url', product_images.url,
      'sort_order', product_images.sort_order,
      'created_at', product_images.created_at
    )
    order by product_images.sort_order asc, product_images.created_at asc
  ) as images
  from public.product_images
  where product_images.product_id = p.id
) pi on true
where (select private.is_admin());

create or replace view public.admin_order_items
with (security_barrier = true)
as
select
  oi.id,
  oi.order_id,
  oi.product_id,
  p.name as product_name,
  oi.quantity,
  oi.price_at_purchase,
  oi.product_sku_at_purchase,
  oi.created_at
from public.order_items oi
left join public.products p on p.id = oi.product_id
where (select private.is_admin());

comment on view public.admin_products is
  'Admin-only product read model that exposes SKU through private.is_admin(); base product RLS is row-level only, so SKU privacy relies on column privileges and this view.';

comment on view public.admin_order_items is
  'Admin-only order item read model that exposes historical SKU snapshots through private.is_admin(); base order item RLS is row-level only, so SKU privacy relies on column privileges and this view.';

grant select on table public.admin_products to authenticated;
grant select on table public.admin_order_items to authenticated;
revoke all on table public.admin_products from public, anon;
revoke all on table public.admin_order_items from public, anon;

-- Remove broad table SELECT before re-granting non-SKU columns; otherwise table-level SELECT would still expose SKU.
revoke select on table public.products from anon, authenticated;
grant select (
  id,
  category_id,
  name,
  slug,
  description,
  price,
  stock,
  is_active,
  created_at,
  updated_at,
  weight
) on table public.products to anon, authenticated;
revoke select (sku) on table public.products from anon, authenticated;

revoke select on table public.order_items from anon, authenticated;
grant select (
  id,
  order_id,
  product_id,
  quantity,
  price_at_purchase,
  created_at
) on table public.order_items to authenticated;
revoke select (product_sku_at_purchase) on table public.order_items from anon, authenticated;

create or replace function public.create_checkout_order_aggregate(
  p_user_id uuid,
  p_shipping_address_id uuid,
  p_destination_area_id text,
  p_destination_postal_code integer,
  p_courier_code text,
  p_courier_service text,
  p_shipping_price numeric,
  p_shipping_etd text,
  p_checkout_idempotency_key text
)
returns table (
  order_id uuid,
  total_amount numeric,
  item_count integer,
  checkout_idempotency_key text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_order_id uuid;
  v_cart_id uuid;
  v_new_order_id uuid;
  v_total_amount numeric := 0;
  v_item_count integer := 0;
  v_line record;
  v_cart_snapshot jsonb := '[]'::jsonb;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  if not ((select private.is_admin()) or p_user_id = (select auth.uid())) then
    raise exception 'Checkout user does not match the authenticated caller';
  end if;

  if p_shipping_address_id is null then
    raise exception 'p_shipping_address_id is required';
  end if;

  if p_checkout_idempotency_key is null or btrim(p_checkout_idempotency_key) = '' then
    raise exception 'p_checkout_idempotency_key is required';
  end if;

  if p_courier_code is null or btrim(p_courier_code) = '' then
    raise exception 'p_courier_code is required';
  end if;

  if p_courier_service is null or btrim(p_courier_service) = '' then
    raise exception 'p_courier_service is required';
  end if;

  if p_shipping_price is null or p_shipping_price < 0 then
    raise exception 'p_shipping_price is invalid';
  end if;

  if p_destination_area_id is null and p_destination_postal_code is null then
    raise exception 'p_destination_area_id or p_destination_postal_code is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_checkout_idempotency_key, 0));

  if not exists (
    select 1
    from public.addresses a
    where a.id = p_shipping_address_id
      and a.profile_id = p_user_id
  ) then
    raise exception 'Alamat pengiriman tidak valid untuk pengguna ini';
  end if;

  select p.order_id
    into v_existing_order_id
  from public.payments p
  where p.checkout_idempotency_key = p_checkout_idempotency_key
    and p.user_id = p_user_id
    and p.order_id is not null
  order by p.updated_at desc, p.created_at desc
  limit 1;

  if v_existing_order_id is not null then
    return query
      select
        o.id,
        o.total_amount,
        coalesce((select sum(oi.quantity)::integer from public.order_items oi where oi.order_id = o.id), 0),
        p_checkout_idempotency_key
      from public.orders o
      where o.id = v_existing_order_id;
    return;
  end if;

  select c.id
    into v_cart_id
  from public.carts c
  where c.user_id = p_user_id
  limit 1
  for update;

  if v_cart_id is null then
    raise exception 'Keranjang kosong. Tambahkan produk sebelum melanjutkan pembayaran.';
  end if;

  for v_line in
    select
      ci.product_id,
      ci.quantity,
      p.name as product_name,
      p.price,
      p.stock,
      p.is_active,
      p.sku as product_sku
    from public.cart_items ci
    join public.products p on p.id = ci.product_id
    where ci.cart_id = v_cart_id
    order by ci.created_at asc
    for update of ci, p
  loop
    if v_line.is_active = false then
      raise exception 'Ada produk yang sudah tidak tersedia. Silakan perbarui keranjang.';
    end if;

    if v_line.quantity > v_line.stock then
      raise exception 'Stok produk % tidak mencukupi.', v_line.product_name;
    end if;

    v_total_amount := v_total_amount + (v_line.price * v_line.quantity);
    v_item_count := v_item_count + v_line.quantity;
    v_cart_snapshot := v_cart_snapshot || jsonb_build_array(
      jsonb_build_object(
        'product_id', v_line.product_id,
        'quantity', v_line.quantity,
        'price_at_purchase', v_line.price,
        'product_sku_at_purchase', v_line.product_sku
      )
    );
  end loop;

  if jsonb_array_length(v_cart_snapshot) = 0 then
    raise exception 'Keranjang kosong. Tambahkan produk sebelum melanjutkan pembayaran.';
  end if;

  insert into public.orders (
    user_id,
    shipping_address_id,
    total_amount,
    status,
    shipping_cost
  )
  values (
    p_user_id,
    p_shipping_address_id,
    v_total_amount,
    'pending',
    p_shipping_price
  )
  returning id into v_new_order_id;

  insert into public.order_items (
    order_id,
    product_id,
    quantity,
    price_at_purchase,
    product_sku_at_purchase
  )
  select
    v_new_order_id,
    snapshot.product_id,
    snapshot.quantity,
    snapshot.price_at_purchase,
    snapshot.product_sku_at_purchase
  from jsonb_to_recordset(v_cart_snapshot) as snapshot(
    product_id uuid,
    quantity integer,
    price_at_purchase numeric,
    product_sku_at_purchase text
  );

  delete from public.cart_items
  where cart_id = v_cart_id;

  insert into public.shipments (
    order_id,
    provider,
    status,
    courier_code,
    courier_service,
    shipping_etd,
    destination_area_id,
    destination_postal_code
  )
  values (
    v_new_order_id,
    'biteship',
    'pending',
    p_courier_code,
    p_courier_service,
    p_shipping_etd,
    p_destination_area_id,
    p_destination_postal_code
  );

  insert into public.payments (
    order_id,
    user_id,
    checkout_idempotency_key,
    status,
    currency,
    gross_amount,
    expiry_time
  )
  values (
    v_new_order_id,
    p_user_id,
    p_checkout_idempotency_key,
    'pending',
    'IDR',
    v_total_amount + p_shipping_price,
    timezone('utc'::text, now()) + interval '24 hours'
  );

  return query
    select
      v_new_order_id,
      v_total_amount,
      v_item_count,
      p_checkout_idempotency_key;
end;
$$;

comment on function public.create_checkout_order_aggregate(
  uuid,
  uuid,
  text,
  integer,
  text,
  text,
  numeric,
  text,
  text
) is
  'Transactional checkout aggregate. SECURITY DEFINER is required to snapshot products.sku after customer SKU column SELECT is revoked; caller is still constrained to auth.uid() unless private.is_admin().';

commit;
