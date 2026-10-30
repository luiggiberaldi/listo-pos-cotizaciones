-- 287_staging_flota_placa_chuto_opcional.sql
-- Plan de flota — pedido del dueño 2026-10-30: hay camiones que solo tienen placa
-- de batea (las fichas viejas la traían así). La placa del chuto deja de ser
-- obligatoria, pero cada camión debe tener AL MENOS una placa (chuto o batea).
--
-- - vehiculos.placa (chuto) acepta NULL. El índice único (cuenta_id, placa) se
--   mantiene: varios NULL no chocan entre sí.
-- - Nueva regla chk_vehiculos_alguna_placa.
-- - Las RPC de reportes ya usan COALESCE(placa, 'S/P'): no cambian.
-- Rollback: 287_staging_flota_placa_chuto_opcional_rollback.sql

BEGIN;

ALTER TABLE public.vehiculos ALTER COLUMN placa DROP NOT NULL;

ALTER TABLE public.vehiculos DROP CONSTRAINT IF EXISTS chk_vehiculos_alguna_placa;
ALTER TABLE public.vehiculos ADD CONSTRAINT chk_vehiculos_alguna_placa CHECK (
  NULLIF(btrim(COALESCE(placa, '')), '') IS NOT NULL
  OR NULLIF(btrim(COALESCE(placa_batea, '')), '') IS NOT NULL
);

COMMENT ON COLUMN public.vehiculos.placa IS
  'Placa del chuto (opcional desde 287). Cada camión necesita al menos una placa: chuto o batea.';

COMMIT;
