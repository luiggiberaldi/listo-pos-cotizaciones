-- 103_fix_reporte_ventas_comisiones.sql
-- Fix: El RPC obtener_reporte_ventas_comisiones ahora utiliza notas_despacho_items como fuente
-- primaria de los items del despacho si existen. Si no existen, usa cotizacion_items (fallback).
-- Esto asegura que los items mostrados en el Detalle de Comisiones (modal y PDF) coincidan
-- con la Ficha de Comisiones y los montos editados por administración.

DROP FUNCTION IF EXISTS public.obtener_reporte_ventas_comisiones(timestamptz, timestamptz, uuid);
DROP FUNCTION IF EXISTS public.obtener_reporte_ventas_comisiones(date, date, uuid);

CREATE OR REPLACE FUNCTION public.obtener_reporte_ventas_comisiones(
  p_fecha_inicio TIMESTAMPTZ DEFAULT NULL,
  p_fecha_fin    TIMESTAMPTZ DEFAULT NULL,
  p_vendedor_id  UUID DEFAULT NULL
)
RETURNS TABLE (
  despacho_id UUID,
  despacho_numero INTEGER,
  fecha TIMESTAMPTZ,
  asesor TEXT,
  asesor_color TEXT,
  cliente TEXT,
  codigo TEXT,
  descripcion TEXT,
  pza TEXT,
  precio NUMERIC(12,4),
  cantidad NUMERIC(12,2),
  total NUMERIC(12,4),
  comision_pct NUMERIC(5,2),
  total_com NUMERIC(12,2),
  tasa NUMERIC(12,4),
  pago TEXT,
  total_bs NUMERIC(12,4),
  estado TEXT,
  estado_comision TEXT,
  despacho_comision_liberada NUMERIC(12,2),
  despacho_comision_total NUMERIC(12,2)
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rol TEXT;
  v_cat_cabilla TEXT;
BEGIN
  -- Validar acceso
  v_rol := public.get_rol_actual();
  IF v_rol NOT IN ('administracion', 'desarrollador') THEN
    RAISE EXCEPTION 'Acceso denegado. Solo administración puede ver este reporte.';
  END IF;

  -- Obtener la categoría cabilla configurada
  SELECT lower(trim(comision_categoria_cabilla)) INTO v_cat_cabilla 
  FROM public.configuracion_negocio 
  WHERE id = 1;

  RETURN QUERY
  WITH despachos_filtrados AS (
    SELECT 
      nd.id, 
      nd.numero, 
      nd.cotizacion_id, 
      nd.estado AS col_estado, 
      nd.entregada_en, 
      nd.creado_en, 
      nd.vendedor_id, 
      nd.tasa_snapshot, 
      nd.forma_pago
    FROM public.notas_despacho nd
    WHERE nd.estado IN ('despachada', 'entregada')
      AND (p_fecha_inicio IS NULL OR COALESCE(nd.entregada_en, nd.creado_en) >= p_fecha_inicio)
      AND (p_fecha_fin IS NULL OR COALESCE(nd.entregada_en, nd.creado_en) <= p_fecha_fin)
  ),
  items_con_descuento AS (
    -- Prioridad 1: notas_despacho_items (si existen para ese despacho)
    SELECT 
      ndi.id AS item_id,
      nd.cotizacion_id,
      nd.id AS despacho_id_ref,
      ndi.codigo_snap,
      ndi.nombre_snap,
      ndi.unidad_snap,
      ndi.precio_unit_usd,
      ndi.cantidad,
      COALESCE(p.categoria, '') AS categoria,
      COALESCE(ndi.total_linea_usd, 0) AS total_linea_neto
    FROM despachos_filtrados nd
    JOIN public.notas_despacho_items ndi ON ndi.despacho_id = nd.id
    LEFT JOIN public.productos p ON p.id = ndi.producto_id
    
    UNION ALL
    
    -- Prioridad 2: cotizacion_items (fallback si no hay notas_despacho_items)
    SELECT 
      ci.id AS item_id,
      ci.cotizacion_id,
      nd.id AS despacho_id_ref,
      ci.codigo_snap,
      ci.nombre_snap,
      ci.unidad_snap,
      ci.precio_unit_usd,
      ci.cantidad,
      COALESCE(p.categoria, '') AS categoria,
      GREATEST(COALESCE(ci.total_linea_usd, 0) - COALESCE(dd.monto_usd, 0), 0) AS total_linea_neto
    FROM despachos_filtrados nd
    JOIN public.cotizacion_items ci ON ci.cotizacion_id = nd.cotizacion_id
    LEFT JOIN public.productos p ON p.id = ci.producto_id
    LEFT JOIN public.despacho_descuentos dd ON dd.despacho_id = nd.id AND dd.cotizacion_item_id = ci.id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.notas_despacho_items ndi2 WHERE ndi2.despacho_id = nd.id
    )
  ),
  config_tasas AS (
    SELECT 
      comision_pct_cabilla AS cfg_pct_cabilla, 
      comision_pct_otros AS cfg_pct_otros, 
      COALESCE(_comision_extras, '[]'::jsonb) AS cfg_extras
    FROM public.configuracion_negocio WHERE id = 1
  ),
  items_con_comision AS (
    SELECT 
      i.*,
      COALESCE(com.pct_cabilla, cfg.cfg_pct_cabilla) AS final_pct_cabilla,
      COALESCE(com.pct_otros, cfg.cfg_pct_otros) AS final_pct_otros,
      COALESCE(com.detalle_extras, cfg.cfg_extras) AS final_extras,
      COALESCE(com.estado, 'retenida') AS res_estado_comision,
      COALESCE(cl.vendedor_id, nd.vendedor_id) AS dueño_cliente_id,
      COALESCE(com.comision_liberada, 0) AS res_com_liberada,
      COALESCE(com.total_comision, 0) AS res_com_total
    FROM items_con_descuento i
    JOIN public.notas_despacho nd ON nd.id = i.despacho_id_ref
    JOIN public.cotizaciones c ON c.id = nd.cotizacion_id
    JOIN public.clientes cl ON cl.id = c.cliente_id
    LEFT JOIN public.comisiones com ON com.despacho_id = i.despacho_id_ref
    CROSS JOIN config_tasas cfg
    WHERE (p_vendedor_id IS NULL OR COALESCE(cl.vendedor_id, nd.vendedor_id) = p_vendedor_id)
  )
  SELECT 
    i.despacho_id_ref AS despacho_id,
    nd.numero AS despacho_numero,
    COALESCE(nd.entregada_en, nd.creado_en) AS fecha,
    COALESCE(u.nombre, 'Sin asesor') AS asesor,
    COALESCE(u.color, '#1B365D') AS asesor_color,
    cl.nombre AS cliente,
    i.codigo_snap AS codigo,
    i.nombre_snap AS descripcion,
    i.unidad_snap AS pza,
    i.precio_unit_usd AS precio,
    i.cantidad AS cantidad,
    i.total_linea_neto AS total,
    (CASE
      WHEN lower(trim(i.categoria)) = v_cat_cabilla THEN i.final_pct_cabilla
      ELSE COALESCE(
        (SELECT (elem->>'pct')::numeric FROM jsonb_array_elements(i.final_extras) elem WHERE lower(trim(elem->>'cat')) = lower(trim(i.categoria)) LIMIT 1),
        i.final_pct_otros
      )
    END)::numeric(5,2) AS comision_pct,
    ROUND(i.total_linea_neto * (
      CASE
        WHEN lower(trim(i.categoria)) = v_cat_cabilla THEN i.final_pct_cabilla
        ELSE COALESCE(
          (SELECT (elem->>'pct')::numeric FROM jsonb_array_elements(i.final_extras) elem WHERE lower(trim(elem->>'cat')) = lower(trim(i.categoria)) LIMIT 1),
          i.final_pct_otros
        )
      END
    ) / 100, 2)::numeric(12,2) AS total_com,
    COALESCE(nd.tasa_snapshot, c.tasa_bcv_snapshot)::numeric(12,4) AS tasa,
    COALESCE(nd.forma_pago, 'Pendiente') AS pago,
    ROUND(i.total_linea_neto * COALESCE(nd.tasa_snapshot, c.tasa_bcv_snapshot), 2)::numeric(12,4) AS total_bs,
    nd.estado AS estado,
    i.res_estado_comision AS estado_comision,
    i.res_com_liberada::numeric(12,2) AS despacho_comision_liberada,
    i.res_com_total::numeric(12,2) AS despacho_comision_total
  FROM items_con_comision i
  JOIN public.notas_despacho nd ON nd.id = i.despacho_id_ref
  JOIN public.cotizaciones c ON c.id = nd.cotizacion_id
  JOIN public.clientes cl ON cl.id = c.cliente_id
  LEFT JOIN public.usuarios u ON u.id = i.dueño_cliente_id
  ORDER BY COALESCE(nd.entregada_en, nd.creado_en) DESC, i.nombre_snap ASC;
END;
$$;
