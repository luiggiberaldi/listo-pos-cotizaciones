-- 035_comisiones.sql
-- Tabla de comisiones por despacho entregado + config de tasas

-- 1. Agregar columnas de configuración de comisiones
ALTER TABLE public.configuracion_negocio
  ADD COLUMN comision_pct_cabilla   NUMERIC(5,2) NOT NULL DEFAULT 2,
  ADD COLUMN comision_pct_otros     NUMERIC(5,2) NOT NULL DEFAULT 3,
  ADD COLUMN comision_categoria_cabilla TEXT NOT NULL DEFAULT 'Cabilla';

COMMENT ON COLUMN public.configuracion_negocio.comision_pct_cabilla
  IS 'Porcentaje de comisión para productos de la categoría cabilla';
COMMENT ON COLUMN public.configuracion_negocio.comision_pct_otros
  IS 'Porcentaje de comisión para productos de otras categorías';
COMMENT ON COLUMN public.configuracion_negocio.comision_categoria_cabilla
  IS 'Nombre de la categoría considerada cabilla (match case-insensitive)';

-- 2. Tabla de comisiones
CREATE TABLE public.comisiones (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  despacho_id      UUID NOT NULL UNIQUE REFERENCES public.notas_despacho(id) ON DELETE RESTRICT,
  vendedor_id      UUID NOT NULL REFERENCES public.usuarios(id),
  cotizacion_id    UUID NOT NULL REFERENCES public.cotizaciones(id),

  -- Montos base (subtotales de la cotización por categoría)
  monto_cabilla    NUMERIC(12,2) NOT NULL DEFAULT 0,
  monto_otros      NUMERIC(12,2) NOT NULL DEFAULT 0,

  -- Snapshot de tasas al momento del cálculo
  pct_cabilla      NUMERIC(5,2) NOT NULL,
  pct_otros        NUMERIC(5,2) NOT NULL,

  -- Comisiones calculadas
  comision_cabilla NUMERIC(12,2) NOT NULL DEFAULT 0,
  comision_otros   NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_comision   NUMERIC(12,2) NOT NULL DEFAULT 0,

  -- Estado de pago
  estado           TEXT NOT NULL DEFAULT 'pendiente'
                   CHECK (estado IN ('pendiente', 'pagada')),
  pagada_en        TIMESTAMPTZ,
  pagada_por       UUID REFERENCES public.usuarios(id),

  -- Timestamps
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_comisiones_vendedor ON public.comisiones(vendedor_id);
CREATE INDEX idx_comisiones_estado   ON public.comisiones(estado);
CREATE INDEX idx_comisiones_creado   ON public.comisiones(creado_en DESC);

COMMENT ON TABLE public.comisiones
  IS 'Comisiones calculadas por despacho entregado. Una por despacho (UNIQUE).';

-- 3. RLS
ALTER TABLE public.comisiones ENABLE ROW LEVEL SECURITY;

-- Vendedor ve sus propias comisiones, supervisor ve todas
CREATE POLICY "comisiones_select" ON public.comisiones
  FOR SELECT USING (
    vendedor_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.usuarios
      WHERE id = auth.uid() AND rol = 'supervisor' AND activo = true
    )
  );

-- No INSERT/UPDATE/DELETE directo — solo vía RPCs
-- (Las RPCs usan SECURITY DEFINER que bypasea RLS)

-- 4. Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.comisiones;
