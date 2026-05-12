-- 038_notas_despacho_forma_pago.sql
-- Agrega columna forma_pago a notas_despacho
-- (requerida por useDespachos.js pero faltaba en la definición inicial de la tabla)

ALTER TABLE public.notas_despacho
  ADD COLUMN IF NOT EXISTS forma_pago TEXT;
