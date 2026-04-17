begin;

update public.settings
set enabled_couriers = nullif(lower(regexp_replace(enabled_couriers, '\s+', '', 'g')), '')
where enabled_couriers is not null;

alter table public.settings
  drop constraint if exists settings_enabled_couriers_format;

alter table public.settings
  add constraint settings_enabled_couriers_format
  check (
    enabled_couriers is null
    or enabled_couriers ~ '^[a-z0-9_]+(?::[a-z0-9_]+)*(?:,[a-z0-9_]+(?::[a-z0-9_]+)*)*$'
  );

comment on column public.settings.enabled_couriers is
  'Comma-separated enabled Biteship courier selections using canonical lowercase company or company:service tokens, for example jne or gojek:instant.';

commit;
