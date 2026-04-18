begin;

create table if not exists public.snap_token_generation_locks (
  order_id uuid primary key references public.orders(id) on delete cascade,
  checkout_idempotency_key text,
  owner text not null,
  acquired_at timestamptz not null default timezone('utc'::text, now()),
  expires_at timestamptz not null
);

create unique index if not exists snap_token_generation_locks_checkout_key_uidx
  on public.snap_token_generation_locks (checkout_idempotency_key)
  where checkout_idempotency_key is not null;

drop function if exists public.acquire_snap_token_generation_lock(uuid, text, text, integer);

create or replace function public.acquire_snap_token_generation_lock(
  p_order_id uuid,
  p_checkout_idempotency_key text,
  p_owner text,
  p_ttl_seconds integer default 60
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_now timestamptz := timezone('utc'::text, now());
begin
  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;

  if p_owner is null or btrim(p_owner) = '' then
    raise exception 'p_owner is required';
  end if;

  insert into public.snap_token_generation_locks (
    order_id,
    checkout_idempotency_key,
    owner,
    acquired_at,
    expires_at
  )
  values (
    p_order_id,
    nullif(btrim(p_checkout_idempotency_key), ''),
    p_owner,
    v_now,
    v_now + make_interval(secs => greatest(p_ttl_seconds, 1))
  )
  on conflict (order_id) do update
    set checkout_idempotency_key = excluded.checkout_idempotency_key,
        owner = excluded.owner,
        acquired_at = excluded.acquired_at,
        expires_at = excluded.expires_at
  where public.snap_token_generation_locks.expires_at <= v_now;

  return exists (
    select 1
    from public.snap_token_generation_locks
    where order_id = p_order_id
      and owner = p_owner
      and expires_at > v_now
  );
end;
$$;

drop function if exists public.release_snap_token_generation_lock(uuid, text);

create or replace function public.release_snap_token_generation_lock(
  p_order_id uuid,
  p_owner text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_order_id is null or p_owner is null or btrim(p_owner) = '' then
    return;
  end if;

  delete from public.snap_token_generation_locks
  where order_id = p_order_id
    and owner = p_owner;
end;
$$;

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
security invoker
set search_path = public
as $$
declare
  v_existing_order_id uuid;
  v_cart_id uuid;
  v_new_order_id uuid;
  v_total_amount numeric := 0;
  v_item_count integer := 0;
  v_line record;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
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

  select c.id
    into v_cart_id
  from public.carts c
  where c.user_id = p_user_id
  limit 1;

  select p.order_id
    into v_existing_order_id
  from public.payments p
  where p.checkout_idempotency_key = p_checkout_idempotency_key
    and p.user_id = p_user_id
    and p.order_id is not null
  order by p.updated_at desc, p.created_at desc
  limit 1;

  if v_existing_order_id is not null then
    if v_cart_id is not null then
      delete from public.cart_items
      where cart_id = v_cart_id;
    end if;

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

  if v_cart_id is null then
    raise exception 'Keranjang kosong. Tambahkan produk sebelum melanjutkan pembayaran.';
  end if;

  if not exists (
    select 1
    from public.cart_items ci
    where ci.cart_id = v_cart_id
  ) then
    raise exception 'Keranjang kosong. Tambahkan produk sebelum melanjutkan pembayaran.';
  end if;

  for v_line in
    select
      ci.product_id,
      ci.quantity,
      p.name as product_name,
      p.price,
      p.stock,
      p.is_active
    from public.cart_items ci
    join public.products p on p.id = ci.product_id
    where ci.cart_id = v_cart_id
    order by ci.created_at asc
    for update of p
  loop
    if v_line.is_active = false then
      raise exception 'Ada produk yang sudah tidak tersedia. Silakan perbarui keranjang.';
    end if;

    if v_line.quantity > v_line.stock then
      raise exception 'Stok produk % tidak mencukupi.', v_line.product_name;
    end if;

    v_total_amount := v_total_amount + (v_line.price * v_line.quantity);
    v_item_count := v_item_count + v_line.quantity;
  end loop;

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
    price_at_purchase
  )
  select
    v_new_order_id,
    ci.product_id,
    ci.quantity,
    p.price
  from public.cart_items ci
  join public.products p on p.id = ci.product_id
  where ci.cart_id = v_cart_id;

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

revoke all on table public.snap_token_generation_locks from public, anon, authenticated;

revoke all on function public.acquire_snap_token_generation_lock(uuid, text, text, integer)
  from public, anon, authenticated;

revoke all on function public.release_snap_token_generation_lock(uuid, text)
  from public, anon, authenticated;

commit;
