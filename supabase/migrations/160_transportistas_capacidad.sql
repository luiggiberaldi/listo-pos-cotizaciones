-- 160_transportistas_capacidad.sql
-- Añadir columna de capacidad a la tabla de transportistas
ALTER TABLE public.transportistas ADD COLUMN IF NOT EXISTS capacidad TEXT;
