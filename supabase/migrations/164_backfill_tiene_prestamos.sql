-- supabase/migrations/164_backfill_tiene_prestamos.sql
-- Backfill: actualizar tiene_prestamos en todos los despachos existentes
-- basándose en si algún ítem tiene es_prestamo = TRUE

-- 1. Actualizar tiene_prestamos para todos los despachos que tienen ítems en préstamo
UPDATE public.notas_despacho nd
SET tiene_prestamos = EXISTS (
  SELECT 1 FROM public.notas_despacho_items ndi
  WHERE ndi.despacho_id = nd.id
    AND ndi.es_prestamo = TRUE
)
WHERE id IN (
  SELECT DISTINCT despacho_id FROM public.notas_despacho_items
);

-- 2. Verificar resultado (muestra despachos con préstamos)
SELECT 
  nd.id,
  nd.numero,
  nd.estado,
  nd.tiene_prestamos,
  COUNT(ndi.id) FILTER (WHERE ndi.es_prestamo = TRUE) AS items_prestamo,
  COUNT(ndi.id) AS items_total
FROM public.notas_despacho nd
LEFT JOIN public.notas_despacho_items ndi ON ndi.despacho_id = nd.id
GROUP BY nd.id, nd.numero, nd.estado, nd.tiene_prestamos
HAVING COUNT(ndi.id) FILTER (WHERE ndi.es_prestamo = TRUE) > 0
ORDER BY nd.numero DESC;
