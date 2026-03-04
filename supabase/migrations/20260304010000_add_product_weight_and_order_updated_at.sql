-- Add weight column to products (in grams, default 200g for pharmacy items)
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS weight integer NOT NULL DEFAULT 200;

COMMENT ON COLUMN public.products.weight IS 'Product weight in grams. Used by Biteship for shipping rate calculation.';

-- Add updated_at to orders for tracking status changes
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Auto-update updated_at on orders modification
CREATE OR REPLACE FUNCTION public.set_orders_updated_at()
RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS orders_set_updated_at ON public.orders;
CREATE TRIGGER orders_set_updated_at
    BEFORE UPDATE ON public.orders
    FOR EACH ROW
    EXECUTE FUNCTION public.set_orders_updated_at();

-- Create atomic stock reduction function for safe concurrent webhook processing
CREATE OR REPLACE FUNCTION public.reduce_product_stock(p_product_id uuid, p_quantity integer)
RETURNS void AS $$
BEGIN
    UPDATE public.products
    SET stock = GREATEST(0, stock - p_quantity)
    WHERE id = p_product_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
