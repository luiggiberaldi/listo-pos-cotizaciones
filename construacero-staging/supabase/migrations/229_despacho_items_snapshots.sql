-- 229_despacho_items_snapshots.sql
-- Mantiene en cada ítem del despacho la cantidad y el precio originales.
-- Es idempotente para poder ejecutarse sobre bases staging parcialmente migradas.

ALTER TABLE public.notas_despacho_items
  ADD COLUMN IF NOT EXISTS cantidad_original NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS precio_original NUMERIC(12,4);

-- Las filas antiguas representan su snapshot original con los valores actuales.
UPDATE public.notas_despacho_items
SET cantidad_original = cantidad
WHERE cantidad_original IS NULL;

UPDATE public.notas_despacho_items
SET precio_original = precio_unit_usd
WHERE precio_original IS NULL;

COMMENT ON COLUMN public.notas_despacho_items.cantidad_original IS
  'Cantidad inicial del ítem al crear o editar profundamente el despacho';
COMMENT ON COLUMN public.notas_despacho_items.precio_original IS
  'Precio unitario inicial del ítem al crear o editar profundamente el despacho';
