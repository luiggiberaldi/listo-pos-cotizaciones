-- 284_staging_flota_grants_vehiculos.sql
-- Arreglo de la 283 (plan de flota): la tabla public.vehiculos se creó sin
-- GRANTs y este proyecto no otorga privilegios por defecto a tablas nuevas, así
-- que ni el Worker (service_role) podía leerla ("permission denied for table
-- vehiculos" → /api/vehiculos/listar respondía 500).
--
-- Mismo patrón que las tablas nuevas recientes (p. ej. comision_designacion_diaria):
--   * service_role (Worker): SELECT, INSERT, UPDATE, DELETE.
--   * authenticated (navegador): solo SELECT; la RLS de la 283 limita a su cuenta
--     y no hay políticas de escritura (raíl R2: solo el Worker escribe).
-- Rollback: 284_staging_flota_grants_vehiculos_rollback.sql

BEGIN;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehiculos TO service_role;
GRANT SELECT ON public.vehiculos TO authenticated;

COMMIT;
