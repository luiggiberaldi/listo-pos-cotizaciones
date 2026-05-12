-- 068: Tabla de descuentos por artículo en despachos
-- Solo logística/supervisor/desarrollador pueden aplicar descuentos a ítems de un despacho

-- ─── Nueva tabla despacho_descuentos ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.despacho_descuentos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  despacho_id   UUID NOT NULL REFERENCES public.notas_despacho(id) ON DELETE CASCADE,
  cotizacion_item_id UUID NOT NULL REFERENCES public.cotizacion_items(id) ON DELETE CASCADE,
  tipo          TEXT NOT NULL CHECK (tipo IN ('porcentaje', 'monto')),
  valor         NUMERIC(12,4) NOT NULL CHECK (valor > 0),
  monto_usd     NUMERIC(12,4) NOT NULL CHECK (monto_usd >= 0),
  aplicado_por  UUID NOT NULL REFERENCES public.usuarios(id),
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (despacho_id, cotizacion_item_id)
);

CREATE INDEX IF NOT EXISTS idx_despacho_descuentos_despacho
  ON public.despacho_descuentos(despacho_id);

-- ─── Nuevo campo en notas_despacho ───────────────────────────────────────────
ALTER TABLE public.notas_despacho
  ADD COLUMN IF NOT EXISTS descuento_total_usd NUMERIC(12,4) NOT NULL DEFAULT 0;

-- ─── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.despacho_descuentos ENABLE ROW LEVEL SECURITY;

-- SELECT: logistica, supervisor, desarrollador y vendedor dueño
CREATE POLICY descuentos_supervisor_all ON public.despacho_descuentos
  FOR ALL
  USING (public.get_rol_actual() IN ('supervisor', 'desarrollador'));

CREATE POLICY descuentos_logistica_all ON public.despacho_descuentos
  FOR ALL
  USING (public.get_rol_actual() = 'logistica');

CREATE POLICY descuentos_vendedor_select ON public.despacho_descuentos
  FOR SELECT
  USING (
    public.get_rol_actual() = 'vendedor'
    AND despacho_id IN (
      SELECT id FROM public.notas_despacho WHERE vendedor_id = auth.uid()
    )
  );

CREATE POLICY descuentos_admin_select ON public.despacho_descuentos
  FOR SELECT
  USING (public.get_rol_actual() = 'administracion');
