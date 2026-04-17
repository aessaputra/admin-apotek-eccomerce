begin;

drop policy if exists "Allow authenticated users to update settings" on public.settings;

create policy "Allow authenticated users to update settings"
  on public.settings
  for update
  to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

commit;
