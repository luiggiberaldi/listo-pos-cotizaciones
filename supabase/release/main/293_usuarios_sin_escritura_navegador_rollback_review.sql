-- 293_usuarios_sin_escritura_navegador_rollback_review.sql — REVERSA de la 293 (PRODUCCIÓN).

DO $$ BEGIN RAISE EXCEPTION 'REVIEW_ONLY: reversa 293 solo si hace falta volver atrás'; END $$;

-- 293_staging_usuarios_sin_escritura_navegador_rollback.sql
-- Devuelve a "authenticated" INSERT / UPDATE / DELETE sobre usuarios. No toca datos.

BEGIN;

GRANT INSERT, UPDATE, DELETE ON TABLE public.usuarios TO authenticated;

COMMIT;
