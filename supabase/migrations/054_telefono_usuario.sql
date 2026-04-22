-- Agregar número de teléfono a usuarios
ALTER TABLE public.usuarios
  ADD COLUMN telefono TEXT DEFAULT NULL;

COMMENT ON COLUMN public.usuarios.telefono IS 'Número de teléfono del usuario';
