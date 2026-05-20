-- 145_nota_entrega_plantilla.sql
-- Agrega columna para elegir la plantilla de la nota de entrega.
-- Por defecto 'estandar' (con header/footer/watermark).

ALTER TABLE public.configuracion_negocio
  ADD COLUMN IF NOT EXISTS nota_entrega_plantilla TEXT NOT NULL DEFAULT 'estandar';

COMMENT ON COLUMN public.configuracion_negocio.nota_entrega_plantilla
  IS 'Define el diseño del PDF de la nota de entrega: ''estandar'' o ''membrete''.';
