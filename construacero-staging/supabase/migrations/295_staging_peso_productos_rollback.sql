-- 295_staging_peso_productos_rollback.sql
-- Quita la columna de peso (se pierden los pesos cargados).
BEGIN;
ALTER TABLE public.productos DROP CONSTRAINT IF EXISTS productos_peso_kg_rango;
ALTER TABLE public.productos DROP COLUMN IF EXISTS peso_kg;
COMMIT;
