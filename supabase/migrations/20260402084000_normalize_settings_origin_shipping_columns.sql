DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.settings
    WHERE origin_postal_code IS NULL
       OR btrim(origin_postal_code) !~ '^[1-9][0-9]{4}$'
  ) THEN
    RAISE EXCEPTION
      'Cannot migrate public.settings.origin_postal_code: every row must contain a valid 5-digit Indonesian postal code starting with digits 1-9 before this migration runs.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.settings
    WHERE btrim(origin_latitude) <> ''
      AND btrim(origin_latitude) !~ '^[-+]?[0-9]+(\.[0-9]+)?$'
  ) THEN
    RAISE EXCEPTION
      'Cannot migrate public.settings.origin_latitude: found non-numeric values.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.settings
    WHERE btrim(origin_longitude) <> ''
      AND btrim(origin_longitude) !~ '^[-+]?[0-9]+(\.[0-9]+)?$'
  ) THEN
    RAISE EXCEPTION
      'Cannot migrate public.settings.origin_longitude: found non-numeric values.';
  END IF;
END
$$;

ALTER TABLE public.settings
  ALTER COLUMN origin_postal_code DROP DEFAULT,
  ALTER COLUMN origin_latitude DROP DEFAULT,
  ALTER COLUMN origin_longitude DROP DEFAULT,
  ALTER COLUMN origin_area_id DROP DEFAULT,
  ALTER COLUMN origin_latitude DROP NOT NULL,
  ALTER COLUMN origin_longitude DROP NOT NULL;

UPDATE public.settings
SET origin_postal_code = btrim(origin_postal_code),
    origin_latitude = NULLIF(btrim(origin_latitude), ''),
    origin_longitude = NULLIF(btrim(origin_longitude), ''),
    origin_area_id = NULLIF(btrim(origin_area_id), '');

ALTER TABLE public.settings
  ALTER COLUMN origin_postal_code TYPE varchar(5)
    USING btrim(origin_postal_code),
  ALTER COLUMN origin_latitude TYPE numeric(10, 8)
    USING CASE
      WHEN origin_latitude IS NULL THEN NULL
      ELSE origin_latitude::numeric(10, 8)
    END,
  ALTER COLUMN origin_longitude TYPE numeric(11, 8)
    USING CASE
      WHEN origin_longitude IS NULL THEN NULL
      ELSE origin_longitude::numeric(11, 8)
    END,
  ALTER COLUMN origin_postal_code SET NOT NULL;

ALTER TABLE public.settings
  DROP CONSTRAINT IF EXISTS settings_origin_postal_code_format,
  DROP CONSTRAINT IF EXISTS settings_origin_latitude_range,
  DROP CONSTRAINT IF EXISTS settings_origin_longitude_range,
  DROP CONSTRAINT IF EXISTS settings_origin_coordinates_pair,
  DROP CONSTRAINT IF EXISTS settings_origin_area_id_not_blank;

ALTER TABLE public.settings
  ADD CONSTRAINT settings_origin_postal_code_format
    CHECK (origin_postal_code ~ '^[1-9][0-9]{4}$'),
  ADD CONSTRAINT settings_origin_latitude_range
    CHECK (origin_latitude IS NULL OR origin_latitude BETWEEN -90 AND 90),
  ADD CONSTRAINT settings_origin_longitude_range
    CHECK (origin_longitude IS NULL OR origin_longitude BETWEEN -180 AND 180),
  ADD CONSTRAINT settings_origin_coordinates_pair
    CHECK (
      (origin_latitude IS NULL AND origin_longitude IS NULL)
      OR (origin_latitude IS NOT NULL AND origin_longitude IS NOT NULL)
    ),
  ADD CONSTRAINT settings_origin_area_id_not_blank
    CHECK (origin_area_id IS NULL OR btrim(origin_area_id) <> '');

COMMENT ON COLUMN public.settings.origin_postal_code IS
  'Five-digit Indonesian origin postal code used for Biteship shipping requests.';

COMMENT ON COLUMN public.settings.origin_latitude IS
  'Optional store origin latitude for Biteship rates fallback, stored as numeric decimal degrees.';

COMMENT ON COLUMN public.settings.origin_longitude IS
  'Optional store origin longitude for Biteship rates fallback, stored as numeric decimal degrees.';
