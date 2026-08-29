-- 052_cuentas_por_cobrar.sql
-- Sistema de cuentas por cobrar (crédito a clientes)
-- Tabla estilo libro contable: cada cargo (deuda) y abono (pago) es una fila

-- ── Tabla principal ─────────────────────────────────────────────────────────
CREATE TABLE public.cuentas_por_cobrar (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id      UUID NOT NULL REFERENCES public.clientes(id) ON DELETE RESTRICT,
  despacho_id     UUID REFERENCES public.notas_despacho(id) ON DELETE RESTRICT,

  -- 'cargo' = deuda generada por despacho a crédito
  -- 'abono' = pago recibido del cliente
  tipo            TEXT NOT NULL CHECK (tipo IN ('cargo', 'abono')),

  -- Monto siempre positivo; tipo determina el signo contable
  monto_usd       NUMERIC(12,4) NOT NULL CHECK (monto_usd > 0),

  -- Saldo acumulado del cliente DESPUÉS de esta transacción
  saldo_usd       NUMERIC(12,4) NOT NULL,

  -- Metadata de pago (solo para abonos)
  forma_pago_abono TEXT,
  referencia       TEXT,

  -- Descripción legible
  descripcion      TEXT NOT NULL,

  -- Auditoría
  registrado_por   UUID NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices
CREATE INDEX idx_cxc_cliente  ON public.cuentas_por_cobrar(cliente_id);
CREATE INDEX idx_cxc_despacho ON public.cuentas_por_cobrar(despacho_id);
CREATE INDEX idx_cxc_tipo     ON public.cuentas_por_cobrar(tipo);
CREATE INDEX idx_cxc_fecha    ON public.cuentas_por_cobrar(creado_en DESC);

-- ── Columna denormalizada en clientes ───────────────────────────────────────
ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS saldo_pendiente NUMERIC(12,4) NOT NULL DEFAULT 0;

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.cuentas_por_cobrar ENABLE ROW LEVEL SECURITY;

-- Supervisor ve todo
CREATE POLICY cxc_supervisor_all ON public.cuentas_por_cobrar
  FOR ALL USING (public.get_rol_actual() = 'supervisor');

-- Vendedor ve las de sus clientes (solo lectura)
CREATE POLICY cxc_vendedor_select ON public.cuentas_por_cobrar
  FOR SELECT USING (
    cliente_id IN (
      SELECT id FROM public.clientes WHERE vendedor_id = auth.uid()
    )
  );
