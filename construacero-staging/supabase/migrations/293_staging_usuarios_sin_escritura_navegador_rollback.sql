-- 293_staging_usuarios_sin_escritura_navegador_rollback.sql
-- Devuelve a "authenticated" INSERT / UPDATE / DELETE sobre usuarios. No toca datos.

BEGIN;

GRANT INSERT, UPDATE, DELETE ON TABLE public.usuarios TO authenticated;

COMMIT;
