-- 289_cerrar_permisos_push_rollback_review.sql — REVERSA de la 289 (PRODUCCIÓN).
-- Copia exacta de construacero-staging/supabase/migrations/289_staging_cerrar_permisos_push_rollback.sql

DO $$ BEGIN RAISE EXCEPTION 'REVIEW_ONLY: reversa 289 solo si hace falta volver atrás'; END $$;

-- 289_staging_cerrar_permisos_push_rollback.sql
-- Devuelve los permisos amplios que tenía push_subscriptions antes de la 289 (anon / authenticated).
-- Las reglas de fila (RLS) siguen activas. No toca datos.

BEGIN;

GRANT ALL ON TABLE public.push_subscriptions TO anon, authenticated;

COMMIT;
