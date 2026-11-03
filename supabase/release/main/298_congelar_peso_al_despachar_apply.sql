-- 298_congelar_peso_al_despachar_apply.sql — congela el peso de las líneas al despachar/entregar (PRODUCCIÓN).
-- Copia exacta de construacero-staging/supabase/migrations/298_staging_congelar_peso_al_despachar.sql
-- Solo agrega un disparador. Reversa: 298_congelar_peso_al_despachar_rollback_review.sql

-- 298_staging_congelar_peso_al_despachar.sql  (corrección de la Fase 2 del peso)
-- Problema: un despacho creado ANTES de cargar los pesos (o con un producto sin peso al crearse) usaba el peso actual del
-- producto solo mientras estaba pendiente/despachada; al entregarse dejaba de contar y mostraba "sin peso".
-- Corrección: al pasar a "despachada" o "entregada", las líneas que aún no tienen copia de peso toman el peso vigente del
-- producto y quedan congeladas (los cambios posteriores del producto ya no alteran el despacho).
-- No toca despachos ya entregados salvo cuando cambian de estado; no cambia precios, stock ni comisiones.
-- Rollback: 298_staging_congelar_peso_al_despachar_rollback.sql
BEGIN;

CREATE OR REPLACE FUNCTION public.tg_congelar_peso_despacho()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.notas_despacho_items i
     SET peso_unit_kg_snap = p.peso_kg
    FROM public.productos p
   WHERE i.despacho_id = NEW.id
     AND i.peso_unit_kg_snap IS NULL
     AND p.id = i.producto_id
     AND p.peso_kg IS NOT NULL;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_congelar_peso_despacho() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_congelar_peso_despacho ON public.notas_despacho;
CREATE TRIGGER trg_congelar_peso_despacho
  AFTER UPDATE OF estado ON public.notas_despacho
  FOR EACH ROW
  WHEN (NEW.estado IN ('despachada', 'entregada') AND OLD.estado IS DISTINCT FROM NEW.estado)
  EXECUTE FUNCTION public.tg_congelar_peso_despacho();

COMMIT;
