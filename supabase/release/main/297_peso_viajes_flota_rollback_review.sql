-- 297_peso_viajes_flota_rollback_review.sql — REVERSA de la 297 (PRODUCCIÓN).

DO $$ BEGIN RAISE EXCEPTION 'REVIEW_ONLY: reversa 297 solo si hace falta volver atrás'; END $$;

-- 297_staging_peso_viajes_flota_rollback.sql
BEGIN;
DROP FUNCTION IF EXISTS public.obtener_peso_viajes_flota(UUID, TIMESTAMPTZ, TIMESTAMPTZ);
COMMIT;
