-- 088: Agregar corte_usd a cotizaciones
-- El servicio de corte es exento de IVA, igual que el flete (costo_envio_usd).
-- Se persiste en cotizaciones para poder mostrarlo en el PDF de cotización.

ALTER TABLE public.cotizaciones
  ADD COLUMN IF NOT EXISTS corte_usd NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (corte_usd >= 0);

COMMENT ON COLUMN public.cotizaciones.corte_usd
  IS 'Costo del servicio de corte. Exento de IVA, se suma directamente al total_usd junto con costo_envio_usd.';
