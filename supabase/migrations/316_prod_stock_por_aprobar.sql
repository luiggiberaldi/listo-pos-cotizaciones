-- 316_prod_stock_por_aprobar.sql — PRODUCCIÓN (OP-2026-097)
-- Avisar a todos los usuarios cuántas unidades de cada producto están en despachos "por aprobar"
-- (estado pendiente). NO restan del stock disponible (el despacho todavía puede rechazarse o
-- anularse); solo se muestran como aviso.
-- Cada empresa ve solo lo suyo (nd.cuenta_id = auth.uid(), igual que la migración 317).
-- Alineado a 4 decimales (NUMERIC(12,4)) igual que la migración 315 (OP-2026-094 M1).
-- Rollback: 316_prod_stock_por_aprobar_rollback.sql
BEGIN;

DROP FUNCTION IF EXISTS public.obtener_stock_por_aprobar();
DROP FUNCTION IF EXISTS public.obtener_stock_por_aprobar_detalle(UUID);

CREATE OR REPLACE FUNCTION public.obtener_stock_por_aprobar()
RETURNS TABLE (producto_id UUID, total_por_aprobar NUMERIC(12,4))
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    ndi.producto_id,
    ROUND(SUM(ndi.cantidad)::NUMERIC, 4)::NUMERIC(12,4) AS total_por_aprobar
  FROM public.notas_despacho_items ndi
  JOIN public.notas_despacho nd ON nd.id = ndi.despacho_id
  WHERE nd.estado = 'pendiente'
    AND nd.cuenta_id = (SELECT auth.uid())
    AND ndi.producto_id IS NOT NULL
  GROUP BY ndi.producto_id;
$$;

CREATE OR REPLACE FUNCTION public.obtener_stock_por_aprobar_detalle(p_producto_id UUID DEFAULT NULL)
RETURNS TABLE (
  producto_id      UUID,
  producto_nombre  TEXT,
  cantidad         NUMERIC(12,4),
  vendedor_id      UUID,
  vendedor_nombre  TEXT,
  despacho_id      UUID,
  despacho_numero  TEXT,
  creado_en        TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    ndi.producto_id,
    ndi.nombre_snap AS producto_nombre,
    ndi.cantidad::NUMERIC(12,4),
    nd.vendedor_id,
    u.nombre AS vendedor_nombre,
    nd.id AS despacho_id,
    nd.numero::TEXT AS despacho_numero,
    nd.creado_en
  FROM public.notas_despacho_items ndi
  JOIN public.notas_despacho nd ON nd.id = ndi.despacho_id
  LEFT JOIN public.usuarios u ON u.id = nd.vendedor_id
  WHERE nd.estado = 'pendiente'
    AND nd.cuenta_id = (SELECT auth.uid())
    AND ndi.producto_id IS NOT NULL
    AND (p_producto_id IS NULL OR ndi.producto_id = p_producto_id)
  ORDER BY ndi.producto_id, nd.creado_en DESC NULLS LAST;
$$;

REVOKE ALL ON FUNCTION public.obtener_stock_por_aprobar() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.obtener_stock_por_aprobar_detalle(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.obtener_stock_por_aprobar() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.obtener_stock_por_aprobar_detalle(UUID) TO authenticated, service_role;

COMMIT;
