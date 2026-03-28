ALTER TABLE public.settings
ADD COLUMN IF NOT EXISTS origin_area_id TEXT;

COMMENT ON COLUMN public.settings.origin_area_id IS
'Biteship Area ID for high-accuracy shipping rates.
 Retrieved from GET /v1/maps/areas API.
 Example: IDNP6IDNC148IDND843IDZ12250';
