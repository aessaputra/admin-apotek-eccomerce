drop policy if exists "Allow public read store branding" on public.settings;
create policy "Allow public read store branding"
  on public.settings
  for select
  to anon, authenticated
  using (id = 1);

grant select (id, store_name, primary_logo_url) on table public.settings to anon, authenticated;

drop policy if exists "Allow public read settings media" on storage.objects;
create policy "Allow public read settings media"
  on storage.objects
  for select
  to public
  using (
    (bucket_id = 'media')
    and ((storage.foldername(name))[1] = 'settings')
  );

drop policy if exists "Allow admin inserts on settings media" on storage.objects;
create policy "Allow admin inserts on settings media"
  on storage.objects
  for insert
  to authenticated
  with check (
    (bucket_id = 'media')
    and ((storage.foldername(name))[1] = 'settings')
    and (select private.is_admin())
  );

drop policy if exists "Allow admin updates on settings media" on storage.objects;
create policy "Allow admin updates on settings media"
  on storage.objects
  for update
  to authenticated
  using (
    (bucket_id = 'media')
    and ((storage.foldername(name))[1] = 'settings')
    and (select private.is_admin())
  )
  with check (
    (bucket_id = 'media')
    and ((storage.foldername(name))[1] = 'settings')
    and (select private.is_admin())
  );

drop policy if exists "Allow admin deletes on settings media" on storage.objects;
create policy "Allow admin deletes on settings media"
  on storage.objects
  for delete
  to authenticated
  using (
    (bucket_id = 'media')
    and ((storage.foldername(name))[1] = 'settings')
    and (select private.is_admin())
  );
