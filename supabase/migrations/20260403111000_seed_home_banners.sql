insert into public.home_banners (
  placement_key,
  intent,
  title,
  body,
  media_path,
  cta_kind,
  cta_label,
  cta_route,
  is_active
)
values
  (
    'home_banner_top',
    'promotional',
    'Promo Ringan',
    'Cek pesanan terbaru Anda langsung dari home.',
    'banners/home_banner_top/seed-top-banner.webp',
    'route',
    'Lihat Pesanan',
    'orders',
    false
  ),
  (
    'home_banner_bottom',
    'branding',
    'Brand Story',
    null,
    'banners/home_banner_bottom/seed-bottom-banner.webp',
    'none',
    null,
    null,
    false
  )
on conflict do nothing;
