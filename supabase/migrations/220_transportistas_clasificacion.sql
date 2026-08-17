-- 220_transportistas_clasificacion.sql
-- Separa la clasificación operativa (es_local) de la relación legal.

ALTER TABLE public.transportistas
  ADD COLUMN IF NOT EXISTS tipo_relacion TEXT NOT NULL DEFAULT 'proveedor',
  ADD COLUMN IF NOT EXISTS empleado_id UUID REFERENCES public.clientes(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS fecha_inicio_relacion DATE,
  ADD COLUMN IF NOT EXISTS fecha_fin_relacion DATE,
  ADD COLUMN IF NOT EXISTS emite_comprobante BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'transportistas_tipo_relacion_check'
      AND conrelid = 'public.transportistas'::regclass
  ) THEN
    ALTER TABLE public.transportistas
      ADD CONSTRAINT transportistas_tipo_relacion_check
      CHECK (tipo_relacion IN ('empleado', 'contratista', 'proveedor', 'propio'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_transportistas_cuenta_relacion
  ON public.transportistas(cuenta_id, tipo_relacion, activo);

CREATE UNIQUE INDEX IF NOT EXISTS uq_transportistas_empleado_por_cuenta
  ON public.transportistas(cuenta_id, empleado_id)
  WHERE empleado_id IS NOT NULL;

COMMENT ON COLUMN public.transportistas.es_local IS
  'Clasificación operativa del flete. No determina si la persona es empleado.';
COMMENT ON COLUMN public.transportistas.tipo_relacion IS
  'Relación legal/operativa: empleado, contratista, proveedor o propio.';
