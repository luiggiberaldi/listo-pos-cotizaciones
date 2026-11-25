-- Rollback de 322 (Solo STAGING). El servidor debe volver a la restauración anterior antes de ejecutarlo.
BEGIN;
DROP FUNCTION IF EXISTS public.restaurar_respaldo_atomico(uuid, jsonb);
COMMIT;
