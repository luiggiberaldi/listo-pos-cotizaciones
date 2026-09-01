-- 133_add_codigo_to_usuarios.sql
-- Añade columna codigo a public.usuarios e índice único condicional por cuenta

ALTER TABLE public.usuarios 
  ADD COLUMN IF NOT EXISTS codigo TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_usuarios_cuenta_codigo 
  ON public.usuarios (cuenta_id, UPPER(TRIM(codigo))) 
  WHERE codigo IS NOT NULL AND TRIM(codigo) <> '';

COMMENT ON COLUMN public.usuarios.codigo IS 'Código identificador único por empresa (ej. V-01, VEN-02, ADM-01)';
