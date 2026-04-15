begin;

alter table public.addresses
  add column if not exists address_note text;

comment on column public.addresses.address_note is 'Optional supplementary delivery detail such as block, unit number, or landmark.';

commit;
