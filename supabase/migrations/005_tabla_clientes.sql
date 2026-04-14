-- 005_tabla_clientes.sql
CREATE TABLE public.clientes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Datos del cliente
  nombre          TEXT NOT NULL CHECK (char_length(trim(nombre)) > 0),
  rif_cedula      TEXT,
  telefono        TEXT,
  email           TEXT,
  direccion       TEXT,
  notas           TEXT,

  -- Control de asignación (núcleo del anti-robo)
  vendedor_id     UUID NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  asignado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Metadatos de última reasignación (desnormalizados para consulta rápida)
  -- El historial completo vive en reasignaciones_clientes
  ultima_reasig_por  UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  ultima_reasig_motivo TEXT,
  ultima_reasig_en    TIMESTAMPTZ,

  -- Metadatos
  activo          BOOLEAN NOT NULL DEFAULT true,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices
CREATE INDEX idx_clientes_vendedor ON public.clientes(vendedor_id);
CREATE INDEX idx_clientes_activo ON public.clientes(activo) WHERE activo = true;

-- RIF único (solo cuando tiene valor — NULL no viola la unicidad)
CREATE UNIQUE INDEX idx_clientes_rif_unico
  ON public.clientes(rif_cedula)
  WHERE rif_cedula IS NOT NULL AND trim(rif_cedula) <> '';

COMMENT ON COLUMN public.clientes.vendedor_id
  IS 'Propietario del cliente. Solo modificable vía RPC reasignar_cliente()';
