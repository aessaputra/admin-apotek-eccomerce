begin;

update public.settings
set primary_logo_url = null
where primary_logo_url is not null
  and btrim(primary_logo_url) = '';

update public.settings
set app_icon_url = null
where app_icon_url is not null
  and btrim(app_icon_url) = '';

alter table public.settings
  alter column primary_logo_url drop default,
  alter column app_icon_url drop default;

alter table public.settings
  drop constraint if exists settings_primary_logo_url_not_blank,
  drop constraint if exists settings_app_icon_url_not_blank;

alter table public.settings
  add constraint settings_primary_logo_url_not_blank
    check (primary_logo_url is null or btrim(primary_logo_url) <> ''),
  add constraint settings_app_icon_url_not_blank
    check (app_icon_url is null or btrim(app_icon_url) <> '');

alter table public.categories
  drop constraint if exists categories_logo_url_not_blank;

alter table public.categories
  add constraint categories_logo_url_not_blank
    check (logo_url is null or btrim(logo_url) <> '');

alter table public.profiles
  drop constraint if exists profiles_avatar_url_not_blank;

alter table public.profiles
  add constraint profiles_avatar_url_not_blank
    check (avatar_url is null or btrim(avatar_url) <> '');

alter table public.home_banners
  drop constraint if exists home_banners_media_path_not_blank;

alter table public.home_banners
  add constraint home_banners_media_path_not_blank
    check (media_path is null or btrim(media_path) <> '');

alter table public.product_images
  drop constraint if exists product_images_url_not_blank;

alter table public.product_images
  add constraint product_images_url_not_blank
    check (btrim(url) <> '');

commit;
