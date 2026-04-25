begin;

-- Repair the initial SKU backfill so category/product tokens match the plan:
-- category token max 8 chars and product token max 16 chars before suffixes.
-- This intentionally updates only live products.sku; order item SKU snapshots stay historical.
update public.products p
set sku = concat('REPAIR-', substring(upper(replace(p.id::text, '-', '')) from 1 for 32));

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
            from 1 for 8
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
            from 1 for 16
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
where p.id = resolved_skus.id;

commit;
