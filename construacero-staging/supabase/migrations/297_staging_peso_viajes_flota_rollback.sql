-- 297_staging_peso_viajes_flota_rollback.sql
BEGIN;
DROP FUNCTION IF EXISTS public.obtener_peso_viajes_flota(UUID, TIMESTAMPTZ, TIMESTAMPTZ);
COMMIT;
