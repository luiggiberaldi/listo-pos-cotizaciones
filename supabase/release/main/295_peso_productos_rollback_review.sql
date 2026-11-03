-- 295_peso_productos_rollback_review.sql — REVERSA de la 295 (PRODUCCIÓN). Borra los pesos cargados.

DO $$ BEGIN RAISE EXCEPTION 'REVIEW_ONLY: reversa 295 solo si hace falta volver atrás (borra pesos)'; END $$;

-- 295_staging_peso_productos_rollback.sql
-- Quita la columna de peso (se pierden los pesos cargados).
BEGIN;
ALTER TABLE public.productos DROP CONSTRAINT IF EXISTS productos_peso_kg_rango;
ALTER TABLE public.productos DROP COLUMN IF EXISTS peso_kg;
COMMIT;
