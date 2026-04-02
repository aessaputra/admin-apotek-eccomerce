alter table public.products
  alter column weight drop default;

alter table public.products
  drop constraint if exists products_weight_positive;

alter table public.products
  add constraint products_weight_positive
    check (weight > 0);

comment on column public.products.weight is
  'Product shipping weight in grams. Required and must be greater than zero.';
