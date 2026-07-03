-- Migration: Enforce product_images.sort_order upper bound to align with spec N(1)
-- Purpose: product_images.sort_order is defined as N(1) (single digit, 0-9).
-- The admin panel already limits uploads to 10 images (indices 0-9), but the DB
-- only enforced sort_order >= 0. Add sort_order <= 9 CHECK for full spec parity.

alter table public.product_images
  drop constraint if exists product_images_sort_order_max_chk;

alter table public.product_images
  add constraint product_images_sort_order_max_chk
  check (sort_order <= 9);
