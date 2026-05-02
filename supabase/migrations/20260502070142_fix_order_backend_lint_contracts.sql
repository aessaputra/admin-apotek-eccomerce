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
    join public.payments p on p.order_id = o.id
    where o.status = 'pending'
      and p.status = 'pending'
      and p.expiry_time < now()
    for update of o, p skip locked
    limit v_batch_size
  ),
  updated_orders as (
    update public.orders o
    set
      status = 'cancelled',
      updated_at = now()
    from expired_orders e
    where o.id = e.id
    returning o.id
  ),
  updated_payments as (
    update public.payments p
    set
      status = 'expire'::public.payment_status,
      updated_at = now()
    where p.order_id in (select id from updated_orders)
      and p.status = 'pending'::public.payment_status
    returning p.order_id
  )
  select count(*)::int
    into v_cancelled_count
  from updated_orders;

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
    or coalesce(pg_catalog.array_length(p_selected_cart_item_ids, 1), 0::integer) = 0
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
        coalesce(
          (
            select pg_catalog.sum(oi.quantity)::integer
            from public.order_items oi
            where oi.order_id = o.id
          ),
          0::integer
        ),
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

create or replace function public.apply_midtrans_webhook_transition(
  p_provider text,
  p_event_key text,
  p_order_id uuid,
  p_next_payment_status text,
  p_next_order_status text,
  p_midtrans_transaction_id text default null,
  p_payment_type text default null,
  p_biteship_order_id text default null,
  p_waybill_number text default null,
  p_paid_at timestamptz default null
)
returns table (
  applied boolean,
  payment_status text,
  order_status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted_id uuid;
  v_payment_rows_updated integer := 0;
begin
  -- Legacy signature placeholders retained for deployed RPC compatibility.
  perform p_biteship_order_id, p_waybill_number;

  insert into public.webhook_idempotency (provider, event_key)
  values (p_provider, p_event_key)
  on conflict (provider, event_key) do nothing
  returning id into v_inserted_id;

  if v_inserted_id is null then
    return query
      select
        false,
        coalesce(p.status::text, 'pending'),
        o.status::text
      from public.orders o
      left join lateral (
        select payments.status
        from public.payments
        where payments.order_id = o.id
        order by payments.updated_at desc, payments.created_at desc
        limit 1
      ) p on true
      where o.id = p_order_id;
    return;
  end if;

  update public.payments p
  set
    status = p_next_payment_status::public.payment_status,
    paid_at = case
      when p_next_payment_status = 'settlement' then coalesce(p.paid_at, p_paid_at, timezone('utc'::text, now()))
      else p.paid_at
    end,
    midtrans_transaction_id = coalesce(p_midtrans_transaction_id, p.midtrans_transaction_id),
    payment_type = coalesce(p_payment_type::public.payment_type, p.payment_type),
    updated_at = timezone('utc'::text, now())
  where p.order_id = p_order_id
    and (
      (p_next_payment_status = 'pending' and p.status = 'pending')
      or (p_next_payment_status = 'authorize' and p.status = 'pending')
      or (p_next_payment_status = 'settlement' and p.status in ('pending', 'authorize', 'deny'))
      or (p_next_payment_status in ('deny', 'cancel', 'expire') and p.status in ('pending', 'authorize'))
      or (p_next_payment_status in ('refund', 'partial_refund', 'chargeback', 'partial_chargeback') and p.status = 'settlement')
    )
  returning p.status::text into payment_status;

  get diagnostics v_payment_rows_updated = row_count;

  if v_payment_rows_updated = 0 then
    return query
      select
        false,
        coalesce(p.status::text, 'pending'),
        o.status::text
      from public.orders o
      left join lateral (
        select payments.status
        from public.payments
        where payments.order_id = o.id
        order by payments.updated_at desc, payments.created_at desc
        limit 1
      ) p on true
      where o.id = p_order_id;
    return;
  end if;

  update public.orders o
  set
    status = p_next_order_status,
    updated_at = timezone('utc'::text, now())
  where o.id = p_order_id
  returning true, o.status::text into applied, order_status;

  if applied is distinct from true then
    return query
      select
        false,
        coalesce(p.status::text, 'pending'),
        o.status::text
      from public.orders o
      left join lateral (
        select payments.status
        from public.payments
        where payments.order_id = o.id
        order by payments.updated_at desc, payments.created_at desc
        limit 1
      ) p on true
      where o.id = p_order_id;
    return;
  end if;

  return next;
end;
$$;

comment on function public.apply_midtrans_webhook_transition(
  text,
  text,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  timestamp with time zone
) is
  'Applies idempotent Midtrans payment/order transitions. p_biteship_order_id and p_waybill_number are legacy signature placeholders retained for deployed RPC compatibility.';

revoke all on function public.apply_midtrans_webhook_transition(
  text,
  text,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  timestamp with time zone
) from public, anon, authenticated;

grant execute on function public.apply_midtrans_webhook_transition(
  text,
  text,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  timestamp with time zone
) to service_role;

create or replace view public.order_read_model
with (security_invoker = true)
as
select
  o.id,
  o.user_id,
  o.total_amount,
  o.status,
  o.shipping_cost,
  o.shipping_address_id,
  o.created_at,
  o.updated_at,
  coalesce(p.status, 'pending'::public.payment_status) as payment_status,
  p.payment_type,
  p.checkout_idempotency_key,
  p.midtrans_order_id,
  p.midtrans_transaction_id,
  p.gross_amount,
  p.paid_at,
  p.expiry_time as expired_at,
  p.snap_token,
  p.redirect_url as snap_redirect_url,
  p.snap_token_created_at,
  s.courier_code,
  s.courier_service,
  s.shipping_etd,
  s.origin_area_id,
  s.destination_area_id,
  s.destination_postal_code,
  s.biteship_order_id,
  s.biteship_tracking_id,
  s.waybill_number,
  s.waybill_source,
  s.waybill_overridden_by,
  s.waybill_override_reason,
  s.waybill_overridden_at,
  o.delivered_at,
  o.complaint_window_expires_at,
  o.customer_completed_at,
  case
    when o.status <> 'delivered' then 'not_applicable'::text
    when o.customer_completed_at is not null then 'completed'::text
    when o.complaint_window_expires_at is not null
      and o.complaint_window_expires_at <= timezone('utc'::text, now()) then 'completed'::text
    else 'awaiting_customer'::text
  end as customer_completion_stage,
  case
    when o.status = 'delivered' and o.customer_completed_at is not null then o.customer_completed_at
    when o.status = 'delivered'
      and o.complaint_window_expires_at is not null
      and o.complaint_window_expires_at <= timezone('utc'::text, now()) then o.complaint_window_expires_at
    else null::timestamptz
  end as completed_at,
  s.status as shipment_status,
  s.latest_biteship_status,
  case
    when o.status = 'pending'
      and coalesce(p.status, 'pending'::public.payment_status) = 'pending'::public.payment_status
      and (p.expiry_time is null or p.expiry_time > timezone('utc'::text, now())) then 'unpaid'::text
    when o.status in ('processing', 'awaiting_shipment') then 'packing'::text
    when o.status in ('shipped', 'in_transit') then 'shipped'::text
    when o.status = 'delivered'
      and (
        case
          when o.customer_completed_at is not null then 'completed'::text
          when o.complaint_window_expires_at is not null
            and o.complaint_window_expires_at <= timezone('utc'::text, now()) then 'completed'::text
          else 'awaiting_customer'::text
        end
      ) = 'awaiting_customer' then 'shipped'::text
    when o.status = 'delivered'
      and (
        case
          when o.customer_completed_at is not null then 'completed'::text
          when o.complaint_window_expires_at is not null
            and o.complaint_window_expires_at <= timezone('utc'::text, now()) then 'completed'::text
          else 'awaiting_customer'::text
        end
      ) = 'completed' then 'completed'::text
    when o.status = 'cancelled' then 'cancelled'::text
    else null::text
  end as customer_order_bucket,
  o.customer_completed_by,
  o.customer_completion_source
from public.orders o
left join lateral (
  select
    payments.status,
    payments.payment_type,
    payments.checkout_idempotency_key,
    payments.midtrans_order_id,
    payments.midtrans_transaction_id,
    payments.gross_amount,
    payments.paid_at,
    payments.expiry_time,
    payments.snap_token,
    payments.redirect_url,
    payments.snap_token_created_at
  from public.payments
  where payments.order_id = o.id
  order by payments.updated_at desc, payments.created_at desc
  limit 1
) p on true
left join lateral (
  select
    shipments.status,
    shipments.latest_biteship_status,
    shipments.courier_code,
    shipments.courier_service,
    shipments.shipping_etd,
    shipments.origin_area_id,
    shipments.destination_area_id,
    shipments.destination_postal_code,
    shipments.biteship_order_id,
    shipments.biteship_tracking_id,
    shipments.waybill_number,
    shipments.waybill_source,
    shipments.waybill_overridden_by,
    shipments.waybill_override_reason,
    shipments.waybill_overridden_at
  from public.shipments
  where shipments.order_id = o.id
  order by shipments.updated_at desc, shipments.created_at desc
  limit 1
) s on true;

comment on view public.order_read_model is
  'Security-invoker customer/admin order read model with explicit columns, payment/shipment rollups, customer completion metadata, and customer-facing order buckets.';

commit;
