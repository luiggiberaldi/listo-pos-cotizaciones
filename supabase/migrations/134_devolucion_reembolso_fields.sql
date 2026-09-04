-- 134_devolucion_reembolso_fields.sql
-- Columnas aditivas para registrar destino de saldo (saldo a favor vs reembolso) en devoluciones

ALTER TABLE despacho_devoluciones
  ADD COLUMN IF NOT EXISTS destino_saldo TEXT DEFAULT 'saldo_a_favor',
  ADD COLUMN IF NOT EXISTS reembolso_metodo TEXT,
  ADD COLUMN IF NOT EXISTS reembolso_referencia TEXT,
  ADD COLUMN IF NOT EXISTS reembolso_monto NUMERIC DEFAULT 0;

COMMENT ON COLUMN despacho_devoluciones.destino_saldo IS 'Destino del excedente a favor: saldo_a_favor o reembolso';
COMMENT ON COLUMN despacho_devoluciones.reembolso_metodo IS 'Forma de pago con que se reembolsó al cliente (Efectivo $, Pago Móvil, etc.)';
COMMENT ON COLUMN despacho_devoluciones.reembolso_referencia IS 'Referencia bancaria o comprobante del reembolso';
COMMENT ON COLUMN despacho_devoluciones.reembolso_monto IS 'Monto total en USD reembolsado al cliente';
