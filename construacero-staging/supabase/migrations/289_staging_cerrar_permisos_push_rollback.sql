-- 289_staging_cerrar_permisos_push_rollback.sql
-- Devuelve los permisos amplios que tenía push_subscriptions antes de la 289 (anon / authenticated).
-- Las reglas de fila (RLS) siguen activas. No toca datos.

BEGIN;

GRANT ALL ON TABLE public.push_subscriptions TO anon, authenticated;

COMMIT;
