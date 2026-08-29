-- 139_reporte_ventas_operaciones.sql
-- RPC para obtener reporte de ventas netas (excluyendo comisiones e inventario)
-- Permite ver los despachos en estado 'despachada' (pago recibido, en entrega) y 'entregada'

DROP FUNCTION IF EXISTS public.obtener_reporte_ventas_operaciones(date, date, uuid);
DROP FUNCTION IF EXISTS public.obtener_reporte_ventas_operaciones(timestamptz, timestamptz, uuid);

CREATE OR REPLACE FUNCTION public.obtener_reporte_ventas_operaciones(
  p_fecha_inicio DATE DEFAULT NULL,
  p_fecha_fin    DATE DEFAULT NULL,
  p_vendedor_id  UUID DEFAULT NULL
)
RETURNS TABLE (
  despacho_id UUID,
  despacho_numero INTEGER,
  cotizacion_id UUID,
  fecha TIMESTAMPTZ,
  estado TEXT,
  asesor_id UUID,
  asesor_nombre TEXT,
  asesor_color TEXT,
  cliente_nombre TEXT,
  total_usd NUMERIC(12,4),
  flete_usd NUMERIC(12,4),
  descuento_usd NUMERIC(12,4),
  venta_neta_usd NUMERIC(12,4),
  tasa NUMERIC(12,4),
  total_bs NUMERIC(12,4),
  forma_pago JSONB,
  referencia_pago TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rol TEXT;
BEGIN
  v_rol := public.get_rol_actual();
  
  -- Validación de roles autorizados
  IF v_rol NOT IN ('administracion', 'supervisor', 'jefe', 'desarrollador', 'vendedor') THEN
    RAISE EXCEPTION 'Acceso denegado. Rol no autorizado.';
  END IF;

  -- Seguridad estricta: si es vendedor regular, obligar a que solo consulte su propio ID
  IF v_rol = 'vendedor' AND (p_vendedor_id IS NULL OR p_vendedor_id <> auth.uid()) THEN
    RAISE EXCEPTION 'Acceso denegado. Solo puede consultar sus propias ventas.';
  END IF;

  RETURN QUERY
  SELECT 
    nd.id AS despacho_id,
    nd.numero AS despacho_numero,
    nd.cotizacion_id AS cotizacion_id,
    COALESCE(nd.entregada_en, nd.creado_en) AS fecha,
    nd.estado AS estado,
    COALESCE(cl.vendedor_id, nd.vendedor_id) AS asesor_id,
    COALESCE(u.nombre, 'Sin asesor')::TEXT AS asesor_nombre,
    COALESCE(u.color, '#64748b')::TEXT AS asesor_color,
    cl.nombre::TEXT AS cliente_nombre,
    nd.total_usd::NUMERIC(12,4) AS total_usd,
    nd.flete_usd::NUMERIC(12,4) AS flete_usd,
    nd.descuento_total_usd::NUMERIC(12,4) AS descuento_usd,
    GREATEST(COALESCE(nd.total_usd, 0) - COALESCE(nd.flete_usd, 0) - COALESCE(nd.descuento_total_usd, 0), 0)::NUMERIC(12,4) AS venta_neta_usd,
    COALESCE(nd.tasa_snapshot, c.tasa_bcv_snapshot, 1)::NUMERIC(12,4) AS tasa,
    ROUND(GREATEST(COALESCE(nd.total_usd, 0) - COALESCE(nd.flete_usd, 0) - COALESCE(nd.descuento_total_usd, 0), 0) * COALESCE(nd.tasa_snapshot, c.tasa_bcv_snapshot, 1), 2)::NUMERIC(12,4) AS total_bs,
    -- Normalización de la forma de pago a JSONB array
    (CASE 
      WHEN nd.forma_pago IS NULL THEN '[]'::jsonb 
      WHEN nd.forma_pago ~ '^\s*\[' THEN nd.forma_pago::jsonb 
      ELSE jsonb_build_array(
        jsonb_build_object(
          'metodo', nd.forma_pago, 
          'monto', GREATEST(COALESCE(nd.total_usd, 0) - COALESCE(nd.flete_usd, 0) - COALESCE(nd.descuento_total_usd, 0), 0)
        )
      ) 
    END) AS forma_pago,
    nd.referencia_pago
  FROM public.notas_despacho nd
  JOIN public.cotizaciones c ON c.id = nd.cotizacion_id
  JOIN public.clientes cl ON cl.id = c.cliente_id
  LEFT JOIN public.usuarios u ON u.id = COALESCE(cl.vendedor_id, nd.vendedor_id)
  WHERE nd.estado IN ('despachada', 'entregada')
    -- Conversión a timezone de Venezuela antes de procesar fecha límite
    AND (p_fecha_inicio IS NULL OR (COALESCE(nd.entregada_en, nd.creado_en) AT TIME ZONE 'America/Caracas')::date >= p_fecha_inicio)
    AND (p_fecha_fin IS NULL OR (COALESCE(nd.entregada_en, nd.creado_en) AT TIME ZONE 'America/Caracas')::date <= p_fecha_fin)
    -- Filtro de vendedor
    AND (p_vendedor_id IS NULL OR COALESCE(cl.vendedor_id, nd.vendedor_id) = p_vendedor_id)
  ORDER BY COALESCE(nd.entregada_en, nd.creado_en) DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.obtener_reporte_ventas_operaciones TO authenticated;
