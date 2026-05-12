-- 032_iva_configuracion.sql
ALTER TABLE configuracion_negocio
  ADD COLUMN IF NOT EXISTS iva_pct NUMERIC(5,2) NOT NULL DEFAULT 0;
COMMENT ON COLUMN configuracion_negocio.iva_pct IS 'Porcentaje de IVA (0 = desactivado, 16 = 16%)';
