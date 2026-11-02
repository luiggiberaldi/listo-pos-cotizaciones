-- 289_cerrar_permisos_push_apply.sql — CERRAR PERMISOS DE push_subscriptions (PRODUCCIÓN).
-- Copia exacta de construacero-staging/supabase/migrations/289_staging_cerrar_permisos_push.sql
-- No toca datos. Solo quita permisos de tabla a anon / authenticated; el Worker (service_role) sigue igual.
-- Reversa: 289_cerrar_permisos_push_rollback_review.sql

-- 289_staging_cerrar_permisos_push.sql
-- Cierra los permisos de public.push_subscriptions para el navegador (anon / authenticated).
-- Solo el Worker (service_role) lee y escribe esta tabla; ninguna pantalla la toca. Hasta hoy las
-- únicas defensas eran las reglas de fila (RLS); ahora tampoco tienen permiso de tabla.
-- No toca ningún dato. Misma lección que la 283b / 288 (Supabase da permisos amplios por defecto).
-- Rollback: 289_staging_cerrar_permisos_push_rollback.sql

BEGIN;

REVOKE ALL ON TABLE public.push_subscriptions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.push_subscriptions TO service_role;

COMMIT;
