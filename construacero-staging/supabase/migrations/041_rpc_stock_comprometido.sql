-- 041: RPC para consultar stock comprometido por producto
-- Retorna la cantidad comprometida en cotizaciones activas (enviada/aceptada)
-- con desglose por vendedor y cotización

-- Vista rápida: stock comprometido total por producto
CREATE OR REPLACE FUNCTION public.obtener_stock_comprometido()
RETURNS TABLE (
  producto_id     UUID,
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
  GROUP BY ci.producto_id;
$$;

-- Detalle: stock comprometido desglosado por vendedor y cotización
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
  ORDER BY ci.producto_id, c.creado_en DESC;
$$;

-- Permisos
GRANT EXECUTE ON FUNCTION public.obtener_stock_comprometido() TO authenticated;
GRANT EXECUTE ON FUNCTION public.obtener_stock_comprometido_detalle(UUID) TO authenticated;
