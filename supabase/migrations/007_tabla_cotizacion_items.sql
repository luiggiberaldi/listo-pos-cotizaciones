-- 007_tabla_cotizacion_items.sql
CREATE TABLE public.cotizacion_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cotizacion_id    UUID NOT NULL
                   REFERENCES public.cotizaciones(id) ON DELETE CASCADE,

  -- Snapshot del producto al momento de cotizar
  -- producto_id es referencial pero el precio real es el snapshot
  producto_id      UUID REFERENCES public.productos(id) ON DELETE SET NULL,
  codigo_snap      TEXT,
  nombre_snap      TEXT NOT NULL CHECK (char_length(trim(nombre_snap)) > 0),
  unidad_snap      TEXT NOT NULL DEFAULT 'und',

  -- Cantidades y precios
  cantidad         NUMERIC(10,2) NOT NULL CHECK (cantidad > 0),
  precio_unit_usd  NUMERIC(12,4) NOT NULL CHECK (precio_unit_usd >= 0),
  descuento_pct    NUMERIC(5,2) NOT NULL DEFAULT 0
                   CHECK (descuento_pct >= 0 AND descuento_pct <= 100),
  total_linea_usd  NUMERIC(12,4) NOT NULL CHECK (total_linea_usd >= 0),
  -- total_linea_usd = cantidad * precio_unit_usd * (1 - descuento_pct/100)

  -- Orden visual en la cotización
  orden            INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_items_cotizacion ON public.cotizacion_items(cotizacion_id);

COMMENT ON COLUMN public.cotizacion_items.producto_id
  IS 'Referencia al catálogo. Puede ser NULL si el producto fue eliminado.';
COMMENT ON COLUMN public.cotizacion_items.nombre_snap
  IS 'Nombre del producto al momento de cotizar. No cambia si el catálogo cambia.';
