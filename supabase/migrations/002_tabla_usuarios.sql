-- 002_tabla_usuarios.sql
CREATE TABLE public.usuarios (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL CHECK (char_length(trim(nombre)) > 0),
  rol         TEXT NOT NULL CHECK (rol IN ('supervisor', 'vendedor')),
  activo      BOOLEAN NOT NULL DEFAULT true,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  creado_por  UUID REFERENCES public.usuarios(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.usuarios IS 'Extensión de auth.users con datos de rol y negocio';
COMMENT ON COLUMN public.usuarios.creado_por IS 'Supervisor que creó este usuario';
