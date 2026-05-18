-- 138_fix_excluir_corte_por_nombre.sql
-- Fix: La condición de exclusión de cortes cambia de:
--   origen = 'externo' AND nombre LIKE '%corte%'  → excluía solo externos
-- a:
--   lower(nombre_snap) LIKE 'corte%'              → excluye cualquier ítem cuyo nombre
--                                                    EMPIECE con "corte" (servicio de corte)
--                                                    sin afectar "DISCO DE CORTE 4 1/2" (producto)

-- ══════════════════════════════════════════════════════════════════════
-- 1. Actualizar calcularcomisiondespacho (función de generación de comisión)
-- ══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.calcularcomisiondespacho(p_despachoid UUID)
RETURNS UUID
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_despacho RECORD;
  v_tiene_items_despacho BOOLEAN;
  v_pct_cabilla NUMERIC;
  v_pct_otros NUMERIC;
  v_cat_cabilla TEXT;
  v_monto_cabilla NUMERIC(12,2) := 0;
  v_monto_otros NUMERIC(12,2) := 0;
  v_comision_cabilla NUMERIC(12,2) := 0;
  v_comision_otros NUMERIC(12,2) := 0;
  v_total_comision NUMERIC(12,2) := 0;
  v_estado TEXT;
  v_comisionid UUID;
BEGIN
  IF EXISTS (SELECT 1 FROM public.comisiones WHERE despachoid = p_despachoid) THEN
    RETURN NULL;
  END IF;

  SELECT nd.id, nd.cotizacion_id, nd.cuenta_id, nd.estado, nd.cliente_id,
         cl.vendedor_id AS vendedor_dueno_cliente_id,
         u.rol AS vendedor_rol
  INTO v_despacho
  FROM public.notas_despacho nd
  JOIN public.clientes cl ON cl.id = nd.cliente_id
  LEFT JOIN public.usuarios u ON u.id = cl.vendedor_id
  WHERE nd.id = p_despachoid;

  IF NOT FOUND THEN RAISE EXCEPTION 'DESPACHO_NO_ENCONTRADO'; END IF;

  -- Si el vendedor es vendedor_sin_comision, NO generar comisión
  IF v_despacho.vendedor_rol = 'vendedor_sin_comision' THEN RETURN NULL; END IF;

  IF v_despacho.estado <> 'entregada' THEN RETURN NULL; END IF;
  IF v_despacho.cuenta_id IS NULL THEN RAISE EXCEPTION 'CUENTA_ID_REQUERIDO'; END IF;

  SELECT
    COALESCE(cn.comision_pct_cabilla, 0),
    COALESCE(cn.comision_pct_otros, 0),
    COALESCE(NULLIF(trim(cn.comision_categoria_cabilla), ''), 'Cabilla')
  INTO v_pct_cabilla, v_pct_otros, v_cat_cabilla
  FROM public.configuracion_negocio cn
  WHERE cn.cuenta_id = v_despacho.cuenta_id OR cn.id = 1
  ORDER BY CASE WHEN cn.cuenta_id = v_despacho.cuenta_id THEN 0 ELSE 1 END
  LIMIT 1;

  IF NOT FOUND THEN v_pct_cabilla := 0; v_pct_otros := 0; v_cat_cabilla := 'Cabilla'; END IF;
  v_cat_cabilla := lower(trim(v_cat_cabilla));

  SELECT EXISTS (
    SELECT 1 FROM public.notas_despacho_items ndi WHERE ndi.despacho_id = p_despachoid
  ) INTO v_tiene_items_despacho;

  IF v_tiene_items_despacho THEN
    SELECT
      COALESCE(SUM(CASE
        WHEN lower(trim(COALESCE(p.categoria,''))) = v_cat_cabilla THEN ndi.total_linea_usd
        ELSE 0
      END), 0),
      COALESCE(SUM(CASE
        WHEN lower(trim(COALESCE(p.categoria,''))) = v_cat_cabilla THEN 0
        -- Excluir servicios de corte (nombre empieza con "corte", sin importar origen)
        WHEN lower(trim(ndi.nombre_snap)) LIKE 'corte%' THEN 0
        ELSE ndi.total_linea_usd
      END), 0)
    INTO v_monto_cabilla, v_monto_otros
    FROM public.notas_despacho_items ndi
    LEFT JOIN public.productos p ON p.id = ndi.producto_id
    WHERE ndi.despacho_id = p_despachoid;
  ELSE
    SELECT
      COALESCE(SUM(CASE
        WHEN lower(trim(COALESCE(p.categoria,''))) = v_cat_cabilla THEN ci.total_linea_usd
        ELSE 0
      END), 0),
      COALESCE(SUM(CASE
        WHEN lower(trim(COALESCE(p.categoria,''))) = v_cat_cabilla THEN 0
        -- Excluir servicios de corte (nombre empieza con "corte", sin importar origen)
        WHEN lower(trim(ci.nombre_snap)) LIKE 'corte%' THEN 0
        ELSE ci.total_linea_usd
      END), 0)
    INTO v_monto_cabilla, v_monto_otros
    FROM public.cotizacion_items ci
    LEFT JOIN public.productos p ON p.id = ci.producto_id
    WHERE ci.cotizacion_id = v_despacho.cotizacion_id;
  END IF;

  v_comision_cabilla := ROUND((v_monto_cabilla * v_pct_cabilla / 100)::numeric, 2);
  v_comision_otros   := ROUND((v_monto_otros   * v_pct_otros   / 100)::numeric, 2);
  v_total_comision   := v_comision_cabilla + v_comision_otros;

  IF EXISTS (
    SELECT 1 FROM public.cuentas_por_cobrar cxc
    WHERE cxc.despacho_id = p_despachoid AND cxc.tipo = 'cargo' AND COALESCE(cxc.saldo_usd, 0) > 0
  ) THEN v_estado := 'cta_cobrar'; ELSE v_estado := 'pendiente'; END IF;

  INSERT INTO public.comisiones (
    despachoid, vendedorid, cotizacionid, cuentaid,
    totalcomision, comisioncabilla, comisionotros, pctcabilla, pctotros, estado
  ) VALUES (
    p_despachoid, v_despacho.vendedor_dueno_cliente_id, v_despacho.cotizacion_id, v_despacho.cuenta_id,
    v_total_comision, v_comision_cabilla, v_comision_otros, v_pct_cabilla, v_pct_otros, v_estado
  ) RETURNING id INTO v_comisionid;

  RETURN v_comisionid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.calcularcomisiondespacho(UUID) TO authenticated, service_role;

-- ══════════════════════════════════════════════════════════════════════
-- 2. Actualizar obtener_reporte_ventas_comisiones (RPC del PDF)
--    Mismo fix: es_corte = nombre empieza con "corte"
-- ══════════════════════════════════════════════════════════════════════
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
  v_uuid_nulo UUID := '00000000-0000-0000-0000-000000000000';
BEGIN
  v_rol := public.get_rol_actual();
  IF v_rol NOT IN ('administracion', 'desarrollador') THEN
    RAISE EXCEPTION 'Acceso denegado. Solo administración puede ver este reporte.';
  END IF;

  SELECT lower(trim(comision_categoria_cabilla)) INTO v_cat_cabilla
  FROM public.configuracion_negocio WHERE id = 1;

  RETURN QUERY
  WITH despachos_filtrados AS (
    SELECT
      nd.id, nd.numero, nd.cotizacion_id,
      nd.estado AS col_estado, nd.entregada_en, nd.creado_en,
      nd.vendedor_id, nd.tasa_snapshot, nd.forma_pago
    FROM public.notas_despacho nd
    WHERE nd.estado IN ('despachada', 'entregada')
      AND (p_fecha_inicio IS NULL OR COALESCE(nd.entregada_en, nd.creado_en) >= p_fecha_inicio)
      AND (p_fecha_fin   IS NULL OR COALESCE(nd.entregada_en, nd.creado_en) <= p_fecha_fin)
  ),
  items_con_descuento AS (
    -- Desde notas_despacho_items
    SELECT
      ndi.id AS item_id, nd.cotizacion_id, nd.id AS despacho_id_ref,
      ndi.codigo_snap, ndi.nombre_snap, ndi.unidad_snap,
      ndi.precio_unit_usd, ndi.cantidad,
      COALESCE(p.categoria, '') AS categoria,
      COALESCE(ndi.total_linea_usd, 0) AS total_linea_neto,
      -- Corte = nombre empieza con "corte" (captura CORTE, CORTE DE TUBO, etc.
      --         pero NO "DISCO DE CORTE" que es un producto físico)
      CASE WHEN lower(trim(ndi.nombre_snap)) LIKE 'corte%' THEN TRUE ELSE FALSE END AS es_corte
    FROM despachos_filtrados nd
    JOIN public.notas_despacho_items ndi ON ndi.despacho_id = nd.id
    LEFT JOIN public.productos p ON p.id = ndi.producto_id

    UNION ALL

    -- Desde cotizacion_items (fallback cuando no hay items de despacho)
    SELECT
      ci.id AS item_id, ci.cotizacion_id, nd.id AS despacho_id_ref,
      ci.codigo_snap, ci.nombre_snap, ci.unidad_snap,
      ci.precio_unit_usd, ci.cantidad,
      COALESCE(p.categoria, '') AS categoria,
      GREATEST(COALESCE(ci.total_linea_usd, 0) - COALESCE(dd.monto_usd, 0), 0) AS total_linea_neto,
      CASE WHEN lower(trim(ci.nombre_snap)) LIKE 'corte%' THEN TRUE ELSE FALSE END AS es_corte
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
      comision_pct_otros   AS cfg_pct_otros,
      COALESCE(_comision_extras, '[]'::jsonb) AS cfg_extras
    FROM public.configuracion_negocio WHERE id = 1
  ),
  items_con_comision AS (
    SELECT
      i.*,
      COALESCE(com.pctcabilla, cfg.cfg_pct_cabilla) AS final_pct_cabilla,
      COALESCE(com.pctotros,   cfg.cfg_pct_otros)   AS final_pct_otros,
      cfg.cfg_extras AS final_extras,
      COALESCE(com.estado, 'pendiente') AS res_estado_comision,
      COALESCE(cl.vendedor_id, nd.vendedor_id) AS dueno_cliente_id,
      COALESCE(com.montopagado,   0) AS res_com_liberada,
      COALESCE(com.totalcomision, 0) AS res_com_total
    FROM items_con_descuento i
    JOIN public.notas_despacho nd ON nd.id = i.despacho_id_ref
    JOIN public.cotizaciones c    ON c.id  = nd.cotizacion_id
    JOIN public.clientes cl       ON cl.id = c.cliente_id
    LEFT JOIN public.comisiones com ON com.despachoid = i.despacho_id_ref
    CROSS JOIN config_tasas cfg
    WHERE (
      p_vendedor_id IS NULL
      OR (p_vendedor_id = v_uuid_nulo AND COALESCE(cl.vendedor_id, nd.vendedor_id) IS NULL)
      OR COALESCE(cl.vendedor_id, nd.vendedor_id) = p_vendedor_id
    )
    -- Excluir ítems de vendedor_sin_comision del reporte detallado
    AND COALESCE(cl.vendedor_id, nd.vendedor_id) NOT IN (
      SELECT id FROM public.usuarios WHERE rol = 'vendedor_sin_comision'
    )
  )
  SELECT
    i.despacho_id_ref AS despacho_id,
    nd.numero         AS despacho_numero,
    COALESCE(nd.entregada_en, nd.creado_en) AS fecha,
    COALESCE(u.nombre, 'Sin asesor') AS asesor,
    COALESCE(u.color,  '#1B365D')    AS asesor_color,
    cl.nombre AS cliente,
    i.codigo_snap     AS codigo,
    i.nombre_snap     AS descripcion,
    i.unidad_snap     AS pza,
    i.precio_unit_usd AS precio,
    i.cantidad        AS cantidad,
    i.total_linea_neto AS total,
    (CASE
      WHEN i.es_corte THEN 0
      WHEN lower(trim(i.categoria)) = v_cat_cabilla THEN i.final_pct_cabilla
      ELSE COALESCE(
        (SELECT (elem->>'pct')::numeric
         FROM jsonb_array_elements(i.final_extras) elem
         WHERE lower(trim(elem->>'cat')) = lower(trim(i.categoria))
         LIMIT 1),
        i.final_pct_otros
      )
    END)::numeric(5,2) AS comision_pct,
    ROUND(i.total_linea_neto * (
      CASE
        WHEN i.es_corte THEN 0
        WHEN lower(trim(i.categoria)) = v_cat_cabilla THEN i.final_pct_cabilla
        ELSE COALESCE(
          (SELECT (elem->>'pct')::numeric
           FROM jsonb_array_elements(i.final_extras) elem
           WHERE lower(trim(elem->>'cat')) = lower(trim(i.categoria))
           LIMIT 1),
          i.final_pct_otros
        )
      END
    ) / 100, 2)::numeric(12,2) AS total_com,
    COALESCE(nd.tasa_snapshot, c.tasa_bcv_snapshot)::numeric(12,4) AS tasa,
    COALESCE(nd.forma_pago, 'Pendiente') AS pago,
    ROUND(i.total_linea_neto * COALESCE(nd.tasa_snapshot, c.tasa_bcv_snapshot), 2)::numeric(12,4) AS total_bs,
    nd.estado AS estado,
    i.res_estado_comision AS estado_comision,
    i.res_com_liberada::numeric(12,2)  AS despacho_comision_liberada,
    i.res_com_total::numeric(12,2)     AS despacho_comision_total
  FROM items_con_comision i
  JOIN public.notas_despacho nd ON nd.id = i.despacho_id_ref
  JOIN public.cotizaciones c    ON c.id  = nd.cotizacion_id
  JOIN public.clientes cl       ON cl.id = c.cliente_id
  LEFT JOIN public.usuarios u   ON u.id  = i.dueno_cliente_id
  WHERE NOT i.es_corte  -- Excluir filas de corte del reporte final
  ORDER BY COALESCE(nd.entregada_en, nd.creado_en) DESC, i.nombre_snap ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.obtener_reporte_ventas_comisiones(TIMESTAMPTZ, TIMESTAMPTZ, UUID)
  TO authenticated, service_role;
