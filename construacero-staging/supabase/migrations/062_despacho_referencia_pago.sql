-- 062: Agregar campos de referencia de pago del cliente en despachos
ALTER TABLE notas_despacho
  ADD COLUMN IF NOT EXISTS referencia_pago TEXT,
  ADD COLUMN IF NOT EXISTS forma_pago_cliente TEXT;

COMMENT ON COLUMN notas_despacho.referencia_pago IS 'Referencia/comprobante del pago del cliente';
COMMENT ON COLUMN notas_despacho.forma_pago_cliente IS 'Forma de pago usada por el cliente';
