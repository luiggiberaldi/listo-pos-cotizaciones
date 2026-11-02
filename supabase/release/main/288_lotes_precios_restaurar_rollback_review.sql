-- 288_lotes_precios_restaurar_rollback_review.sql — REVERSA de la 288 (PRODUCCIÓN).
-- Copia exacta de construacero-staging/supabase/migrations/288_staging_lotes_precios_restaurar_rollback.sql

DO $$ BEGIN RAISE EXCEPTION 'REVIEW_ONLY: reversa 288 solo si hace falta volver atrás'; END $$;

-- 288_staging_lotes_precios_restaurar_rollback.sql
-- Quita las funciones y tablas de lotes de precios. Los precios actuales de los productos
-- NO se tocan; solo se pierde el historial para restaurar. El Worker debe volver antes a la
-- versión que no usa estas funciones.

BEGIN;

DROP FUNCTION IF EXISTS public.restaurar_lote_precios(UUID, UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.aplicar_lote_precios(UUID, UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, BOOLEAN, JSONB);
DROP TABLE IF EXISTS public.productos_precio_lote_items;
DROP TABLE IF EXISTS public.productos_precio_lotes;

COMMIT;
