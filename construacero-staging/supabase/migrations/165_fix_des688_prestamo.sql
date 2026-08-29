-- supabase/migrations/165_fix_des688_prestamo.sql
-- Corregir el despacho DES-00688 que fue creado antes de aplicar la migración de préstamos.
-- El ítem (Cemento Gris) debe quedar como es_prestamo=TRUE con total $0

-- 1. Actualizar el ítem del despacho
UPDATE public.notas_despacho_items
SET 
  es_prestamo = TRUE,
  total_linea_usd = 0
WHERE despacho_id = '45f4b38e-30d7-4196-a8db-fb74caa5bf92'
  AND nombre_snap ILIKE '%CEMENTO GRIS%';

-- 2. Actualizar el total del despacho a 0 (préstamo puro) y marcar tiene_prestamos
UPDATE public.notas_despacho
SET 
  total_usd = 0,
  tiene_prestamos = TRUE
WHERE id = '45f4b38e-30d7-4196-a8db-fb74caa5bf92';

-- 3. Backfill general: por si hay otros despachos cuyo tiene_prestamos no está sincronizado
UPDATE public.notas_despacho nd
SET tiene_prestamos = EXISTS (
  SELECT 1 FROM public.notas_despacho_items ndi
  WHERE ndi.despacho_id = nd.id
    AND ndi.es_prestamo = TRUE
);

-- 4. Verificar resultado
SELECT 
  nd.numero, nd.estado, nd.total_usd, nd.tiene_prestamos,
  ndi.nombre_snap, ndi.es_prestamo, ndi.total_linea_usd
FROM public.notas_despacho nd
JOIN public.notas_despacho_items ndi ON ndi.despacho_id = nd.id
WHERE nd.tiene_prestamos = TRUE
ORDER BY nd.numero DESC;
