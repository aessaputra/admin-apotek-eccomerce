begin;
alter table public.addresses
  add column if not exists area_name text;
comment on column public.addresses.area_name is 'Display name of the selected area for shipping calculations';
commit;
