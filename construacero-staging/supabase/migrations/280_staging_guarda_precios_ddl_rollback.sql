-- 280_staging_guarda_precios_ddl_rollback.sql — REVERSIÓN de
-- 280_staging_guarda_precios_ddl.sql (staging). Elimina el event trigger y su
-- función. No toca las funciones de precios ni datos.
BEGIN;

DROP EVENT TRIGGER IF EXISTS guarda_precios_ddl;
DROP FUNCTION IF EXISTS public.guarda_precios_ddl();

NOTIFY pgrst, 'reload schema';
COMMIT;
