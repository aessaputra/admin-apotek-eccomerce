ALTER TABLE public.settings
ADD COLUMN IF NOT EXISTS enabled_couriers text;

UPDATE public.settings
SET enabled_couriers = 'jne,jnt,sicepat,anteraja,pos,gojek,grab,lalamove'
WHERE id = 1 AND (enabled_couriers IS NULL OR btrim(enabled_couriers) = '');

COMMENT ON COLUMN public.settings.enabled_couriers IS
  'Comma-separated Biteship courier codes enabled for rates, for example jne,jnt,sicepat';
