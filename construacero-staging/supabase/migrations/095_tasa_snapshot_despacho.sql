-- 095: Guardar tasa de cambio en el momento de entrega del despacho
-- Cada despacho guarda la tasa con la que se vendió, para calcular Bs correctamente
-- independientemente de cambios futuros en la tasa.

ALTER TABLE public.notas_despacho
  ADD COLUMN IF NOT EXISTS tasa_snapshot NUMERIC(12,4);

COMMENT ON COLUMN public.notas_despacho.tasa_snapshot
  IS 'Tasa de cambio BCV (Bs/USD) al momento de confirmar la entrega. Se usa para calcular el total en Bs del reporte.';

-- Rellenar histórico: los despachos existentes usan la tasa de la cotización
UPDATE public.notas_despacho nd
SET tasa_snapshot = c.tasa_bcv_snapshot
FROM public.cotizaciones c
WHERE nd.cotizacion_id = c.id
  AND nd.estado IN ('entregada', 'despachada')
  AND nd.tasa_snapshot IS NULL
  AND c.tasa_bcv_snapshot IS NOT NULL;
