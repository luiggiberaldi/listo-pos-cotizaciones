-- 021_tabla_notas_despacho.sql
-- Tabla para notas de despacho — cotizaciones aceptadas que pasan a despacho
-- El stock se descuenta al crear la nota (via RPC crear_nota_despacho)

CREATE TABLE public.notas_despacho (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero           INTEGER GENERATED ALWAYS AS IDENTITY,

  -- Referencia a la cotización aceptada (1:1)
  cotizacion_id    UUID NOT NULL UNIQUE
                     REFERENCES public.cotizaciones(id) ON DELETE RESTRICT,

  -- Desnormalizados para RLS y consultas rápidas
  cliente_id       UUID NOT NULL
                     REFERENCES public.clientes(id) ON DELETE RESTRICT,
  vendedor_id      UUID NOT NULL
                     REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  transportista_id UUID
                     REFERENCES public.transportistas(id) ON DELETE SET NULL,

  -- Estado del despacho
  estado           TEXT NOT NULL DEFAULT 'pendiente'
                     CHECK (estado IN ('pendiente','despachada','entregada','anulada')),

  -- Totales (copiados de la cotización)
  total_usd        NUMERIC(12,4) NOT NULL CHECK (total_usd >= 0),

  -- Observaciones
  notas            TEXT,

  -- Quién creó la nota
  creado_por       UUID NOT NULL
                     REFERENCES public.usuarios(id) ON DELETE RESTRICT,

  -- Timestamps
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
  despachada_en    TIMESTAMPTZ,
  entregada_en     TIMESTAMPTZ
);

-- ─── Índices ────────────────────────────────────────────────────────────────────
CREATE INDEX idx_despachos_vendedor ON public.notas_despacho(vendedor_id);
CREATE INDEX idx_despachos_estado   ON public.notas_despacho(estado);
CREATE INDEX idx_despachos_numero   ON public.notas_despacho(numero DESC);

-- ─── Trigger updated_at ─────────────────────────────────────────────────────────
CREATE TRIGGER trg_despachos_updated
  BEFORE UPDATE ON public.notas_despacho
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── RLS ────────────────────────────────────────────────────────────────────────
ALTER TABLE public.notas_despacho ENABLE ROW LEVEL SECURITY;

-- Vendedor ve solo sus despachos
CREATE POLICY despachos_vendedor_select ON public.notas_despacho
  FOR SELECT
  USING (vendedor_id = auth.uid());

-- Supervisor ve todos
CREATE POLICY despachos_supervisor_select ON public.notas_despacho
  FOR SELECT
  USING (public.get_rol_actual() = 'supervisor');

-- Sin INSERT/UPDATE/DELETE directos — todo via RPCs SECURITY DEFINER

-- ─── Realtime ───────────────────────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE public.notas_despacho;
