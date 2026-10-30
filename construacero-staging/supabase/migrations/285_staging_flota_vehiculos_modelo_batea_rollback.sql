-- 285_staging_flota_vehiculos_modelo_batea_rollback.sql
-- Quita modelo y placa_batea de public.vehiculos (se pierden esos dos datos).
-- El Worker y la web deben volver antes a la versión que no los pide.

BEGIN;

ALTER TABLE public.vehiculos
  DROP COLUMN IF EXISTS placa_batea,
  DROP COLUMN IF EXISTS modelo;

COMMIT;
