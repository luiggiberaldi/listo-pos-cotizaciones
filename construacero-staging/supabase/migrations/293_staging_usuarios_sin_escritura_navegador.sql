-- 293_staging_usuarios_sin_escritura_navegador.sql  (Etapa D de la auditoría de permisos de tablas)
-- El navegador (rol "authenticated") podía MODIFICAR la tabla usuarios directamente: con la sesión de un
-- supervisor se pudo cambiar a "jefe" el rol de otro usuario (comprobado en staging 2026-11-02), saltándose
-- las validaciones del Worker. La web nunca escribe en usuarios (0 escrituras en src/): todo cambio de
-- usuarios lo hace el Worker con la llave de servicio. Se quita INSERT / UPDATE / DELETE al navegador.
-- La lectura (SELECT por columnas, sin PIN) no se toca. No toca datos.
-- Rollback: 293_staging_usuarios_sin_escritura_navegador_rollback.sql

BEGIN;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.usuarios FROM PUBLIC, anon, authenticated;

COMMIT;
