-- 296_peso_lineas_y_despacho_rollback_review.sql — REVERSA de la 296 (PRODUCCIÓN). Borra las copias de peso de las líneas.

DO $$ BEGIN RAISE EXCEPTION 'REVIEW_ONLY: reversa 296 solo si hace falta volver atrás'; END $$;

-- 296_staging_peso_lineas_y_despacho_rollback.sql
-- Quita las vistas, la función, los disparadores y las columnas de peso de las líneas (se pierden las copias de peso).
BEGIN;
DROP VIEW IF EXISTS public.despacho_pesos;
DROP VIEW IF EXISTS public.despacho_items_peso;
DROP FUNCTION IF EXISTS public.peso_producto_visible(uuid);
DROP TRIGGER IF EXISTS trg_fijar_peso_linea ON public.cotizacion_items;
DROP TRIGGER IF EXISTS trg_fijar_peso_linea ON public.notas_despacho_items;
DROP FUNCTION IF EXISTS public.tg_fijar_peso_linea();
ALTER TABLE public.cotizacion_items     DROP COLUMN IF EXISTS peso_unit_kg_snap;
ALTER TABLE public.notas_despacho_items DROP COLUMN IF EXISTS peso_unit_kg_snap;
COMMIT;
