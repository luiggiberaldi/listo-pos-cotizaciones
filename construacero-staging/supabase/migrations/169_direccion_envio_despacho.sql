-- Agregar columnas de dirección de envío a la tabla notas_despacho
ALTER TABLE public.notas_despacho
  ADD COLUMN IF NOT EXISTS direccion_envio_direccion TEXT,
  ADD COLUMN IF NOT EXISTS direccion_envio_ciudad TEXT,
  ADD COLUMN IF NOT EXISTS direccion_envio_estado TEXT;

-- Comentarios explicativos
COMMENT ON COLUMN public.notas_despacho.direccion_envio_direccion IS 'Dirección específica de entrega si difiere de la dirección fiscal';
COMMENT ON COLUMN public.notas_despacho.direccion_envio_ciudad IS 'Ciudad de destino del envío';
COMMENT ON COLUMN public.notas_despacho.direccion_envio_estado IS 'Estado de destino del envío';
