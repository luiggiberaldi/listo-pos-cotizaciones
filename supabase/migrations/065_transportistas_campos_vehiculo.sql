-- 065_transportistas_campos_vehiculo.sql
-- Agrega columnas que el frontend ya usa pero no existían en la tabla original
ALTER TABLE public.transportistas ADD COLUMN IF NOT EXISTS color TEXT;
ALTER TABLE public.transportistas ADD COLUMN IF NOT EXISTS vehiculo TEXT;
ALTER TABLE public.transportistas ADD COLUMN IF NOT EXISTS placa_chuto TEXT;
ALTER TABLE public.transportistas ADD COLUMN IF NOT EXISTS placa_batea TEXT;
