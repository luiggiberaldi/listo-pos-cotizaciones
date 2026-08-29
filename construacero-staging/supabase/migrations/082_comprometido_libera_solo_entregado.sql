-- ═══════════════════════════════════════════════════════════════════════════
-- 082: Stock comprometido se libera SOLO cuando el despacho es entregado
-- ═══════════════════════════════════════════════════════════════════════════
-- CAMBIO: El stock comprometido es puramente visual. Una cotización deja de
--         contar como comprometida SOLO cuando su despacho llega a 'entregado'.
--         Mientras el despacho está en 'pendiente' o 'en_ruta', el stock sigue
--         mostrándose como comprometido.
--
-- ANTES:  AND nd.estado != 'anulada'  (liberaba al crear despacho)
-- AHORA:  AND nd.estado = 'entregado' (libera solo al entregar)
--
-- APLICAR EN: Supabase Dashboard → SQL Editor → Run
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. RPC resumen: stock comprometido por producto ──────────────────────
CREATE OR REPLACE FUNCTION public.obtener_stock_comprometido()
RETURNS TABLE (
  producto_id        UUID,
  total_comprometido NUMERIC(12,2)
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    ci.producto_id,
    SUM(ci.cantidad) AS total_comprometido
  FROM public.cotizacion_items ci
  JOIN public.cotizaciones c ON c.id = ci.cotizacion_id
  WHERE c.estado IN ('enviada', 'aceptada')
    AND ci.producto_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.notas_despacho nd
      WHERE nd.cotizacion_id = c.id
        AND nd.estado = 'entregado'
    )
  GROUP BY ci.producto_id;
$$;

-- ─── 2. RPC detalle: desglose por vendedor/cotización ─────────────────────
CREATE OR REPLACE FUNCTION public.obtener_stock_comprometido_detalle(p_producto_id UUID DEFAULT NULL)
RETURNS TABLE (
  producto_id       UUID,
  producto_nombre   TEXT,
  cantidad          NUMERIC(10,2),
  vendedor_id       UUID,
  vendedor_nombre   TEXT,
  cotizacion_id     UUID,
  cotizacion_numero TEXT,
  cotizacion_estado TEXT,
  cotizacion_fecha  TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    ci.producto_id,
    ci.nombre_snap AS producto_nombre,
    ci.cantidad,
    c.vendedor_id,
    u.nombre AS vendedor_nombre,
    c.id AS cotizacion_id,
    c.numero AS cotizacion_numero,
    c.estado::TEXT AS cotizacion_estado,
    c.creado_en AS cotizacion_fecha
  FROM public.cotizacion_items ci
  JOIN public.cotizaciones c ON c.id = ci.cotizacion_id
  JOIN public.usuarios u ON u.id = c.vendedor_id
  WHERE c.estado IN ('enviada', 'aceptada')
    AND ci.producto_id IS NOT NULL
    AND (p_producto_id IS NULL OR ci.producto_id = p_producto_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.notas_despacho nd
      WHERE nd.cotizacion_id = c.id
        AND nd.estado = 'entregado'
    )
  ORDER BY ci.producto_id, c.creado_en DESC;
$$;
