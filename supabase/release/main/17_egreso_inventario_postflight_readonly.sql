-- 17_egreso_inventario_postflight_readonly.sql
-- Release 17 — Postflight SOLO LECTURA. Ejecutar después del apply + backfill
-- y antes del deploy del Worker. Toda la salida debe conservarse como evidencia
-- del cutover (acceptance criteria §5.3 del plan).

-- 1. Funciones vivas con el comentario de propiedad del release (guards del rollback).
SELECT
  p.proname,
  pg_get_function_identity_arguments(p.oid) AS argumentos,
  obj_description(p.oid, 'pg_proc') IS NOT NULL
    AND obj_description(p.oid, 'pg_proc') LIKE 'Main egreso-inventario release 17%' AS comentario_release_17
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'aprobar_despacho_inventario_atomico',
    'confirmar_entrega_inventario_atomica',
    'revertir_entrega_inventario_atomica',
    'revertir_despacho_inventario_atomica',
    'editar_despacho_profundidad'
  )
ORDER BY p.proname, pg_get_function_identity_arguments(p.oid);

-- 2. confirmar_entrega_inventario_atomica ya NO debe tocar productos.stock_actual
--    (la validación textual es una comodidad; la semántica se prueba en el smoke).
SELECT
  p.proname,
  (pg_get_functiondef(p.oid) LIKE '%UPDATE public.productos%') AS toca_productos,
  (pg_get_functiondef(p.oid) LIKE '%inventario_movimientos%') AS escribe_kardex
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('confirmar_entrega_inventario_atomica', 'aprobar_despacho_inventario_atomico', 'revertir_entrega_inventario_atomica', 'revertir_despacho_inventario_atomica')
ORDER BY p.proname;

-- 3. Permisos: las RPCs vivas solo ejecutables por service_role; las obsoletas por nadie.
SELECT
  p.proname,
  pg_get_function_identity_arguments(p.oid) AS argumentos,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_puede,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_puede,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_puede
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'aprobar_despacho_inventario_atomico',
    'confirmar_entrega_inventario_atomica',
    'revertir_entrega_inventario_atomica',
    'revertir_despacho_inventario_atomica',
    'editar_despacho_profundidad',
    'obtener_stock_comprometido',
    'obtener_stock_comprometido_detalle',
    'crear_nota_despacho',
    'anular_despacho_atomico'
  )
ORDER BY p.proname, pg_get_function_identity_arguments(p.oid);

-- 4. Invariante de cutover: todo despachada/entregada tiene egreso_lote_id.
SELECT estado, COUNT(*) AS despachos,
       COUNT(*) FILTER (WHERE egreso_lote_id IS NULL) AS sin_egreso_lote
FROM public.notas_despacho
WHERE estado IN ('despachada', 'entregada')
GROUP BY estado;

-- 5. Kardex del cutover (evidencia del backfill) y alertas marcadas.
SELECT
  m.lote_id,
  m.tipo,
  m.motivo,
  COUNT(*) AS lineas,
  SUM(m.cantidad) AS unidades
FROM public.inventario_movimientos m
WHERE m.motivo LIKE 'MIGRACIÓN — egreso por cambio de modelo%'
GROUP BY m.lote_id, m.tipo, m.motivo
ORDER BY m.lote_id;

SELECT COUNT(*) AS despachos_con_alerta
FROM public.notas_despacho
WHERE alerta_stock = TRUE;

-- 6. Conteo de despachos 'despachada' con alerta de stock por nivel (detalle).
SELECT
  a.value->>'nivel' AS nivel,
  COUNT(*) AS items
FROM public.notas_despacho nd,
     jsonb_array_elements(COALESCE(nd.alerta_stock_items, '[]'::jsonb)) a
WHERE nd.alerta_stock = TRUE
GROUP BY a.value->>'nivel';
