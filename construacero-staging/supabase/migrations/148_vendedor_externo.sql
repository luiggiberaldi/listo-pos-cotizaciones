-- 148_vendedor_externo.sql
-- Soporte para vendedores externos con markup de precio y comisiones propias
-- markup_pct        → % de sobreprecio que este vendedor aplica al cotizar (NULL = sin markup)
-- comision_pct      → tasa de comisión propia para productos generales (NULL = usa config global)
-- comision_pct_cabilla → tasa de comisión propia para cabilla/cemento (NULL = usa config global)

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS markup_pct          NUMERIC(5,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS comision_pct         NUMERIC(5,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS comision_pct_cabilla NUMERIC(5,2) DEFAULT NULL;

COMMENT ON COLUMN usuarios.markup_pct          IS 'Porcentaje de markup que se suma al precio base al cotizar (ej: 2.00 = +2%). NULL = sin markup (vendedor interno)';
COMMENT ON COLUMN usuarios.comision_pct         IS 'Tasa de comisión propia para productos generales. NULL = usa comision_pct_otros de config_negocio';
COMMENT ON COLUMN usuarios.comision_pct_cabilla IS 'Tasa de comisión propia para cabilla/cemento. NULL = usa comision_pct_cabilla de config_negocio';

-- Índice para filtrar vendedores externos rápidamente
CREATE INDEX IF NOT EXISTS idx_usuarios_markup ON usuarios(markup_pct) WHERE markup_pct IS NOT NULL;

-- También añadir canal_venta a cotizaciones para trazabilidad histórica
ALTER TABLE cotizaciones
  ADD COLUMN IF NOT EXISTS canal_venta TEXT DEFAULT 'interno'
    CHECK (canal_venta IN ('interno', 'externo'));

COMMENT ON COLUMN cotizaciones.canal_venta IS 'Canal de venta: interno (vendedor directo) o externo (vendedor con markup)';

CREATE INDEX IF NOT EXISTS idx_cotizaciones_canal ON cotizaciones(canal_venta);
