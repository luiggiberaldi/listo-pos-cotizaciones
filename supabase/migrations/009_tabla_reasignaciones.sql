-- 009_tabla_reasignaciones.sql
CREATE TABLE public.reasignaciones_clientes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id       UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  vendedor_origen  UUID NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  vendedor_destino UUID NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  supervisor_id    UUID NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  motivo           TEXT NOT NULL CHECK (char_length(trim(motivo)) >= 10),
  -- Mínimo 10 caracteres para forzar motivos descriptivos
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_reasig_cliente ON public.reasignaciones_clientes(cliente_id);
CREATE INDEX idx_reasig_supervisor ON public.reasignaciones_clientes(supervisor_id);

COMMENT ON COLUMN public.reasignaciones_clientes.motivo
  IS 'Mínimo 10 caracteres. Evita motivos como "x" o "na".';
