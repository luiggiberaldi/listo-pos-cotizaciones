-- 323_staging_cxc_sin_escritura_directa.sql — Solo STAGING (OP-2026-086, hallazgo de la prueba S4)
-- En staging, una sesión iniciada podía escribir directo en cuentas_por_cobrar (con las reglas de
-- supervisor/jefe), saltándose el servidor. En producción ese permiso no existe; se iguala.
-- Rollback: 323_staging_cxc_sin_escritura_directa_rollback.sql
BEGIN;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.cuentas_por_cobrar FROM authenticated, anon;
COMMIT;
