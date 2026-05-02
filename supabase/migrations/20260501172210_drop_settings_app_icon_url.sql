alter table public.settings
  drop constraint if exists settings_app_icon_url_not_blank;

alter table public.settings
  drop column if exists app_icon_url;
