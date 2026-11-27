-- Rollback de 324_staging_stock_por_aprobar.sql (OP-2026-087)
BEGIN;
DROP FUNCTION IF EXISTS public.obtener_stock_por_aprobar();
DROP FUNCTION IF EXISTS public.obtener_stock_por_aprobar_detalle(UUID);
COMMIT;
