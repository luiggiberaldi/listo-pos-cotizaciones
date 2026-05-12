-- 070: Agregar tipo 'monto_unitario' al CHECK constraint de despacho_descuentos
-- Permite descuentos por unidad (valor × cantidad)

ALTER TABLE public.despacho_descuentos
  DROP CONSTRAINT IF EXISTS despacho_descuentos_tipo_check;

ALTER TABLE public.despacho_descuentos
  ADD CONSTRAINT despacho_descuentos_tipo_check
  CHECK (tipo IN ('porcentaje', 'monto', 'monto_unitario'));
