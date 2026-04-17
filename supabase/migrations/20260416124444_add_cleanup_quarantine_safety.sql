begin;

alter table public.storage_cleanup_runs
  add column if not exists quarantined_count integer not null default 0 check (quarantined_count >= 0),
  add column if not exists sample_quarantined_paths jsonb not null default '[]'::jsonb;

comment on column public.storage_cleanup_runs.quarantined_count is
  'Number of orphaned files moved into quarantine during a cleanup run.';

comment on column public.storage_cleanup_runs.sample_quarantined_paths is
  'Bounded list of quarantine destinations created by a cleanup run.';

create or replace function public.list_cleanup_storage_objects(
  bucketid text,
  older_than timestamptz,
  limits integer default 1000,
  offsets integer default 0
)
returns table (
  name text,
  created_at timestamptz
)
language sql
stable
set search_path = public, storage
as $$
  select
    objects.name,
    objects.created_at
  from storage.objects
  where objects.bucket_id = bucketid
    and objects.created_at < older_than
    and (
      objects.name like 'categories/%'
      or objects.name like 'products/%'
      or objects.name like 'avatars/%'
      or objects.name like 'settings/%'
      or objects.name like 'banners/home_banner_top/%'
      or objects.name like 'banners/home_banner_bottom/%'
    )
    and objects.name not like '__orphan_quarantine/%'
  order by objects.name asc
  limit greatest(1, least(coalesce(limits, 1000), 1000))
  offset greatest(0, coalesce(offsets, 0));
$$;

comment on function public.list_cleanup_storage_objects(text, timestamptz, integer, integer) is
  'Lists managed media bucket objects older than a cutoff so orphan cleanup can apply a grace period before quarantine.';

commit;
