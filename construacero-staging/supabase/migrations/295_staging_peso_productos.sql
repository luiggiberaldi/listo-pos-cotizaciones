-- 295_staging_peso_productos.sql  (Fase 1 del plan de peso por artículo)
-- Agrega el peso por unidad de cada producto, en kilogramos (100 g = 0.1 kg). Es opcional: NULL = "sin peso cargado".
-- Lo cargan a mano administración, jefe o desarrollador (el servidor lo valida). No toca datos existentes.
-- Rollback: 295_staging_peso_productos_rollback.sql
BEGIN;

ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS peso_kg numeric(10,3);

ALTER TABLE public.productos
  DROP CONSTRAINT IF EXISTS productos_peso_kg_rango;
ALTER TABLE public.productos
  ADD CONSTRAINT productos_peso_kg_rango CHECK (peso_kg IS NULL OR (peso_kg >= 0 AND peso_kg <= 100000));

COMMENT ON COLUMN public.productos.peso_kg IS 'Peso de UNA unidad de venta del producto, en kilogramos (100 g = 0.1 kg). NULL = sin peso cargado.';

COMMIT;
