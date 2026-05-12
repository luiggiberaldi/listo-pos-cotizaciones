-- 042_comision_extras_column.sql
-- Add _comision_extras JSONB column to store additional commission category configs

ALTER TABLE public.configuracion_negocio
  ADD COLUMN IF NOT EXISTS _comision_extras JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.configuracion_negocio._comision_extras
  IS 'JSON array of extra commission categories: [{cat: "Cemento", pct: 5}, ...]';
