-- 316_prod_stock_por_aprobar_rollback.sql — Vuelta atrás de 316
BEGIN;
DROP FUNCTION IF EXISTS public.obtener_stock_por_aprobar();
DROP FUNCTION IF EXISTS public.obtener_stock_por_aprobar_detalle(uuid);
COMMIT;
