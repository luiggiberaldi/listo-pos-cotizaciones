-- 097_tabla_notas_despacho_items.sql
-- Tabla para los ítems de las notas de despacho (Snapshots independientes de la cotización)

CREATE TABLE public.notas_despacho_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  despacho_id      UUID NOT NULL
                   REFERENCES public.notas_despacho(id) ON DELETE CASCADE,

  -- Snapshot del producto al momento de despachar
  producto_id      UUID REFERENCES public.productos(id) ON DELETE SET NULL,
  codigo_snap      TEXT,
  nombre_snap      TEXT NOT NULL CHECK (char_length(trim(nombre_snap)) > 0),
  unidad_snap      TEXT NOT NULL DEFAULT 'und',

  -- Cantidades y precios (independientes de la cotización original)
  cantidad         NUMERIC(10,2) NOT NULL CHECK (cantidad >= 0),
  precio_unit_usd  NUMERIC(12,4) NOT NULL CHECK (precio_unit_usd >= 0),
  descuento_pct    NUMERIC(5,2) NOT NULL DEFAULT 0
                   CHECK (descuento_pct >= 0 AND descuento_pct <= 100),
  total_linea_usd  NUMERIC(12,4) NOT NULL CHECK (total_linea_usd >= 0),

  -- Orden visual
  orden            INTEGER NOT NULL DEFAULT 0
);

-- ─── Índices ────────────────────────────────────────────────────────────────────
CREATE INDEX idx_items_despacho ON public.notas_despacho_items(despacho_id);

-- ─── RLS ────────────────────────────────────────────────────────────────────────
ALTER TABLE public.notas_despacho_items ENABLE ROW LEVEL SECURITY;

-- Vendedor ve los ítems de sus propios despachos
CREATE POLICY items_despacho_vendedor_select ON public.notas_despacho_items
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.notas_despacho d
      WHERE d.id = despacho_id AND d.vendedor_id = auth.uid()
    )
  );

-- Supervisor y Administración ven todos
CREATE POLICY items_despacho_admin_select ON public.notas_despacho_items
  FOR SELECT
  USING (public.get_rol_actual() IN ('supervisor', 'administracion', 'jefe', 'logistica'));

-- Solo el sistema (vía RPC Security Definer) o admin puede modificar ítems directamente
-- (La edición a profundidad se manejará vía RPC para asegurar inventario)

-- ─── Realtime ───────────────────────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE public.notas_despacho_items;

COMMENT ON TABLE public.notas_despacho_items IS 'Artículos que componen un despacho. Desacoplados de la cotización para permitir edición administrativa.';
