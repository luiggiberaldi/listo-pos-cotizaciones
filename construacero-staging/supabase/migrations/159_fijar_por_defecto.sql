-- 159_fijar_por_defecto.sql
-- Cambiar el valor por defecto de la columna 'fijada' a true en la tabla 'seguimiento_operativo'

ALTER TABLE public.seguimiento_operativo ALTER COLUMN fijada SET DEFAULT true;
