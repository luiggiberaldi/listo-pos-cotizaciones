-- 095b: Script unificado — agregar tasa_snapshot + actualizar RPC
-- Ejecutar este script completo en Supabase para restaurar el reporte de ventas
-- y habilitar el guardado de tasa por entrega.

-- ── 1. Agregar columna tasa_snapshot a notas_despacho ─────────────────────────
ALTER TABLE public.notas_despacho
  ADD COLUMN IF NOT EXISTS tasa_snapshot NUMERIC(12,4);

COMMENT ON COLUMN public.notas_despacho.tasa_snapshot
  IS 'Tasa de cambio (Bs/USD) al momento de confirmar la entrega. Fuente de verdad para calcular montos en Bs.';

-- Rellenar histórico: despachos existentes usan la tasa de la cotización
UPDATE public.notas_despacho nd
SET tasa_snapshot = c.tasa_bcv_snapshot
FROM public.cotizaciones c
WHERE nd.cotizacion_id = c.id
  AND nd.estado IN ('entregada', 'despachada')
  AND nd.tasa_snapshot IS NULL
  AND c.tasa_bcv_snapshot IS NOT NULL;

-- ── 2. Actualizar RPC para usar tasa_snapshot ──────────────────────────────────
DROP FUNCTION IF EXISTS public.obtener_reporte_ventas_comisiones(date, date, uuid);
DROP FUNCTION IF EXISTS public.obtener_reporte_ventas_comisiones(timestamptz, timestamptz, uuid);

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
  estado_comision TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rol TEXT;
  v_cat_cabilla TEXT;
BEGIN
  v_rol := public.get_rol_actual();
  
  IF v_rol NOT IN ('administracion', 'desarrollador') THEN
    RAISE EXCEPTION 'Acceso denegado. Solo administración puede ver este reporte.';
  END IF;

  SELECT lower(trim(comision_categoria_cabilla)) INTO v_cat_cabilla
  FROM public.configuracion_negocio WHERE id = 1;

  RETURN QUERY
  WITH items_con_descuento AS (
    SELECT 
      ci.id AS item_id,
      ci.cotizacion_id,
      nd.id AS despacho_id,
      ci.codigo_snap,
      ci.nombre_snap,
      ci.unidad_snap,
      ci.precio_unit_usd,
      ci.cantidad,
      COALESCE(p.categoria, '') AS categoria,
      GREATEST(COALESCE(ci.total_linea_usd, 0) - COALESCE(dd.monto_usd, 0), 0) AS total_linea_neto
    FROM public.notas_despacho nd
    JOIN public.cotizacion_items ci ON ci.cotizacion_id = nd.cotizacion_id
    LEFT JOIN public.productos p ON p.id = ci.producto_id
    LEFT JOIN public.despacho_descuentos dd ON dd.despacho_id = nd.id AND dd.cotizacion_item_id = ci.id
    WHERE nd.estado IN ('despachada', 'entregada')
      AND (
        p_fecha_inicio IS NULL
        OR COALESCE(nd.entregada_en, nd.creado_en) >= p_fecha_inicio
      )
      AND (
        p_fecha_fin IS NULL
        OR COALESCE(nd.entregada_en, nd.creado_en) <= p_fecha_fin
      )
  ),
  config_tasas AS (
    SELECT 
      comision_pct_cabilla, 
      comision_pct_otros, 
      COALESCE(_comision_extras, '[]'::jsonb) AS _comision_extras
    FROM public.configuracion_negocio WHERE id = 1
  ),
  items_con_comision AS (
    SELECT 
      i.*,
      COALESCE(com.pct_cabilla, cfg.comision_pct_cabilla) AS pct_cabilla,
      COALESCE(com.pct_otros, cfg.comision_pct_otros) AS pct_otros,
      COALESCE(com.detalle_extras, cfg._comision_extras) AS detalle_extras,
      COALESCE(com.estado, 'pendiente') AS estado_comision,
      COALESCE(cl.vendedor_id, nd.vendedor_id) AS dueño_cliente_id
    FROM items_con_descuento i
    JOIN public.notas_despacho nd ON nd.id = i.despacho_id
    JOIN public.cotizaciones c ON c.id = nd.cotizacion_id
    JOIN public.clientes cl ON cl.id = c.cliente_id
    LEFT JOIN public.comisiones com ON com.despacho_id = i.despacho_id
    CROSS JOIN config_tasas cfg
    WHERE (p_vendedor_id IS NULL OR COALESCE(cl.vendedor_id, nd.vendedor_id) = p_vendedor_id)
  )
  SELECT 
    i.despacho_id,
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
    -- Porcentaje de comisión
    (CASE
      WHEN lower(trim(i.categoria)) = v_cat_cabilla THEN i.pct_cabilla
      ELSE COALESCE(
        (SELECT (elem->>'pct')::numeric
         FROM jsonb_array_elements(i.detalle_extras) elem
         WHERE lower(trim(elem->>'cat')) = lower(trim(i.categoria))
         LIMIT 1),
        i.pct_otros
      )
    END) AS comision_pct,
    -- Total comisión en USD
    ROUND(i.total_linea_neto * (
      CASE
        WHEN lower(trim(i.categoria)) = v_cat_cabilla THEN i.pct_cabilla
        ELSE COALESCE(
          (SELECT (elem->>'pct')::numeric
           FROM jsonb_array_elements(i.detalle_extras) elem
           WHERE lower(trim(elem->>'cat')) = lower(trim(i.categoria))
           LIMIT 1),
          i.pct_otros
        )
      END
    ) / 100, 2) AS total_com,
    -- Tasa: primero la de entrega, sino la de la cotización
    COALESCE(nd.tasa_snapshot, c.tasa_bcv_snapshot) AS tasa,
    COALESCE(nd.forma_pago, 'Pendiente') AS pago,
    -- Total venta en Bs (con tasa de entrega)
    ROUND(i.total_linea_neto * COALESCE(nd.tasa_snapshot, c.tasa_bcv_snapshot), 2) AS total_bs,
    nd.estado AS estado,
    i.estado_comision
  FROM items_con_comision i
  JOIN public.notas_despacho nd ON nd.id = i.despacho_id
  JOIN public.cotizaciones c ON c.id = nd.cotizacion_id
  JOIN public.clientes cl ON cl.id = c.cliente_id
  LEFT JOIN public.usuarios u ON u.id = i.dueño_cliente_id
  ORDER BY COALESCE(nd.entregada_en, nd.creado_en) DESC, i.nombre_snap ASC;
END;
$$;
