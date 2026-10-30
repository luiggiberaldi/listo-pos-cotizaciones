-- 285_staging_flota_vehiculos_modelo_batea.sql
-- Plan de flota: el camión guarda su modelo y la placa de la batea, igual que
-- la ficha de un transportista externo. Sin la placa de batea, la guía de
-- despacho de un viaje en camión propio imprimía "PLACA BATEA" en blanco.
--   * modelo:      descriptivo (ej. "Mack Granite 2020"), opcional.
--   * placa_batea: opcional; la columna placa sigue siendo la principal (chuto).
-- Solo agrega columnas vacías: no toca viajes, cotizaciones ni pagos.
-- Rollback: 285_staging_flota_vehiculos_modelo_batea_rollback.sql

BEGIN;

ALTER TABLE public.vehiculos
  ADD COLUMN IF NOT EXISTS modelo TEXT,
  ADD COLUMN IF NOT EXISTS placa_batea TEXT;

COMMENT ON COLUMN public.vehiculos.placa IS 'Placa principal (chuto) del camión.';
COMMENT ON COLUMN public.vehiculos.placa_batea IS 'Placa de la batea (remolque), si aplica.';
COMMENT ON COLUMN public.vehiculos.modelo IS 'Marca/modelo/año, ej. "Mack Granite 2020".';

COMMIT;
