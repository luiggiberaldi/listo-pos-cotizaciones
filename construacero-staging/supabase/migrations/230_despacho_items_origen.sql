-- 230_despacho_items_origen.sql
-- Completa columnas usadas por venta rápida, despachos y devoluciones.

ALTER TABLE public.notas_despacho_items
  ADD COLUMN IF NOT EXISTS origen TEXT NOT NULL DEFAULT 'inventario',
  ADD COLUMN IF NOT EXISTS es_prestamo BOOLEAN NOT NULL DEFAULT FALSE;

-- Los ítems históricos sin producto pertenecen a artículos externos.
UPDATE public.notas_despacho_items
SET origen = 'externo'
WHERE producto_id IS NULL
  AND COALESCE(origen, 'inventario') = 'inventario';

COMMENT ON COLUMN public.notas_despacho_items.origen IS
  'Origen del ítem: inventario, externo o una fuente operativa equivalente';
COMMENT ON COLUMN public.notas_despacho_items.es_prestamo IS
  'Indica si el artículo fue entregado como préstamo';
