ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS waybill_source text,
  ADD COLUMN IF NOT EXISTS waybill_overridden_by uuid,
  ADD COLUMN IF NOT EXISTS waybill_override_reason text,
  ADD COLUMN IF NOT EXISTS waybill_overridden_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'orders_waybill_source_check'
      AND conrelid = 'public.orders'::regclass
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_waybill_source_check
      CHECK (
        waybill_source IS NULL
        OR waybill_source IN ('system', 'manual')
      );
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_orders_waybill_overridden_by
  ON public.orders (waybill_overridden_by);
