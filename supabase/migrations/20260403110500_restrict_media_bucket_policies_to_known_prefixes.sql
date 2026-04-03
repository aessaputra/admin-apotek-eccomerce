begin;

drop policy if exists "Allow public read access on media bucket" on storage.objects;
create policy "Allow public read access on media bucket"
on storage.objects for select
using (
  bucket_id = 'media'
  and (
    (storage.foldername(name))[1] in ('categories', 'products', 'avatars')
    or (
      (storage.foldername(name))[1] = 'banners'
      and (storage.foldername(name))[2] in ('home_banner_top', 'home_banner_bottom')
    )
  )
);

drop policy if exists "Allow admin inserts on media bucket" on storage.objects;
create policy "Allow admin inserts on media bucket"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'media'
  and (
    (storage.foldername(name))[1] in ('categories', 'products', 'avatars')
    or (
      (storage.foldername(name))[1] = 'banners'
      and (storage.foldername(name))[2] in ('home_banner_top', 'home_banner_bottom')
    )
  )
  and (select private.is_admin())
);

drop policy if exists "Allow admin updates on media bucket" on storage.objects;
create policy "Allow admin updates on media bucket"
on storage.objects for update
to authenticated
using (
  bucket_id = 'media'
  and (
    (storage.foldername(name))[1] in ('categories', 'products', 'avatars')
    or (
      (storage.foldername(name))[1] = 'banners'
      and (storage.foldername(name))[2] in ('home_banner_top', 'home_banner_bottom')
    )
  )
  and (select private.is_admin())
)
with check (
  bucket_id = 'media'
  and (
    (storage.foldername(name))[1] in ('categories', 'products', 'avatars')
    or (
      (storage.foldername(name))[1] = 'banners'
      and (storage.foldername(name))[2] in ('home_banner_top', 'home_banner_bottom')
    )
  )
  and (select private.is_admin())
);

drop policy if exists "Allow admin deletes on media bucket" on storage.objects;
create policy "Allow admin deletes on media bucket"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'media'
  and (
    (storage.foldername(name))[1] in ('categories', 'products', 'avatars')
    or (
      (storage.foldername(name))[1] = 'banners'
      and (storage.foldername(name))[2] in ('home_banner_top', 'home_banner_bottom')
    )
  )
  and (select private.is_admin())
);

commit;
