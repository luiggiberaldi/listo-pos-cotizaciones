-- 296_staging_peso_lineas_y_despacho.sql  (Fase 2 del plan de peso por artículo)
-- 1) Cada línea de cotización y de despacho copia el peso por unidad del producto AL CREARSE (así cambiar el peso
--    del producto después no altera documentos viejos). Lo hace la base de datos, para cubrir todas las rutas.
-- 2) Vistas de solo lectura con el peso por línea y el peso total de cada despacho. En despachos abiertos
--    (pendiente / despachada) las líneas sin copia usan el peso actual del producto; en los cerrados solo la copia.
-- No modifica filas existentes. Rollback: 296_staging_peso_lineas_y_despacho_rollback.sql
BEGIN;

ALTER TABLE public.cotizacion_items       ADD COLUMN IF NOT EXISTS peso_unit_kg_snap numeric(10,3);
ALTER TABLE public.notas_despacho_items   ADD COLUMN IF NOT EXISTS peso_unit_kg_snap numeric(10,3);

CREATE OR REPLACE FUNCTION public.tg_fijar_peso_linea()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.peso_unit_kg_snap IS NULL AND NEW.producto_id IS NOT NULL THEN
    SELECT p.peso_kg INTO NEW.peso_unit_kg_snap FROM public.productos p WHERE p.id = NEW.producto_id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_fijar_peso_linea() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_fijar_peso_linea ON public.cotizacion_items;
CREATE TRIGGER trg_fijar_peso_linea BEFORE INSERT ON public.cotizacion_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_fijar_peso_linea();
DROP TRIGGER IF EXISTS trg_fijar_peso_linea ON public.notas_despacho_items;
CREATE TRIGGER trg_fijar_peso_linea BEFORE INSERT ON public.notas_despacho_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_fijar_peso_linea();

-- Peso actual de un producto de MI cuenta (cualquier rol lo puede consultar; no es un dato sensible)
CREATE OR REPLACE FUNCTION public.peso_producto_visible(p_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$ SELECT p.peso_kg FROM public.productos p WHERE p.id = p_id AND p.cuenta_id = auth.uid() $$;
REVOKE ALL ON FUNCTION public.peso_producto_visible(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.peso_producto_visible(uuid) TO authenticated, service_role;

CREATE OR REPLACE VIEW public.despacho_items_peso WITH (security_invoker = true) AS
SELECT i.id AS item_id, i.despacho_id, i.producto_id, i.cantidad,
       w.peso_unit_kg,
       (i.cantidad * w.peso_unit_kg)::numeric(14,3) AS peso_linea_kg
FROM public.notas_despacho_items i
JOIN public.notas_despacho d ON d.id = i.despacho_id
CROSS JOIN LATERAL (
  SELECT COALESCE(i.peso_unit_kg_snap,
                  CASE WHEN d.estado IN ('pendiente', 'despachada') THEN public.peso_producto_visible(i.producto_id) END) AS peso_unit_kg
) w;

CREATE OR REPLACE VIEW public.despacho_pesos WITH (security_invoker = true) AS
SELECT despacho_id,
       COALESCE(SUM(peso_linea_kg), 0)::numeric(14,3) AS peso_total_kg,
       (COUNT(*) FILTER (WHERE peso_unit_kg IS NULL))::int AS items_sin_peso,
       COUNT(*)::int AS items_total
FROM public.despacho_items_peso
GROUP BY despacho_id;

REVOKE ALL ON public.despacho_items_peso, public.despacho_pesos FROM PUBLIC, anon;
GRANT SELECT ON public.despacho_items_peso, public.despacho_pesos TO authenticated, service_role;

COMMIT;
