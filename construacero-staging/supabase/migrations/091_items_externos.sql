-- Migration 091: Soporte para productos externos en cotizaciones

-- 1. Agregar columna origen
ALTER TABLE public.cotizacion_items 
ADD COLUMN origen text NOT NULL DEFAULT 'inventario';

-- 2. Asegurar que los valores permitidos sean correctos
ALTER TABLE public.cotizacion_items 
ADD CONSTRAINT cot_items_origen_check 
CHECK (origen IN ('inventario', 'externo'));

-- 3. Asegurar que los items externos no apunten a productos del inventario
ALTER TABLE public.cotizacion_items 
ADD CONSTRAINT cot_items_externo_prod_check 
CHECK (
  (origen = 'inventario') OR 
  (origen = 'externo' AND producto_id IS NULL)
);

COMMENT ON COLUMN public.cotizacion_items.origen IS 'Define si el ítem proviene del catálogo (inventario) o fue agregado manualmente (externo). Los externos no afectan stock.';
