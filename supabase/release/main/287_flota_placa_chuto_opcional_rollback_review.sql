-- 287_flota_placa_chuto_opcional_rollback_review.sql — REVERSA de la 287 (PRODUCCIÓN).
-- Copia exacta de construacero-staging/supabase/migrations/287_staging_flota_placa_chuto_opcional_rollback.sql

DO $$ BEGIN RAISE EXCEPTION 'REVIEW_ONLY: reversa 287 solo si hace falta volver atrás'; END $$;

-- 287_staging_flota_placa_chuto_opcional_rollback.sql
-- Vuelve a exigir la placa del chuto. Los camiones que solo tienen batea reciben
-- esa placa también como chuto (como quedaron tras la carga histórica) para no
-- violar NOT NULL. El Worker/web deben volver antes a la versión que exige chuto.

BEGIN;

UPDATE public.vehiculos
   SET placa = placa_batea
 WHERE NULLIF(btrim(COALESCE(placa, '')), '') IS NULL
   AND NULLIF(btrim(COALESCE(placa_batea, '')), '') IS NOT NULL;

ALTER TABLE public.vehiculos DROP CONSTRAINT IF EXISTS chk_vehiculos_alguna_placa;
ALTER TABLE public.vehiculos ALTER COLUMN placa SET NOT NULL;

COMMIT;
