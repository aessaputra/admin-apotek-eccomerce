begin;

-- Drop the existing constraint
alter table public.home_banners
drop constraint if exists home_banners_cta_consistency_check;

-- Recreate the constraint with only home/all-products as allowed route
alter table public.home_banners
add constraint home_banners_cta_consistency_check check (
  (
    cta_kind = 'none'
    and cta_label is null
    and cta_route is null
  )
  or (
    cta_kind = 'route'
    and cta_label is not null
    and btrim(cta_label) <> ''
    and cta_route is not null
    and cta_route in ('home/all-products')
  )
);

commit;
