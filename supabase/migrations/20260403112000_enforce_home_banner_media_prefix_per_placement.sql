begin;

alter table public.home_banners
  drop constraint if exists home_banners_media_path_prefix_check;

alter table public.home_banners
  add constraint home_banners_media_path_prefix_check check (
    media_path is null
    or (
      placement_key = 'home_banner_top'
      and media_path like 'banners/home_banner_top/%'
    )
    or (
      placement_key = 'home_banner_bottom'
      and media_path like 'banners/home_banner_bottom/%'
    )
  );

commit;
