-- 222: Stock comprometido por despacho aprobado
-- Regla operativa:
--   * pendiente/anulada: no comprometido
--   * despachada (Aprobada): comprometido
--   * entregada: deja de estar comprometido
-- Las órdenes de compra no participan en el Kardex ni en este cálculo.

CREATE OR REPLACE FUNCTION public.obtener_stock_comprometido()
RETURNS TABLE (
  producto_id        UUID,
  total_comprometido NUMERIC(12,2)
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ndi.producto_id,
    SUM(ndi.cantidad)::NUMERIC(12,2) AS total_comprometido
  FROM public.notas_despacho_items ndi
  JOIN public.notas_despacho nd ON nd.id = ndi.despacho_id
  WHERE nd.estado = 'despachada'
    AND ndi.producto_id IS NOT NULL
  GROUP BY ndi.producto_id;
$$;

CREATE OR REPLACE FUNCTION public.obtener_stock_comprometido_detalle(
  p_producto_id UUID DEFAULT NULL
)
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
SET search_path = public
AS $$
  SELECT
    ndi.producto_id,
    ndi.nombre_snap AS producto_nombre,
    ndi.cantidad,
    nd.vendedor_id,
    u.nombre AS vendedor_nombre,
    nd.cotizacion_id,
    c.numero::TEXT AS cotizacion_numero,
    nd.estado::TEXT AS cotizacion_estado,
    nd.despachada_en AS cotizacion_fecha
  FROM public.notas_despacho_items ndi
  JOIN public.notas_despacho nd ON nd.id = ndi.despacho_id
  LEFT JOIN public.cotizaciones c ON c.id = nd.cotizacion_id
  LEFT JOIN public.usuarios u ON u.id = nd.vendedor_id
  WHERE nd.estado = 'despachada'
    AND ndi.producto_id IS NOT NULL
    AND (p_producto_id IS NULL OR ndi.producto_id = p_producto_id)
  ORDER BY ndi.producto_id, nd.despachada_en DESC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION public.obtener_stock_comprometido() TO authenticated;
GRANT EXECUTE ON FUNCTION public.obtener_stock_comprometido_detalle(UUID) TO authenticated;
