begin;

alter table public.products
  add column if not exists sku text;

alter table public.order_items
  add column if not exists product_sku_at_purchase text;

with normalized_products as (
  select
    p.id,
    coalesce(
      nullif(
        regexp_replace(
          substring(
            regexp_replace(
              regexp_replace(upper(coalesce(c.slug, c.name, 'PRD')), '[^A-Z0-9]+', '-', 'g'),
              '(^-+|-+$)',
              '',
              'g'
            )
            from 1 for 12
          ),
          '(^-+|-+$)',
          '',
          'g'
        ),
        ''
      ),
      'PRD'
    ) as category_token,
    coalesce(
      nullif(
        regexp_replace(
          substring(
            regexp_replace(
              regexp_replace(upper(coalesce(p.name, 'ITEM')), '[^A-Z0-9]+', '-', 'g'),
              '(^-+|-+$)',
              '',
              'g'
            )
            from 1 for 28
          ),
          '(^-+|-+$)',
          '',
          'g'
        ),
        ''
      ),
      'ITEM'
    ) as product_token,
    substring(upper(replace(p.id::text, '-', '')) from 1 for 4) as uuid_suffix
  from public.products p
  left join public.categories c on c.id = p.category_id
), sku_candidates as (
  select
    id,
    concat(category_token, '-', product_token, '-', uuid_suffix) as candidate_sku
  from normalized_products
), resolved_skus as (
  select
    id,
    case
      when row_number() over (partition by candidate_sku order by id) = 1 then candidate_sku
      else concat(
        candidate_sku,
        '-',
        row_number() over (partition by candidate_sku order by id)
      )
    end as resolved_sku
  from sku_candidates
)
update public.products p
set sku = resolved_skus.resolved_sku
from resolved_skus
where p.id = resolved_skus.id
  and (
    p.sku is null
    or btrim(p.sku) = ''
  );

update public.order_items oi
set product_sku_at_purchase = p.sku
from public.products p
where oi.product_id = p.id
  and oi.product_id is not null
  and oi.product_sku_at_purchase is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_sku_check'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_sku_check
      check (
        sku ~ '^[A-Z0-9]+(?:-[A-Z0-9]+)*$'
        and length(sku) between 4 and 50
      );
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'order_items_product_sku_at_purchase_check'
      and conrelid = 'public.order_items'::regclass
  ) then
    alter table public.order_items
      add constraint order_items_product_sku_at_purchase_check
      check (
        product_sku_at_purchase is null
        or (
          product_sku_at_purchase ~ '^[A-Z0-9]+(?:-[A-Z0-9]+)*$'
          and length(product_sku_at_purchase) between 4 and 50
        )
      );
  end if;
end;
$$;

alter table public.products
  alter column sku set not null;

create unique index if not exists products_sku_uidx
  on public.products (sku);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_sku_key'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_sku_key
      unique using index products_sku_uidx;
  end if;
end;
$$;

comment on column public.products.sku is
  'Stable uppercase hyphen-delimited product SKU. Product UUID remains the canonical relational identifier.';

comment on column public.order_items.product_sku_at_purchase is
  'Nullable historical product SKU snapshot captured from products.sku at purchase time; not a foreign key.';

commit;
