-- 004_tabla_transportistas.sql
CREATE TABLE public.transportistas (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre         TEXT NOT NULL CHECK (char_length(trim(nombre)) > 0),
  rif            TEXT,
  telefono       TEXT,
  zona_cobertura TEXT,
  tarifa_base    NUMERIC(12,2) DEFAULT 0 CHECK (tarifa_base >= 0),
  notas          TEXT,
  activo         BOOLEAN NOT NULL DEFAULT true,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  creado_por     UUID REFERENCES public.usuarios(id) ON DELETE SET NULL
);
