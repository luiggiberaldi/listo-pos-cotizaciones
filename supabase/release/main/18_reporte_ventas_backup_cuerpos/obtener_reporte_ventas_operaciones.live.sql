CREATE OR REPLACE FUNCTION public.obtener_reporte_ventas_operaciones(p_fecha_inicio date DEFAULT NULL::date, p_fecha_fin date DEFAULT NULL::date, p_vendedor_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(despacho_id uuid, despacho_numero integer, cotizacion_id uuid, fecha timestamp with time zone, estado text, asesor_id uuid, asesor_nombre text, asesor_color text, cliente_nombre text, total_usd numeric, flete_usd numeric, descuento_usd numeric, venta_neta_usd numeric, tasa numeric, total_bs numeric, forma_pago jsonb, referencia_pago text, cliente_tipo_cliente text, cliente_categoria text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rol TEXT;
BEGIN
  v_rol := public.get_rol_actual();
  
  -- Validación de roles autorizados
  IF v_rol NOT IN ('administracion', 'supervisor', 'jefe', 'desarrollador', 'vendedor', 'vendedor_sin_comision') THEN
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
    nd.creado_en AS fecha,
    nd.estado AS estado,
    nd.vendedor_id AS asesor_id,
    COALESCE(u.nombre, 'Sin asesor')::TEXT AS asesor_nombre,
    COALESCE(u.color, '#64748b')::TEXT AS asesor_color,
    cl.nombre::TEXT AS cliente_nombre,
    nd.total_usd::NUMERIC(12,4) AS total_usd,
    nd.flete_usd::NUMERIC(12,4) AS flete_usd,
    nd.descuento_total_usd::NUMERIC(12,4) AS descuento_usd,
    GREATEST(COALESCE(nd.total_usd, 0) - COALESCE(nd.flete_usd, 0) - COALESCE(nd.descuento_total_usd, 0), 0)::NUMERIC(12,4) AS venta_neta_usd,
    COALESCE(nd.tasa_snapshot, c.tasa_bcv_snapshot, 1)::NUMERIC(12,4) AS tasa,
    ROUND(GREATEST(COALESCE(nd.total_usd, 0) - COALESCE(nd.flete_usd, 0) - COALESCE(nd.descuento_total_usd, 0), 0) * COALESCE(nd.tasa_snapshot, c.tasa_bcv_snapshot, 1), 2)::NUMERIC(12,4) AS total_bs,
    -- Normalización de la forma de pago a JSONB array, priorizando forma_pago_cliente
    (CASE 
      WHEN nd.forma_pago_cliente IS NOT NULL AND nd.forma_pago_cliente <> '' AND nd.forma_pago_cliente ~ '^\s*\[' THEN nd.forma_pago_cliente::jsonb
      WHEN nd.forma_pago IS NULL THEN '[]'::jsonb 
      WHEN nd.forma_pago ~ '^\s*\[' THEN nd.forma_pago::jsonb 
      ELSE jsonb_build_array(
        jsonb_build_object(
          'metodo', nd.forma_pago, 
          'monto', GREATEST(COALESCE(nd.total_usd, 0) - COALESCE(nd.flete_usd, 0) - COALESCE(nd.descuento_total_usd, 0), 0)
        )
      ) 
    END) AS forma_pago,
    nd.referencia_pago,
    cl.tipo_cliente::TEXT AS cliente_tipo_cliente,
    cl.categoria::TEXT AS cliente_categoria
  FROM public.notas_despacho nd
  JOIN public.cotizaciones c ON c.id = nd.cotizacion_id
  JOIN public.clientes cl ON cl.id = nd.cliente_id
  LEFT JOIN public.usuarios u ON u.id = nd.vendedor_id
  WHERE (auth.role() = 'service_role' OR public.can_read_seller(nd.vendedor_id)) AND nd.estado IN ('despachada', 'entregada')
    -- Conversión a timezone de Venezuela antes de procesar fecha límite
    AND (p_fecha_inicio IS NULL OR (nd.creado_en AT TIME ZONE 'America/Caracas')::date >= p_fecha_inicio)
    AND (p_fecha_fin IS NULL OR (nd.creado_en AT TIME ZONE 'America/Caracas')::date <= p_fecha_fin)
    -- Filtro de vendedor
    AND (p_vendedor_id IS NULL OR nd.vendedor_id = p_vendedor_id)
  ORDER BY nd.creado_en DESC;
END;
$function$
