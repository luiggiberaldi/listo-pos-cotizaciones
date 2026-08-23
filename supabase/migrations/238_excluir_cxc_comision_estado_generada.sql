-- 238: Excluir CxC de totalcomision + estado único 'generada'
--
-- MODELO NUEVO (acordado con negocio 22/08/2026):
--   * CxC nunca se incluye en comisiones (se calculan manualmente por admin).
--   * totalcomision = solo porción contado + COD + otros métodos no-CxC.
--   * estado único 'generada' (sin ciclo de pago pendiente/pagada/cta_cobrar).
--   * comision_liberada = totalcomision, comision_retenida = 0 siempre.
--   * No se inserta en comision_liberaciones (sin trigger de pago).
--   * Columnas legacy (montopagado, pagadaen, pagadapor) se ignoran, no se dropean.

-- ── 1. Agregar 'generada' al CHECK constraint de comisiones ──────────────────
ALTER TABLE public.comisiones DROP CONSTRAINT IF EXISTS comisiones_estado_check;
ALTER TABLE public.comisiones ADD CONSTRAINT comisiones_estado_check
  CHECK (estado IN ('pendiente', 'cta_cobrar', 'pagada', 'generada'));

-- ── 2. Redefinir calcularcomisiondespacho (totalcomision sobre no-CxC) ───────
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
  v_pct_externos NUMERIC;
  v_extras_json JSONB;
  v_cat_cabilla TEXT;
  v_monto_cabilla NUMERIC(12,2) := 0;
  v_monto_otros NUMERIC(12,2) := 0;
  v_monto_externos NUMERIC(12,2) := 0;
  v_comision_cabilla NUMERIC(12,2) := 0;
  v_comision_otros NUMERIC(12,2) := 0;
  v_comision_externos NUMERIC(12,2) := 0;
  v_total_comision NUMERIC(12,2) := 0;
  v_comisionid UUID;

  -- Variables para el cálculo de CxC (se calculan antes de las comisiones)
  v_total_usd     NUMERIC(12,2);
  v_monto_cxc     NUMERIC(12,2) := 0;
  v_monto_no_cxc  NUMERIC(12,2) := 0;
  v_fp_text       TEXT;
  v_fp            JSONB;
  v_fraccion_no_cxc NUMERIC;
  v_tiene_metodo_cxc BOOLEAN := FALSE;
  v_excluida_por_pago BOOLEAN := FALSE;
BEGIN
  -- Si ya tiene registro de comisión calculado, omitir
  IF EXISTS (SELECT 1 FROM public.comisiones WHERE despachoid = p_despachoid) THEN
    RETURN NULL;
  END IF;

  SELECT nd.id, nd.cotizacion_id, nd.cuenta_id, nd.estado, nd.cliente_id,
         cl.vendedor_id AS vendedor_dueno_cliente_id,
         u.rol AS vendedor_rol,
         u.es_externo AS vendedor_es_externo
  INTO v_despacho
  FROM public.notas_despacho nd
  JOIN public.clientes cl ON cl.id = nd.cliente_id
  LEFT JOIN public.usuarios u ON u.id = cl.vendedor_id
  WHERE nd.id = p_despachoid;

  IF NOT FOUND THEN RAISE EXCEPTION 'DESPACHO_NO_ENCONTRADO'; END IF;

  IF v_despacho.vendedor_dueno_cliente_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- NO generar comisión para roles administrativos, ni para vendedor_sin_comision a menos que sea externo
  IF v_despacho.vendedor_rol IN ('jefe', 'logistica', 'administracion', 'desarrollador') OR
     (v_despacho.vendedor_rol = 'vendedor_sin_comision' AND NOT COALESCE(v_despacho.vendedor_es_externo, FALSE)) THEN
    RETURN NULL;
  END IF;

  -- Permitir estado 'despachada' (aprobado por administración) o 'entregada' (logística)
  IF v_despacho.estado NOT IN ('despachada', 'entregada') THEN RETURN NULL; END IF;
  IF v_despacho.cuenta_id IS NULL THEN RAISE EXCEPTION 'CUENTA_ID_REQUERIDO'; END IF;

  -- ── Calcular la porción CxC ANTES de calcular comisiones ──────────────────
  SELECT COALESCE(nd.total_usd, 0),
         COALESCE(NULLIF(nd.forma_pago_cliente, ''), NULLIF(nd.forma_pago, ''))
    INTO v_total_usd, v_fp_text
  FROM public.notas_despacho nd WHERE nd.id = p_despachoid;

  BEGIN
    v_fp := v_fp_text::jsonb;
    IF v_fp IS NOT NULL AND jsonb_typeof(v_fp) IN ('array', 'object') THEN
      IF jsonb_typeof(v_fp) = 'object' THEN
        IF v_fp ? 'metodos_pagados' THEN
          v_fp := v_fp->'metodos_pagados';
        ELSE
          v_fp := jsonb_build_array(v_fp);
        END IF;
      END IF;

      IF jsonb_typeof(v_fp) <> 'array' THEN
        v_fp := '[]'::jsonb;
      END IF;

      -- Aplanar metodos definitivos de formatos COD/legacy sin contar el
      -- metodo contenedor como un pago adicional.
      SELECT COALESCE(jsonb_agg(flattened.value), '[]'::jsonb)
        INTO v_fp
      FROM (
        SELECT source.elem AS value
        FROM jsonb_array_elements(v_fp) AS source(elem)
        WHERE NOT (
          jsonb_typeof(source.elem) = 'object'
          AND source.elem ?| ARRAY['metodos_pagados', 'metodo_propuesto', 'formas_pago', 'pagos', 'payments']::TEXT[]
        )
        UNION ALL
        SELECT nested.value
        FROM jsonb_array_elements(v_fp) AS source(elem)
        CROSS JOIN LATERAL jsonb_each(
          CASE WHEN jsonb_typeof(source.elem) = 'object' THEN source.elem ELSE '{}'::jsonb END
        ) AS wrapper(key, value)
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(wrapper.value) = 'array' THEN wrapper.value ELSE '[]'::jsonb END
        ) AS nested(value)
        WHERE wrapper.key = ANY (ARRAY['metodos_pagados', 'metodo_propuesto', 'formas_pago', 'pagos', 'payments']::TEXT[])
      ) AS flattened;

      SELECT COALESCE(SUM(CASE
        WHEN COALESCE(elem->>'monto', elem->>'amount', elem->>'valor', '') ~ '^-?[0-9]+([.][0-9]+)?$' THEN COALESCE(elem->>'monto', elem->>'amount', elem->>'valor')::numeric
        ELSE 0
      END), 0)
        INTO v_monto_cxc
      FROM jsonb_array_elements(v_fp) elem
      WHERE lower(translate(trim(COALESCE(elem->>'metodo', elem->>'metodo_pago', elem->>'method', elem->>'formaPago', '')), 'áéíóúüÁÉÍÓÚÜ', 'aeiouuAEIOUU')) = 'cxc'
         OR lower(translate(trim(COALESCE(elem->>'metodo', elem->>'metodo_pago', elem->>'method', elem->>'formaPago', '')), 'áéíóúüÁÉÍÓÚÜ', 'aeiouuAEIOUU')) LIKE '%cta por cobrar%'
         OR lower(translate(trim(COALESCE(elem->>'metodo', elem->>'metodo_pago', elem->>'method', elem->>'formaPago', '')), 'áéíóúüÁÉÍÓÚÜ', 'aeiouuAEIOUU')) LIKE '%cuenta por cobrar%'
         OR lower(translate(trim(COALESCE(elem->>'metodo', elem->>'metodo_pago', elem->>'method', elem->>'formaPago', '')), 'áéíóúüÁÉÍÓÚÜ', 'aeiouuAEIOUU')) LIKE '%credito%'
         OR lower(translate(trim(COALESCE(elem->>'metodo', elem->>'metodo_pago', elem->>'method', elem->>'formaPago', '')), 'áéíóúüÁÉÍÓÚÜ', 'aeiouuAEIOUU')) LIKE '%credit%';

      SELECT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(v_fp) elem
        WHERE lower(translate(trim(COALESCE(elem->>'metodo', elem->>'metodo_pago', elem->>'method', elem->>'formaPago', '')), 'áéíóúüÁÉÍÓÚÜ', 'aeiouuAEIOUU')) LIKE 'donac%'
           OR lower(translate(trim(COALESCE(elem->>'metodo', elem->>'metodo_pago', elem->>'method', elem->>'formaPago', '')), 'áéíóúüÁÉÍÓÚÜ', 'aeiouuAEIOUU')) LIKE 'prestam%'
      ) INTO v_excluida_por_pago;

      SELECT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(v_fp) elem
        WHERE jsonb_typeof(elem) = 'object'
          AND (
            lower(translate(trim(COALESCE(elem->>'metodo', elem->>'metodo_pago', elem->>'method', elem->>'formaPago', '')), 'áéíóúüÁÉÍÓÚÜ', 'aeiouuAEIOUU')) = 'cxc'
            OR lower(translate(trim(COALESCE(elem->>'metodo', elem->>'metodo_pago', elem->>'method', elem->>'formaPago', '')), 'áéíóúüÁÉÍÓÚÜ', 'aeiouuAEIOUU')) LIKE '%cta por cobrar%'
            OR lower(translate(trim(COALESCE(elem->>'metodo', elem->>'metodo_pago', elem->>'method', elem->>'formaPago', '')), 'áéíóúüÁÉÍÓÚÜ', 'aeiouuAEIOUU')) LIKE '%cuenta por cobrar%'
            OR lower(translate(trim(COALESCE(elem->>'metodo', elem->>'metodo_pago', elem->>'method', elem->>'formaPago', '')), 'áéíóúüÁÉÍÓÚÜ', 'aeiouuAEIOUU')) LIKE '%credito%'
            OR lower(translate(trim(COALESCE(elem->>'metodo', elem->>'metodo_pago', elem->>'method', elem->>'formaPago', '')), 'áéíóúüÁÉÍÓÚÜ', 'aeiouuAEIOUU')) LIKE '%credit%'
          )
      ) INTO v_tiene_metodo_cxc;

      IF v_tiene_metodo_cxc AND v_monto_cxc <= 0 THEN
        SELECT COALESCE(SUM(CASE
          WHEN NOT (
            lower(translate(trim(COALESCE(elem->>'metodo', elem->>'metodo_pago', elem->>'method', elem->>'formaPago', '')), 'áéíóúüÁÉÍÓÚÜ', 'aeiouuAEIOUU')) = 'cxc'
            OR lower(translate(trim(COALESCE(elem->>'metodo', elem->>'metodo_pago', elem->>'method', elem->>'formaPago', '')), 'áéíóúüÁÉÍÓÚÜ', 'aeiouuAEIOUU')) LIKE '%cta por cobrar%'
            OR lower(translate(trim(COALESCE(elem->>'metodo', elem->>'metodo_pago', elem->>'method', elem->>'formaPago', '')), 'áéíóúüÁÉÍÓÚÜ', 'aeiouuAEIOUU')) LIKE '%cuenta por cobrar%'
            OR lower(translate(trim(COALESCE(elem->>'metodo', elem->>'metodo_pago', elem->>'method', elem->>'formaPago', '')), 'áéíóúüÁÉÍÓÚÜ', 'aeiouuAEIOUU')) LIKE '%credito%'
            OR lower(translate(trim(COALESCE(elem->>'metodo', elem->>'metodo_pago', elem->>'method', elem->>'formaPago', '')), 'áéíóúüÁÉÍÓÚÜ', 'aeiouuAEIOUU')) LIKE '%credit%'
          )
          THEN CASE
            WHEN COALESCE(elem->>'monto', elem->>'amount', elem->>'valor', '') ~ '^-?[0-9]+([.][0-9]+)?$' THEN COALESCE(elem->>'monto', elem->>'amount', elem->>'valor')::numeric
            ELSE 0
          END
          ELSE 0
        END), 0)
          INTO v_monto_no_cxc
        FROM jsonb_array_elements(v_fp) elem
        WHERE jsonb_typeof(elem) = 'object';

        v_monto_cxc := CASE
          WHEN v_monto_no_cxc > 0 THEN GREATEST(0, v_total_usd - v_monto_no_cxc)
          ELSE v_total_usd
        END;
      END IF;
    END IF;
    IF v_fp IS NULL OR jsonb_typeof(v_fp) NOT IN ('array', 'object') THEN
      IF lower(translate(trim(COALESCE(v_fp_text, '')), 'áéíóúüÁÉÍÓÚÜ', 'aeiouuAEIOUU')) = 'cxc'
         OR lower(translate(trim(COALESCE(v_fp_text, '')), 'áéíóúüÁÉÍÓÚÜ', 'aeiouuAEIOUU')) LIKE '%cta por cobrar%'
         OR lower(translate(trim(COALESCE(v_fp_text, '')), 'áéíóúüÁÉÍÓÚÜ', 'aeiouuAEIOUU')) LIKE '%cuenta por cobrar%'
         OR lower(translate(trim(COALESCE(v_fp_text, '')), 'áéíóúüÁÉÍÓÚÜ', 'aeiouuAEIOUU')) LIKE '%credito%'
         OR lower(translate(trim(COALESCE(v_fp_text, '')), 'áéíóúüÁÉÍÓÚÜ', 'aeiouuAEIOUU')) LIKE '%credit%' THEN
        v_tiene_metodo_cxc := TRUE;
        v_monto_cxc := v_total_usd;
      END IF;
    END IF;
  EXCEPTION WHEN others THEN
    IF lower(translate(trim(COALESCE(v_fp_text, '')), 'áéíóúüÁÉÍÓÚÜ', 'aeiouuAEIOUU')) = 'cxc'
       OR lower(translate(trim(COALESCE(v_fp_text, '')), 'áéíóúüÁÉÍÓÚÜ', 'aeiouuAEIOUU')) LIKE '%cta por cobrar%'
       OR lower(translate(trim(COALESCE(v_fp_text, '')), 'áéíóúüÁÉÍÓÚÜ', 'aeiouuAEIOUU')) LIKE '%cuenta por cobrar%'
       OR lower(translate(trim(COALESCE(v_fp_text, '')), 'áéíóúüÁÉÍÓÚÜ', 'aeiouuAEIOUU')) LIKE '%credito%'
       OR lower(translate(trim(COALESCE(v_fp_text, '')), 'áéíóúüÁÉÍÓÚÜ', 'aeiouuAEIOUU')) LIKE '%credit%' THEN
      v_monto_cxc := v_total_usd;
    ELSE
      v_monto_cxc := 0;
    END IF;
    v_excluida_por_pago := lower(translate(trim(COALESCE(v_fp_text, '')), 'áéíóúüÁÉÍÓÚÜ', 'aeiouuAEIOUU')) LIKE '%donac%'
      OR lower(translate(trim(COALESCE(v_fp_text, '')), 'áéíóúüÁÉÍÓÚÜ', 'aeiouuAEIOUU')) LIKE '%prestam%';
  END;

  IF v_monto_cxc < 0 THEN v_monto_cxc := 0; END IF;
  IF v_monto_cxc > v_total_usd THEN v_monto_cxc := v_total_usd; END IF;

  IF v_excluida_por_pago THEN
    v_fraccion_no_cxc := 0;
  ELSIF v_total_usd > 0 THEN
    v_fraccion_no_cxc := LEAST(1, GREATEST(0, (v_total_usd - v_monto_cxc) / v_total_usd));
  ELSE
    v_fraccion_no_cxc := 1;
  END IF;

  -- ── Obtener configuración global (interna y externa) ──────────────────────
  DECLARE
    v_cfg RECORD;
  BEGIN
    SELECT
      cn.comision_pct_cabilla,
      cn.comision_pct_otros,
      cn.comision_pct_externos,
      cn._comision_extras,
      cn.comision_ext_pct_cabilla,
      cn.comision_ext_pct_otros,
      cn.comision_ext_pct_externos,
      cn._comision_ext_extras,
      COALESCE(NULLIF(trim(cn.comision_categoria_cabilla), ''), 'Cabilla') AS comision_categoria_cabilla
    INTO v_cfg
    FROM public.configuracion_negocio cn
    WHERE cn.cuenta_id = v_despacho.cuenta_id OR cn.id = 1
    ORDER BY CASE WHEN cn.cuenta_id = v_despacho.cuenta_id THEN 0 ELSE 1 END
    LIMIT 1;

    IF NOT FOUND THEN
      v_pct_cabilla := 0;
      v_pct_otros := 0;
      v_pct_externos := 3;
      v_extras_json := '[]'::jsonb;
      v_cat_cabilla := 'cabilla';
    ELSE
      v_cat_cabilla := lower(trim(v_cfg.comision_categoria_cabilla));

      IF COALESCE(v_despacho.vendedor_es_externo, FALSE) THEN
        v_pct_cabilla := COALESCE(v_cfg.comision_ext_pct_cabilla, 2.00);
        v_pct_otros   := COALESCE(v_cfg.comision_ext_pct_otros, 3.00);
        v_pct_externos := COALESCE(v_cfg.comision_ext_pct_externos, 3.00);
        v_extras_json := COALESCE(v_cfg._comision_ext_extras, '[]'::jsonb);
      ELSE
        v_pct_cabilla := COALESCE(v_cfg.comision_pct_cabilla, 2.00);
        v_pct_otros   := COALESCE(v_cfg.comision_pct_otros, 3.00);
        v_pct_externos := COALESCE(v_cfg.comision_pct_externos, 3.00);
        v_extras_json := COALESCE(v_cfg._comision_extras, '[]'::jsonb);
      END IF;
    END IF;
  END;

  -- Si es vendedor_sin_comision, forzar tasas a 0%
  IF v_despacho.vendedor_rol = 'vendedor_sin_comision' THEN
    v_pct_cabilla := 0;
    v_pct_otros := 0;
    v_pct_externos := 0;
  END IF;

  -- ── Calcular montos base por categoría (sin cambios respecto a 200) ──────
  SELECT EXISTS (
    SELECT 1 FROM public.notas_despacho_items ndi WHERE ndi.despacho_id = p_despachoid
  ) INTO v_tiene_items_despacho;

  IF v_tiene_items_despacho THEN
    SELECT
      COALESCE(SUM(CASE
        WHEN COALESCE(ndi.es_prestamo, FALSE) THEN 0
        WHEN lower(trim(COALESCE(ndi.nombre_snap, ''))) LIKE 'corte%' THEN 0
        WHEN ndi.origen = 'externo' THEN 0
        WHEN COALESCE(v_despacho.vendedor_es_externo, FALSE) AND (lower(trim(COALESCE(p.categoria,''))) = 'cemento' OR lower(trim(ndi.nombre_snap)) LIKE '%cemento%') THEN ndi.total_linea_usd
        WHEN lower(trim(COALESCE(p.categoria,''))) = v_cat_cabilla THEN ndi.total_linea_usd
        ELSE 0
      END), 0),
      COALESCE(SUM(CASE
        WHEN COALESCE(ndi.es_prestamo, FALSE) THEN 0
        WHEN lower(trim(ndi.nombre_snap)) LIKE 'corte%' THEN 0
        WHEN ndi.origen = 'externo' THEN 0
        WHEN COALESCE(v_despacho.vendedor_es_externo, FALSE) AND (lower(trim(COALESCE(p.categoria,''))) = 'cemento' OR lower(trim(ndi.nombre_snap)) LIKE '%cemento%') THEN 0
        WHEN lower(trim(COALESCE(p.categoria,''))) = v_cat_cabilla THEN 0
        ELSE ndi.total_linea_usd
      END), 0),
      COALESCE(SUM(CASE
        WHEN COALESCE(ndi.es_prestamo, FALSE) THEN 0
        WHEN lower(trim(ndi.nombre_snap)) LIKE 'corte%' THEN 0
        WHEN ndi.origen = 'externo' THEN ndi.total_linea_usd
        ELSE 0
      END), 0)
    INTO v_monto_cabilla, v_monto_otros, v_monto_externos
    FROM public.notas_despacho_items ndi
    LEFT JOIN public.productos p ON p.id = ndi.producto_id
    WHERE ndi.despacho_id = p_despachoid;
  ELSE
    SELECT
      COALESCE(SUM(CASE
        WHEN lower(trim(COALESCE(ci.nombre_snap, ''))) LIKE 'corte%' THEN 0
        WHEN ci.origen = 'externo' THEN 0
        WHEN COALESCE(v_despacho.vendedor_es_externo, FALSE) AND (lower(trim(COALESCE(p.categoria,''))) = 'cemento' OR lower(trim(ci.nombre_snap)) LIKE '%cemento%') THEN ci.total_linea_usd
        WHEN lower(trim(COALESCE(p.categoria,''))) = v_cat_cabilla THEN ci.total_linea_usd
        ELSE 0
      END), 0),
      COALESCE(SUM(CASE
        WHEN lower(trim(COALESCE(ci.nombre_snap, ''))) LIKE 'corte%' THEN 0
        WHEN ci.origen = 'externo' THEN 0
        WHEN COALESCE(v_despacho.vendedor_es_externo, FALSE) AND (lower(trim(COALESCE(p.categoria,''))) = 'cemento' OR lower(trim(ci.nombre_snap)) LIKE '%cemento%') THEN 0
        WHEN lower(trim(COALESCE(p.categoria,''))) = v_cat_cabilla THEN 0
        ELSE ci.total_linea_usd
      END), 0),
      COALESCE(SUM(CASE
        WHEN lower(trim(ci.nombre_snap)) LIKE 'corte%' THEN 0
        WHEN ci.origen = 'externo' THEN ci.total_linea_usd
        ELSE 0
      END), 0)
    INTO v_monto_cabilla, v_monto_otros, v_monto_externos
    FROM public.cotizacion_items ci
    LEFT JOIN public.productos p ON p.id = ci.producto_id
    WHERE ci.cotizacion_id = v_despacho.cotizacion_id;
  END IF;

  -- ── Calcular comisión base, luego escalar por fracción no-CxC ────────────
  v_comision_cabilla := ROUND((v_monto_cabilla * v_pct_cabilla / 100)::numeric, 2);
  v_comision_externos := ROUND((v_monto_externos * v_pct_externos / 100)::numeric, 2);
  v_comision_otros   := ROUND((v_monto_otros   * v_pct_otros   / 100)::numeric, 2) + v_comision_externos;

  -- Aplicar fracción no-CxC (solo contado + COD + otros métodos generan comisión)
  v_comision_cabilla := ROUND((v_comision_cabilla * v_fraccion_no_cxc)::numeric, 2);
  v_comision_otros   := ROUND((v_comision_otros   * v_fraccion_no_cxc)::numeric, 2);

  v_total_comision := v_comision_cabilla + v_comision_otros;

  -- ── Insertar con estado único 'generada' ──────────────────────────────────
  INSERT INTO public.comisiones (
    despachoid, vendedorid, cotizacionid, cuentaid,
    totalcomision, comisioncabilla, comisionotros, pctcabilla, pctotros, estado,
    comision_liberada, comision_retenida
  ) VALUES (
    p_despachoid, v_despacho.vendedor_dueno_cliente_id, v_despacho.cotizacion_id, v_despacho.cuenta_id,
    v_total_comision, v_comision_cabilla, v_comision_otros, v_pct_cabilla, v_pct_otros, 'generada',
    v_total_comision, 0
  ) RETURNING id INTO v_comisionid;

  -- Sin inserción en comision_liberaciones (no hay ciclo de pago)

  RETURN v_comisionid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.calcularcomisiondespacho(UUID) TO authenticated, service_role;

-- ── 3. Simplificar obtener_resumen_comisiones_v2 ─────────────────────────────
-- Ya no hay ciclo de pago: devuelve total generado + conteo simple.
DROP FUNCTION IF EXISTS public.obtener_resumen_comisiones_v2(UUID, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.obtener_resumen_comisiones_v2(
  p_cuenta_id UUID,
  p_vendedor_id UUID DEFAULT NULL,
  p_estado TEXT DEFAULT NULL,
  p_fecha_inicio TIMESTAMPTZ DEFAULT NULL,
  p_fecha_fin TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  totalAcumulado NUMERIC,
  pendientePago NUMERIC,
  yaPagado NUMERIC,
  numPendientes BIGINT,
  numPagadas BIGINT,
  total BIGINT,
  pendienteRegular NUMERIC,
  pendienteCxc NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_uuid_nulo CONSTANT UUID := '00000000-0000-0000-0000-000000000000';
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(SUM(c.totalcomision), 0)::NUMERIC AS totalAcumulado,
    0::NUMERIC AS pendientePago,   -- sin ciclo de pago
    0::NUMERIC AS yaPagado,        -- sin ciclo de pago
    0::BIGINT AS numPendientes,    -- sin ciclo de pago
    0::BIGINT AS numPagadas,       -- sin ciclo de pago
    COUNT(DISTINCT c.id)::BIGINT AS total,
    0::NUMERIC AS pendienteRegular, -- sin ciclo de pago
    0::NUMERIC AS pendienteCxc      -- sin ciclo de pago
  FROM public.comisiones c
  JOIN public.notas_despacho nd ON nd.id = c.despachoid
  WHERE c.cuentaid = p_cuenta_id
    AND (
      p_vendedor_id IS NULL
      OR (p_vendedor_id = v_uuid_nulo AND c.vendedorid IS NULL)
      OR (c.vendedorid = p_vendedor_id)
    )
    AND (p_fecha_inicio IS NULL OR nd.creado_en >= p_fecha_inicio)
    AND (p_fecha_fin IS NULL OR nd.creado_en <= p_fecha_fin)
    AND (
      (p_estado IS NULL AND c.estado = 'generada')
      OR (p_estado IS NOT NULL AND c.estado = p_estado)
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.obtener_resumen_comisiones_v2(UUID, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';