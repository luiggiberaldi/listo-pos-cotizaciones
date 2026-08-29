-- 235_comision_descuento_manual.sql
-- Staging only: la migración 200 reemplazó la RPC de comisiones con una
-- versión que ignoraba despacho_descuentos al calcular el monto comisionable.
-- El descuento de logística debe reducir la comisión, sin cambiar el modelo
-- de CxC manual: crédito => comisión retenida (cta_cobrar).

CREATE OR REPLACE FUNCTION public.calcularcomisiondespacho(p_despachoid UUID)
RETURNS UUID
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_despacho RECORD;
  v_tiene_items_despacho BOOLEAN;
  v_pct_cabilla NUMERIC := 0;
  v_pct_otros NUMERIC := 0;
  v_pct_externos NUMERIC := 0;
  v_extras_json JSONB := '[]'::jsonb;
  v_cat_cabilla TEXT := 'cabilla';
  v_monto_cabilla NUMERIC(12,2) := 0;
  v_monto_otros NUMERIC(12,2) := 0;
  v_monto_externos NUMERIC(12,2) := 0;
  v_total_extras NUMERIC(12,2) := 0;
  v_comision_cabilla NUMERIC(12,2) := 0;
  v_comision_otros NUMERIC(12,2) := 0;
  v_comision_externos NUMERIC(12,2) := 0;
  v_total_comision NUMERIC(12,2) := 0;
  v_estado TEXT;
  v_comisionid UUID;
  v_item RECORD;
  v_item_total NUMERIC(12,4);
  v_extra_pct NUMERIC(5,2);
  v_matched BOOLEAN;
  v_total_usd NUMERIC(12,2);
  v_monto_cxc NUMERIC(12,2) := 0;
  v_fp_text TEXT;
  v_fp JSONB;
  v_fraccion NUMERIC;
  v_liberada NUMERIC(12,2);
  v_retenida NUMERIC(12,2);
  v_fecha_aprob TIMESTAMPTZ;
  i INTEGER;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.comisiones c WHERE c.despachoid = p_despachoid
  ) THEN
    RETURN NULL;
  END IF;

  SELECT nd.id,
         nd.cotizacion_id,
         nd.cuenta_id,
         nd.estado,
         nd.cliente_id,
         cl.vendedor_id AS vendedor_dueno_cliente_id,
         u.rol AS vendedor_rol,
         u.es_externo AS vendedor_es_externo
  INTO v_despacho
  FROM public.notas_despacho nd
  JOIN public.clientes cl ON cl.id = nd.cliente_id
  LEFT JOIN public.usuarios u ON u.id = cl.vendedor_id
  WHERE nd.id = p_despachoid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DESPACHO_NO_ENCONTRADO';
  END IF;

  IF v_despacho.vendedor_dueno_cliente_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_despacho.vendedor_rol IN ('jefe', 'logistica', 'administracion', 'desarrollador')
     OR (v_despacho.vendedor_rol = 'vendedor_sin_comision'
         AND NOT COALESCE(v_despacho.vendedor_es_externo, FALSE)) THEN
    RETURN NULL;
  END IF;

  IF v_despacho.estado NOT IN ('despachada', 'entregada') THEN
    RETURN NULL;
  END IF;
  IF v_despacho.cuenta_id IS NULL THEN
    RAISE EXCEPTION 'CUENTA_ID_REQUERIDO';
  END IF;

  SELECT cn.comision_pct_cabilla,
         cn.comision_pct_otros,
         cn.comision_pct_externos,
         cn._comision_extras,
         COALESCE(NULLIF(trim(cn.comision_categoria_cabilla), ''), 'Cabilla')
  INTO v_pct_cabilla, v_pct_otros, v_pct_externos, v_extras_json, v_cat_cabilla
  FROM public.configuracion_negocio cn
  WHERE cn.cuenta_id = v_despacho.cuenta_id OR cn.id = 1
  ORDER BY CASE WHEN cn.cuenta_id = v_despacho.cuenta_id THEN 0 ELSE 1 END
  LIMIT 1;

  v_pct_cabilla := COALESCE(v_pct_cabilla, 2);
  v_pct_otros := COALESCE(v_pct_otros, 3);
  v_pct_externos := COALESCE(v_pct_externos, 3);
  v_cat_cabilla := lower(trim(COALESCE(v_cat_cabilla, 'Cabilla')));

  IF v_extras_json IS NULL OR jsonb_typeof(v_extras_json) IS DISTINCT FROM 'array' THEN
    BEGIN
      v_extras_json := (v_extras_json #>> '{}')::jsonb;
    EXCEPTION WHEN OTHERS THEN
      v_extras_json := '[]'::jsonb;
    END;
  END IF;
  IF jsonb_typeof(v_extras_json) IS DISTINCT FROM 'array' THEN
    v_extras_json := '[]'::jsonb;
  END IF;

  IF v_despacho.vendedor_rol = 'vendedor_sin_comision' THEN
    v_pct_cabilla := 0;
    v_pct_otros := 0;
    v_pct_externos := 0;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.notas_despacho_items ndi
    WHERE ndi.despacho_id = p_despachoid
  ) INTO v_tiene_items_despacho;

  IF v_tiene_items_despacho THEN
    -- Los snapshots no guardan cotizacion_item_id. Se reparte el descuento
    -- del mismo producto proporcionalmente entre sus líneas para no duplicarlo.
    FOR v_item IN
      SELECT ndi.total_linea_usd,
             ndi.origen,
             ndi.nombre_snap,
             p.categoria,
             ndi.producto_id,
             GREATEST(
               COALESCE(ndi.total_linea_usd, 0)
               - COALESCE((
                   SELECT SUM(dd.monto_usd)
                          * COALESCE(ndi.total_linea_usd, 0)
                          / NULLIF((
                              SELECT SUM(ndi2.total_linea_usd)
                              FROM public.notas_despacho_items ndi2
                              WHERE ndi2.despacho_id = p_despachoid
                                AND ndi2.producto_id = ndi.producto_id
                            ), 0)
                   FROM public.despacho_descuentos dd
                   JOIN public.cotizacion_items ci ON ci.id = dd.cotizacion_item_id
                   WHERE dd.despacho_id = p_despachoid
                     AND ci.producto_id = ndi.producto_id
                 ), 0),
               0
             ) AS total_neto
      FROM public.notas_despacho_items ndi
      LEFT JOIN public.productos p ON p.id = ndi.producto_id
      WHERE ndi.despacho_id = p_despachoid
    LOOP
      v_item_total := COALESCE(v_item.total_neto, 0);
      v_matched := FALSE;

      IF v_item.origen = 'externo' THEN
        v_monto_externos := v_monto_externos + v_item_total;
        v_matched := TRUE;
      ELSIF COALESCE(v_despacho.vendedor_es_externo, FALSE)
            AND (lower(trim(COALESCE(v_item.categoria, ''))) = 'cemento'
                 OR lower(trim(COALESCE(v_item.nombre_snap, ''))) LIKE '%cemento%') THEN
        v_monto_cabilla := v_monto_cabilla + v_item_total;
        v_matched := TRUE;
      ELSIF lower(trim(COALESCE(v_item.categoria, ''))) = v_cat_cabilla THEN
        v_monto_cabilla := v_monto_cabilla + v_item_total;
        v_matched := TRUE;
      ELSE
        FOR i IN 0..jsonb_array_length(v_extras_json) - 1 LOOP
          IF lower(trim(COALESCE(v_item.categoria, ''))) = lower(trim(v_extras_json->i->>'cat')) THEN
            v_extra_pct := COALESCE((v_extras_json->i->>'pct')::numeric, 0);
            v_total_extras := v_total_extras + ROUND(v_item_total * v_extra_pct / 100, 2);
            v_matched := TRUE;
            EXIT;
          END IF;
        END LOOP;
      END IF;

      IF NOT v_matched THEN
        v_monto_otros := v_monto_otros + v_item_total;
      END IF;
    END LOOP;
  ELSE
    -- En el flujo normal se dispone de la relación exacta con la cotización.
    FOR v_item IN
      SELECT ci.total_linea_usd,
             ci.origen,
             ci.nombre_snap,
             p.categoria,
             GREATEST(COALESCE(ci.total_linea_usd, 0) - COALESCE(dd.monto_usd, 0), 0) AS total_neto
      FROM public.cotizacion_items ci
      LEFT JOIN public.productos p ON p.id = ci.producto_id
      LEFT JOIN public.despacho_descuentos dd
        ON dd.despacho_id = p_despachoid
       AND dd.cotizacion_item_id = ci.id
      WHERE ci.cotizacion_id = v_despacho.cotizacion_id
    LOOP
      v_item_total := COALESCE(v_item.total_neto, 0);
      v_matched := FALSE;

      IF v_item.origen = 'externo' THEN
        v_monto_externos := v_monto_externos + v_item_total;
        v_matched := TRUE;
      ELSIF COALESCE(v_despacho.vendedor_es_externo, FALSE)
            AND (lower(trim(COALESCE(v_item.categoria, ''))) = 'cemento'
                 OR lower(trim(COALESCE(v_item.nombre_snap, ''))) LIKE '%cemento%') THEN
        v_monto_cabilla := v_monto_cabilla + v_item_total;
        v_matched := TRUE;
      ELSIF lower(trim(COALESCE(v_item.categoria, ''))) = v_cat_cabilla THEN
        v_monto_cabilla := v_monto_cabilla + v_item_total;
        v_matched := TRUE;
      ELSE
        FOR i IN 0..jsonb_array_length(v_extras_json) - 1 LOOP
          IF lower(trim(COALESCE(v_item.categoria, ''))) = lower(trim(v_extras_json->i->>'cat')) THEN
            v_extra_pct := COALESCE((v_extras_json->i->>'pct')::numeric, 0);
            v_total_extras := v_total_extras + ROUND(v_item_total * v_extra_pct / 100, 2);
            v_matched := TRUE;
            EXIT;
          END IF;
        END LOOP;
      END IF;

      IF NOT v_matched THEN
        v_monto_otros := v_monto_otros + v_item_total;
      END IF;
    END LOOP;
  END IF;

  v_comision_cabilla := ROUND(v_monto_cabilla * v_pct_cabilla / 100, 2);
  v_comision_externos := ROUND(v_monto_externos * v_pct_externos / 100, 2);
  v_comision_otros := ROUND(v_monto_otros * v_pct_otros / 100, 2)
                    + v_comision_externos
                    + v_total_extras;
  v_total_comision := v_comision_cabilla + v_comision_otros;

  -- El descuento también reduce la base usada para el split financiero.
  SELECT GREATEST(COALESCE(nd.total_usd, 0) - COALESCE(nd.descuento_total_usd, 0), 0),
         COALESCE(nd.despachada_en, nd.entregada_en, now()),
         COALESCE(NULLIF(nd.forma_pago_cliente, ''), NULLIF(nd.forma_pago, ''))
  INTO v_total_usd, v_fecha_aprob, v_fp_text
  FROM public.notas_despacho nd
  WHERE nd.id = p_despachoid;

  BEGIN
    v_fp := v_fp_text::jsonb;
    IF jsonb_typeof(v_fp) = 'array' THEN
      SELECT COALESCE(SUM((elem->>'monto')::numeric), 0)
      INTO v_monto_cxc
      FROM jsonb_array_elements(v_fp) elem
      WHERE elem->>'metodo' = 'Cta por cobrar';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    IF lower(trim(v_fp_text)) = lower('Cta por cobrar') THEN
      v_monto_cxc := v_total_usd;
    END IF;
  END;

  v_monto_cxc := LEAST(v_total_usd, GREATEST(0, v_monto_cxc));
  IF v_total_usd > 0 THEN
    v_fraccion := LEAST(1, GREATEST(0, (v_total_usd - v_monto_cxc) / v_total_usd));
  ELSE
    v_fraccion := 1;
  END IF;

  v_liberada := ROUND(v_total_comision * v_fraccion, 2);
  v_retenida := GREATEST(0, v_total_comision - v_liberada);
  v_estado := CASE WHEN v_retenida > 0.01 THEN 'cta_cobrar' ELSE 'pendiente' END;

  INSERT INTO public.comisiones (
    despachoid,
    vendedorid,
    cotizacionid,
    cuentaid,
    totalcomision,
    comisioncabilla,
    comisionotros,
    pctcabilla,
    pctotros,
    estado,
    comision_liberada,
    comision_retenida
  ) VALUES (
    p_despachoid,
    v_despacho.vendedor_dueno_cliente_id,
    v_despacho.cotizacion_id,
    v_despacho.cuenta_id,
    v_total_comision,
    v_comision_cabilla,
    v_comision_otros,
    v_pct_cabilla,
    v_pct_otros,
    v_estado,
    v_liberada,
    v_retenida
  ) RETURNING id INTO v_comisionid;

  IF v_liberada > 0 THEN
    INSERT INTO public.comision_liberaciones (
      comision_id, despacho_id, vendedor_id, cuenta_id, monto, tipo, creado_en
    ) VALUES (
      v_comisionid, p_despachoid, v_despacho.vendedor_dueno_cliente_id,
      v_despacho.cuenta_id, v_liberada, 'contado', v_fecha_aprob
    );
  END IF;

  RETURN v_comisionid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.calcularcomisiondespacho(UUID) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
