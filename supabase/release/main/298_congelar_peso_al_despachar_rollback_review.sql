-- 298_congelar_peso_al_despachar_rollback_review.sql — REVERSA de la 298 (PRODUCCIÓN).

DO $$ BEGIN RAISE EXCEPTION 'REVIEW_ONLY: reversa 298 solo si hace falta volver atrás'; END $$;

-- 298_staging_congelar_peso_al_despachar_rollback.sql
BEGIN;
DROP TRIGGER IF EXISTS trg_congelar_peso_despacho ON public.notas_despacho;
DROP FUNCTION IF EXISTS public.tg_congelar_peso_despacho();
COMMIT;
