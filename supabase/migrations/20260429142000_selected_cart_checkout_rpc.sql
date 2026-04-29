begin;

alter table public.order_items
  add column if not exists source_cart_item_id uuid null;

create index if not exists order_items_source_cart_item_id_idx
  on public.order_items (source_cart_item_id)
  where source_cart_item_id is not null;

drop function if exists public.create_checkout_order_aggregate(
  uuid,
  uuid,
  text,
  integer,
  text,
  text,
  numeric,
  text,
  text
);

-- The checkout Edge Function validates the caller JWT, then invokes this RPC
-- with the service-role client so it can create the selected order/payment/
-- shipment aggregate transactionally. Keep direct client access revoked and
-- grant only the server-side service_role.
create or replace function public.create_checkout_order_aggregate(
  p_user_id uuid,
  p_shipping_address_id uuid,
  p_destination_area_id text,
  p_destination_postal_code integer,
  p_courier_code text,
  p_courier_service text,
  p_shipping_price numeric,
  p_shipping_etd text,
  p_selected_cart_item_ids uuid[],
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
set search_path = ''
as $$
declare
  v_existing_order_id uuid;
  v_cart_id uuid;
  v_new_order_id uuid;
  v_selected_count integer := 0;
  v_distinct_selected_count integer := 0;
  v_selected_row_count integer := 0;
  v_total_amount numeric := 0;
  v_item_count integer := 0;
  v_line record;
  v_cart_snapshot jsonb := '[]'::jsonb;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  if not (
    (select auth.role()) = 'service_role'
    or (select private.is_admin())
    or p_user_id = (select auth.uid())
  ) then
    raise exception 'Checkout user does not match the authenticated caller';
  end if;

  if p_shipping_address_id is null then
    raise exception 'p_shipping_address_id is required';
  end if;

  if p_selected_cart_item_ids is null
    or pg_catalog.coalesce(pg_catalog.array_length(p_selected_cart_item_ids, 1), 0) = 0
    or pg_catalog.array_position(p_selected_cart_item_ids, null) is not null then
    raise exception 'Pilih minimal satu produk sebelum melanjutkan pembayaran.';
  end if;

  v_selected_count := pg_catalog.array_length(p_selected_cart_item_ids, 1);

  select pg_catalog.count(distinct selected.selected_id)::integer
    into v_distinct_selected_count
  from pg_catalog.unnest(p_selected_cart_item_ids) as selected(selected_id);

  if v_selected_count <> v_distinct_selected_count then
    raise exception 'Produk terpilih tidak valid. Silakan perbarui pilihan checkout.';
  end if;

  if p_checkout_idempotency_key is null or pg_catalog.btrim(p_checkout_idempotency_key) = '' then
    raise exception 'p_checkout_idempotency_key is required';
  end if;

  if p_courier_code is null or pg_catalog.btrim(p_courier_code) = '' then
    raise exception 'p_courier_code is required';
  end if;

  if p_courier_service is null or pg_catalog.btrim(p_courier_service) = '' then
    raise exception 'p_courier_service is required';
  end if;

  if p_shipping_price is null or p_shipping_price < 0 then
    raise exception 'p_shipping_price is invalid';
  end if;

  if p_destination_area_id is null and p_destination_postal_code is null then
    raise exception 'p_destination_area_id or p_destination_postal_code is required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_checkout_idempotency_key, 0));

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
        pg_catalog.coalesce((select pg_catalog.sum(oi.quantity)::integer from public.order_items oi where oi.order_id = o.id), 0),
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

  select pg_catalog.count(*)::integer
    into v_selected_row_count
  from public.cart_items ci
  where ci.cart_id = v_cart_id
    and ci.id = any(p_selected_cart_item_ids);

  if v_selected_row_count <> v_selected_count then
    raise exception 'Produk terpilih tidak valid. Silakan perbarui pilihan checkout.';
  end if;

  for v_line in
    select
      ci.id as source_cart_item_id,
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
      and ci.id = any(p_selected_cart_item_ids)
    order by ci.id asc
    for update of ci, p
  loop
    if v_line.is_active = false then
      raise exception 'Ada produk yang sudah tidak tersedia. Silakan perbarui pilihan checkout.';
    end if;

    if v_line.quantity > v_line.stock then
      raise exception 'Stok produk % tidak mencukupi.', v_line.product_name;
    end if;

    v_total_amount := v_total_amount + (v_line.price * v_line.quantity);
    v_item_count := v_item_count + v_line.quantity;
    v_cart_snapshot := v_cart_snapshot || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'source_cart_item_id', v_line.source_cart_item_id,
        'product_id', v_line.product_id,
        'quantity', v_line.quantity,
        'price_at_purchase', v_line.price,
        'product_sku_at_purchase', v_line.product_sku
      )
    );
  end loop;

  if pg_catalog.jsonb_array_length(v_cart_snapshot) = 0 then
    raise exception 'Pilih minimal satu produk sebelum melanjutkan pembayaran.';
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
    product_sku_at_purchase,
    source_cart_item_id
  )
  select
    v_new_order_id,
    snapshot.product_id,
    snapshot.quantity,
    snapshot.price_at_purchase,
    snapshot.product_sku_at_purchase,
    snapshot.source_cart_item_id
  from pg_catalog.jsonb_to_recordset(v_cart_snapshot) as snapshot(
    source_cart_item_id uuid,
    product_id uuid,
    quantity integer,
    price_at_purchase numeric,
    product_sku_at_purchase text
  );

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
    pg_catalog.timezone('utc'::text, pg_catalog.now()) + interval '24 hours'
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
  uuid[],
  text
) is
  'Transactional selected-cart checkout aggregate. SECURITY DEFINER is required to snapshot products.sku after customer SKU column SELECT is revoked; execute is restricted to service_role and direct callers remain constrained by auth.uid() or private.is_admin().';

revoke all on function public.create_checkout_order_aggregate(
  uuid,
  uuid,
  text,
  integer,
  text,
  text,
  numeric,
  text,
  uuid[],
  text
) from public, anon, authenticated;

grant execute on function public.create_checkout_order_aggregate(
  uuid,
  uuid,
  text,
  integer,
  text,
  text,
  numeric,
  text,
  uuid[],
  text
) to service_role;

commit;
