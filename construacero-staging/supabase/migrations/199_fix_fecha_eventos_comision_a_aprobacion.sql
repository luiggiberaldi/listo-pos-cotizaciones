-- 199: re-fechar los eventos de liberación de comisiones a la fecha REAL de aprobación
--
-- PROBLEMA:
--   Los reportes de comisiones fechean por `comision_liberaciones.creado_en` (fecha de
--   liberación/recaudo). La migración 192 (backfill de clientes saldados) insertó sus
--   eventos SIN especificar `creado_en`, por lo que tomaron el DEFAULT now() = el día en
--   que corrió el backfill. Resultado: despachos antiguos (p.ej. #217, #530) aparecen en
--   el período en que se ejecutó la 192, no en el período de su venta/aprobación.
--
-- REGLA CORRECTA (definida con negocio):
--   La comisión debe contar en la fecha REAL de aprobación del despacho (`despachada_en`),
--   que es cuando se registra la comisión. No por fecha de liberación ni de recaudo.
--
-- FIX:
--   Re-fechar TODOS los eventos de comision_liberaciones a la aprobación de su despacho:
--     COALESCE(nd.despachada_en, nd.entregada_en, nd.creado_en)
--   Así el reporte por evento queda fechado por aprobación. Idempotente.

UPDATE public.comision_liberaciones cl
SET creado_en = COALESCE(nd.despachada_en, nd.entregada_en, nd.creado_en)
FROM public.comisiones c
JOIN public.notas_despacho nd ON nd.id = c.despachoid
WHERE cl.comision_id = c.id
  AND cl.creado_en IS DISTINCT FROM COALESCE(nd.despachada_en, nd.entregada_en, nd.creado_en);

NOTIFY pgrst, 'reload schema';
