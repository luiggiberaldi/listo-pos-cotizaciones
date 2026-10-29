-- 284_staging_flota_grants_vehiculos_rollback.sql
-- Deja la tabla vehiculos sin privilegios (estado previo a la 284).
-- OJO: con esto /api/vehiculos/* vuelve a fallar con "permission denied".

BEGIN;

REVOKE SELECT, INSERT, UPDATE, DELETE ON public.vehiculos FROM service_role;
REVOKE SELECT ON public.vehiculos FROM authenticated;

COMMIT;
