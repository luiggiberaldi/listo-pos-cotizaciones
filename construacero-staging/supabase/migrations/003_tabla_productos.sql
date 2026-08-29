-- 003_tabla_productos.sql
CREATE TABLE public.productos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo         TEXT,
  nombre         TEXT NOT NULL CHECK (char_length(trim(nombre)) > 0),
  descripcion    TEXT,
  categoria      TEXT,
  unidad         TEXT NOT NULL DEFAULT 'und',
  precio_usd     NUMERIC(12,4) NOT NULL DEFAULT 0 CHECK (precio_usd >= 0),
  -- precio_bs se calcula en frontend: precio_usd * tasa_bcv_actual
  -- NO se almacena precio_bs para evitar inconsistencias con tasas cambiantes
  costo_usd      NUMERIC(12,4) CHECK (costo_usd >= 0),
  -- costo_usd visible SOLO para supervisores (ver vista v_productos_vendedor)
  stock_actual   NUMERIC(10,2) NOT NULL DEFAULT 0,
  stock_minimo   NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (stock_minimo >= 0),
  imagen_url     TEXT,
  activo         BOOLEAN NOT NULL DEFAULT true,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_productos_nombre_fts
  ON public.productos USING gin(to_tsvector('spanish', nombre));
CREATE INDEX idx_productos_categoria ON public.productos(categoria);
CREATE INDEX idx_productos_activo ON public.productos(activo) WHERE activo = true;
CREATE UNIQUE INDEX idx_productos_codigo_unico
  ON public.productos(codigo) WHERE codigo IS NOT NULL AND codigo <> '';

COMMENT ON COLUMN public.productos.costo_usd
  IS 'Costo de compra. SOLO visible para supervisores vía vista v_productos_supervisor';
