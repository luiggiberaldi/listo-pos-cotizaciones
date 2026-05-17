-- 132_unificar_categorias.sql
-- Unificar categoría "cabillas s60" a "Cabilla" (o "Cabillas")
-- Como las categorías se extraen con SELECT DISTINCT, al actualizar los productos,
-- la categoría anterior desaparece automáticamente si ningún producto la usa.

-- Actualizar los productos que tengan la categoría "CABILLAS S60" (insensible a mayúsculas)
UPDATE public.productos
SET categoria = 'Cabillas'
WHERE categoria ILIKE '%cabillas s60%';

-- Opcional: Estandarizar a "Cabilla" si la mayoría está en singular (común en el sistema)
UPDATE public.productos
SET categoria = 'Cabilla'
WHERE categoria ILIKE 'Cabillas';
