-- 129_add_origen_to_cotizacion_items.sql
-- Agrega columna 'origen' a cotizacion_items para distinguir productos de inventario vs externos

ALTER TABLE public.cotizacion_items
  ADD COLUMN IF NOT EXISTS origen TEXT NOT NULL DEFAULT 'inventario'
  CHECK (origen IN ('inventario', 'externo'));

-- Actualizar registros existentes: si no tienen producto_id, son externos
UPDATE public.cotizacion_items
  SET origen = 'externo'
  WHERE producto_id IS NULL;

COMMENT ON COLUMN public.cotizacion_items.origen
  IS 'Origen del ítem: inventario (producto del catálogo) o externo (producto manual sin stock)';
