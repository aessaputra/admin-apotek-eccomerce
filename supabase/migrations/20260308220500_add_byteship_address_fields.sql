begin;
alter table public.addresses
  add column if not exists country_code text,
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;
update public.addresses
set country_code = 'ID'
where country_code is null;
alter table public.addresses
  alter column country_code set default 'ID';
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'addresses_country_code_check'
      and conrelid = 'public.addresses'::regclass
  ) then
    alter table public.addresses
      add constraint addresses_country_code_check
      check (country_code is null or char_length(country_code) = 2);
  end if;
end
$$;
comment on column public.addresses.country_code is 'ISO 3166-1 alpha-2 country code. Defaults to ID.';
comment on column public.addresses.latitude is 'Optional destination latitude for courier/instant shipping.';
comment on column public.addresses.longitude is 'Optional destination longitude for courier/instant shipping.';
commit;
