-- 167_add_metodo_pago_to_cxc.sql
-- Agregar columna metodo_pago a la tabla cuentas_por_cobrar para distinguir crédito de COD

ALTER TABLE public.cuentas_por_cobrar
  ADD COLUMN IF NOT EXISTS metodo_pago TEXT NOT NULL DEFAULT 'cxc' CHECK (metodo_pago IN ('cxc', 'cod'));

CREATE INDEX IF NOT EXISTS idx_cxc_metodo_pago ON public.cuentas_por_cobrar(metodo_pago);
