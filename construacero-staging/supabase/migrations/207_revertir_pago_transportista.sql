-- supabase/migrations/207_revertir_pago_transportista.sql
-- Soporte para reversa de pagos a transportistas locales.
-- Vincula cada pago con los despachos que marcó, permitiendo revertir
-- de forma precisa sin afectar otros pagos.

-- 1. Tabla join: qué despachos se marcaron en cada liquidación FIFO
CREATE TABLE IF NOT EXISTS pagos_transportistas_despachos (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pago_id      UUID NOT NULL REFERENCES pagos_transportistas(id) ON DELETE CASCADE,
  despacho_id  UUID NOT NULL REFERENCES notas_despacho(id),
  neto_usd     NUMERIC(12,4) NOT NULL DEFAULT 0,
  creado_en    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (pago_id, despacho_id)
);

CREATE INDEX IF NOT EXISTS idx_ptd_pago_id ON pagos_transportistas_despachos(pago_id);

-- RLS: misma política que pagos_transportistas (admin/dev/logística leen, service_role escribe)
ALTER TABLE pagos_transportistas_despachos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lectura_autenticados" ON pagos_transportistas_despachos
  FOR SELECT TO authenticated USING (true);

-- 2. Columnas de reversión en pagos_transportistas
ALTER TABLE pagos_transportistas
  ADD COLUMN IF NOT EXISTS revertido             BOOLEAN   NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS revertido_en          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revertido_por         UUID REFERENCES usuarios(id),
  ADD COLUMN IF NOT EXISTS revertido_por_nombre  TEXT;
