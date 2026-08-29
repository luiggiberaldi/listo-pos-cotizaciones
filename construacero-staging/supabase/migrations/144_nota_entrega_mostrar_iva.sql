-- 144_nota_entrega_mostrar_iva.sql
-- Agrega columna para activar/desactivar el IVA en la nota de entrega.
-- Por defecto TRUE (comportamiento anterior conservado).

ALTER TABLE public.configuracion_negocio
  ADD COLUMN IF NOT EXISTS nota_entrega_mostrar_iva BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.configuracion_negocio.nota_entrega_mostrar_iva
  IS 'Si es TRUE, el PDF de la nota de entrega incluye la fila de IVA. Si es FALSE, la omite.';
