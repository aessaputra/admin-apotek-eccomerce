drop policy if exists "Allow public read store branding" on public.settings;
create policy "Allow public read store branding"
  on public.settings
  for select
  to anon, authenticated
  using (id = 1);

grant select (id, store_name) on table public.settings to anon;
grant select (id, store_name) on table public.settings to authenticated;
