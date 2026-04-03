begin;

create table if not exists public.home_banners (
  id uuid primary key default gen_random_uuid(),
  placement_key text not null,
  intent text not null,
  title text null,
  body text null,
  media_path text null,
  cta_kind text not null,
  cta_label text null,
  cta_route text null,
  is_active boolean not null default false,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint home_banners_placement_key_check check (
    placement_key in ('home_banner_top', 'home_banner_bottom')
  ),
  constraint home_banners_intent_check check (
    intent in ('promotional', 'informational', 'branding')
  ),
  constraint home_banners_cta_kind_check check (
    cta_kind in ('none', 'route')
  ),
  constraint home_banners_cta_consistency_check check (
    (
      cta_kind = 'none'
      and cta_label is null
      and cta_route is null
    )
    or (
      cta_kind = 'route'
      and cta_label is not null
      and btrim(cta_label) <> ''
      and cta_route is not null
      and cta_route in ('orders', 'cart', 'home/details')
    )
  ),
  constraint home_banners_visible_payload_check check (
    nullif(btrim(coalesce(title, '')), '') is not null
    or nullif(btrim(coalesce(body, '')), '') is not null
    or nullif(btrim(coalesce(media_path, '')), '') is not null
  ),
  constraint home_banners_title_not_empty_check check (
    title is null or btrim(title) <> ''
  ),
  constraint home_banners_body_not_empty_check check (
    body is null or btrim(body) <> ''
  ),
  constraint home_banners_media_path_not_empty_check check (
    media_path is null or btrim(media_path) <> ''
  ),
  constraint home_banners_media_path_prefix_check check (
    media_path is null
    or (
      placement_key = 'home_banner_top'
      and media_path like 'banners/home_banner_top/%'
    )
    or (
      placement_key = 'home_banner_bottom'
      and media_path like 'banners/home_banner_bottom/%'
    )
  )
);

create unique index if not exists home_banners_active_placement_idx
  on public.home_banners (placement_key)
  where is_active = true;

create or replace function public.update_home_banners_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$;

drop trigger if exists trigger_update_home_banners_updated_at on public.home_banners;
create trigger trigger_update_home_banners_updated_at
  before update on public.home_banners
  for each row
  execute function public.update_home_banners_updated_at();

alter table public.home_banners enable row level security;

drop policy if exists "Public can read active home banners" on public.home_banners;
create policy "Public can read active home banners"
  on public.home_banners
  for select
  to anon
  using (is_active = true);

drop policy if exists "Authenticated users can read active home banners" on public.home_banners;
create policy "Authenticated users can read active home banners"
  on public.home_banners
  for select
  to authenticated
  using (is_active = true or (select private.is_admin()));

drop policy if exists "Admins can insert home banners" on public.home_banners;
create policy "Admins can insert home banners"
  on public.home_banners
  for insert
  to authenticated
  with check ((select private.is_admin()));

drop policy if exists "Admins can update home banners" on public.home_banners;
create policy "Admins can update home banners"
  on public.home_banners
  for update
  to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

drop policy if exists "Admins can delete home banners" on public.home_banners;
create policy "Admins can delete home banners"
  on public.home_banners
  for delete
  to authenticated
  using ((select private.is_admin()));

comment on table public.home_banners is
  'Operation-managed home banners for the top and bottom placements on the mobile home screen.';

commit;
