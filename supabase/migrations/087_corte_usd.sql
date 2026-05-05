-- 087: Agregar corte_usd a notas_despacho
-- El servicio de corte (CRT1254698) es un cargo exento de IVA,
-- igual que el flete. Se registra en la nota de despacho.

ALTER TABLE public.notas_despacho
  ADD COLUMN IF NOT EXISTS corte_usd NUMERIC(12,4) NOT NULL DEFAULT 0 CHECK (corte_usd >= 0);

COMMENT ON COLUMN public.notas_despacho.corte_usd
  IS 'Costo del servicio de corte (CRT1254698). Exento de IVA, igual que el flete.';
