-- 231_aprobado_por_nombre.sql
-- Nombre visible del operador que cambia un despacho a aprobado/despachado.
-- Idempotente para bases que ya recibieron el cambio manualmente.

ALTER TABLE public.notas_despacho
  ADD COLUMN IF NOT EXISTS aprobado_por_nombre TEXT;

COMMENT ON COLUMN public.notas_despacho.aprobado_por_nombre
  IS 'Nombre del operador que aprobó el despacho (estado despachada).';
