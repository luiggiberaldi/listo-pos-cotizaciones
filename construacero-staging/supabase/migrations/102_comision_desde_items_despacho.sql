-- 102_comision_desde_items_despacho.sql
-- Fix: calcular_comision_despacho ahora usa notas_despacho_items como fuente
-- primaria de precios/cantidades. Si existen ítems editados por administración,
-- la comisión se calcula sobre los valores reales despachados, no los originales
-- de la cotización. Fallback a cotizacion_items si no hay snapshot del despacho.

CREATE OR REPLACE FUNCTION public.calcular_comision_despacho(
  p_despacho_id UUID
)
RETURNS UUID
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_despacho        RECORD;
  v_config          RECORD;
  v_monto_cabilla   NUMERIC(12,2) := 0;
  v_monto_otros     NUMERIC(12,2) := 0;
  v_item            RECORD;
  v_cat_cabilla     TEXT;
  v_comision_id     UUID;
  v_extras          JSONB;
  v_raw_extras      JSONB;
  v_extras_montos   JSONB := '[]'::jsonb;
  v_extra_cat       TEXT;
  v_extra_pct       NUMERIC(5,2);
  v_extra_monto     NUMERIC(12,2);
  v_matched         BOOLEAN;
  v_total_extras    NUMERIC(12,2) := 0;
  i                 INT;
  v_tiene_items_despacho BOOLEAN := FALSE;

  -- Variables para recaudo
  v_total_comision  NUMERIC(12,2) := 0;
  v_estado_inicial  TEXT := 'retenida';
  v_comision_lib    NUMERIC(12,2) := 0;
  v_comision_ret    NUMERIC(12,2) := 0;
  v_porcentaje_abn  NUMERIC := 0;
  v_total_abonos    NUMERIC(12,2) := 0;
  v_total_despacho  NUMERIC(12,2) := 0;
  v_es_credito      BOOLEAN := FALSE;
BEGIN
  -- Si ya existe comisión para este despacho, retornar NULL (idempotente)
  IF EXISTS (SELECT 1 FROM public.comisiones WHERE despacho_id = p_despacho_id) THEN
    RETURN NULL;
  END IF;

  -- Obtener despacho + vendedor de la cotización
  SELECT nd.*, c.vendedor_id AS cot_vendedor_id
  INTO v_despacho
  FROM public.notas_despacho nd
  JOIN public.cotizaciones c ON c.id = nd.cotizacion_id
  WHERE nd.id = p_despacho_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DESPACHO_NO_ENCONTRADO';
  END IF;

  -- Verificar si existen ítems en notas_despacho_items (edición de admin)
  SELECT EXISTS (
    SELECT 1 FROM public.notas_despacho_items WHERE despacho_id = p_despacho_id
  ) INTO v_tiene_items_despacho;

  -- Calcular prorrateo inicial basado en abonos existentes o forma de pago
  v_total_despacho := COALESCE(v_despacho.total_usd, 0);
  
  IF COALESCE(v_despacho.forma_pago::text, '') ILIKE '%Credito%' OR
     COALESCE(v_despacho.forma_pago_cliente::text, '') ILIKE '%Credito%' OR
     COALESCE(v_despacho.forma_pago::text, '') ILIKE '%Cta por cobrar%' OR
     COALESCE(v_despacho.forma_pago_cliente::text, '') ILIKE '%Cta por cobrar%' THEN
    v_es_credito := TRUE;
  END IF;

  IF v_es_credito THEN
    SELECT COALESCE(SUM(monto_usd), 0) INTO v_total_abonos
    FROM public.cuentas_por_cobrar
    WHERE despacho_id = p_despacho_id AND tipo = 'abono';

    IF v_total_despacho > 0 THEN
      v_porcentaje_abn := v_total_abonos / v_total_despacho;
    ELSE
      v_porcentaje_abn := 1;
    END IF;
  ELSE
    -- Venta de contado: no se retiene nada
    v_porcentaje_abn := 1;
  END IF;

  IF v_porcentaje_abn > 1 THEN
    v_porcentaje_abn := 1;
  END IF;

  -- Obtener configuración de tasas
  SELECT comision_pct_cabilla, comision_pct_otros, comision_categoria_cabilla,
         COALESCE(_comision_extras, '[]'::jsonb) AS _comision_extras
  INTO v_config
  FROM public.configuracion_negocio
  WHERE id = 1;

  v_cat_cabilla := lower(trim(v_config.comision_categoria_cabilla));

  -- Manejar JSONB de extras (string-encoded vs native)
  v_raw_extras := v_config._comision_extras;
  IF jsonb_typeof(v_raw_extras) = 'string' THEN
    v_extras := (v_raw_extras #>> '{}')::jsonb;
  ELSE
    v_extras := v_raw_extras;
  END IF;
  IF jsonb_typeof(v_extras) != 'array' THEN
    v_extras := '[]'::jsonb;
  END IF;

  -- Inicializar acumulador de extras
  FOR i IN 0..jsonb_array_length(v_extras) - 1 LOOP
    v_extras_montos := v_extras_montos || jsonb_build_object(
      'cat',     v_extras->i->>'cat',
      'pct',     (v_extras->i->>'pct')::numeric,
      'monto',   0,
      'comision', 0
    );
  END LOOP;

  -- ─── FUENTE DE ÍTEMS ──────────────────────────────────────────────────────
  -- Prioridad 1: notas_despacho_items (valores editados por administración)
  -- Prioridad 2: cotizacion_items      (valores originales de la cotización)
  -- ─────────────────────────────────────────────────────────────────────────

  IF v_tiene_items_despacho THEN
    -- Usar ítems reales del despacho
    FOR v_item IN
      SELECT ndi.total_linea_usd,
             COALESCE(p.categoria, '') AS categoria
      FROM public.notas_despacho_items ndi
      LEFT JOIN public.productos p ON p.id = ndi.producto_id
      WHERE ndi.despacho_id = p_despacho_id
    LOOP
      v_matched := false;

      IF lower(trim(COALESCE(v_item.categoria, ''))) = v_cat_cabilla THEN
        v_monto_cabilla := v_monto_cabilla + COALESCE(v_item.total_linea_usd, 0);
        v_matched := true;
      END IF;

      IF NOT v_matched THEN
        FOR i IN 0..jsonb_array_length(v_extras) - 1 LOOP
          v_extra_cat := lower(trim(v_extras->i->>'cat'));
          IF lower(trim(COALESCE(v_item.categoria, ''))) = v_extra_cat THEN
            v_extra_monto := COALESCE((v_extras_montos->i->>'monto')::numeric, 0) + COALESCE(v_item.total_linea_usd, 0);
            v_extra_pct   := (v_extras->i->>'pct')::numeric;
            v_extras_montos := jsonb_set(v_extras_montos, ARRAY[i::text, 'monto'],   to_jsonb(v_extra_monto));
            v_extras_montos := jsonb_set(v_extras_montos, ARRAY[i::text, 'comision'], to_jsonb(ROUND(v_extra_monto * v_extra_pct / 100, 2)));
            v_matched := true;
            EXIT;
          END IF;
        END LOOP;
      END IF;

      IF NOT v_matched THEN
        v_monto_otros := v_monto_otros + COALESCE(v_item.total_linea_usd, 0);
      END IF;
    END LOOP;

  ELSE
    -- Fallback: usar ítems originales de la cotización
    FOR v_item IN
      SELECT ci.total_linea_usd,
             COALESCE(p.categoria, '') AS categoria
      FROM public.cotizacion_items ci
      LEFT JOIN public.productos p ON p.id = ci.producto_id
      WHERE ci.cotizacion_id = v_despacho.cotizacion_id
    LOOP
      v_matched := false;

      IF lower(trim(COALESCE(v_item.categoria, ''))) = v_cat_cabilla THEN
        v_monto_cabilla := v_monto_cabilla + COALESCE(v_item.total_linea_usd, 0);
        v_matched := true;
      END IF;

      IF NOT v_matched THEN
        FOR i IN 0..jsonb_array_length(v_extras) - 1 LOOP
          v_extra_cat := lower(trim(v_extras->i->>'cat'));
          IF lower(trim(COALESCE(v_item.categoria, ''))) = v_extra_cat THEN
            v_extra_monto := COALESCE((v_extras_montos->i->>'monto')::numeric, 0) + COALESCE(v_item.total_linea_usd, 0);
            v_extra_pct   := (v_extras->i->>'pct')::numeric;
            v_extras_montos := jsonb_set(v_extras_montos, ARRAY[i::text, 'monto'],   to_jsonb(v_extra_monto));
            v_extras_montos := jsonb_set(v_extras_montos, ARRAY[i::text, 'comision'], to_jsonb(ROUND(v_extra_monto * v_extra_pct / 100, 2)));
            v_matched := true;
            EXIT;
          END IF;
        END LOOP;
      END IF;

      IF NOT v_matched THEN
        v_monto_otros := v_monto_otros + COALESCE(v_item.total_linea_usd, 0);
      END IF;
    END LOOP;
  END IF;

  -- Calcular total de extras
  FOR i IN 0..jsonb_array_length(v_extras_montos) - 1 LOOP
    v_total_extras := v_total_extras + COALESCE((v_extras_montos->i->>'comision')::numeric, 0);
  END LOOP;

  -- Calcular total general
  v_total_comision := ROUND(v_monto_cabilla * v_config.comision_pct_cabilla / 100, 2)
                    + ROUND(v_monto_otros   * v_config.comision_pct_otros   / 100, 2)
                    + v_total_extras;

  -- Determinar liberada vs retenida
  v_comision_lib := ROUND(v_total_comision * v_porcentaje_abn, 2);
  v_comision_ret := GREATEST(0, v_total_comision - v_comision_lib);

  IF v_porcentaje_abn >= 1 THEN
    v_estado_inicial := 'liberada';
  ELSIF v_porcentaje_abn > 0 THEN
    v_estado_inicial := 'pago_parcial';
  ELSE
    v_estado_inicial := 'retenida';
  END IF;

  -- Insertar comisión
  INSERT INTO public.comisiones (
    despacho_id, vendedor_id, cotizacion_id,
    monto_cabilla, monto_otros,
    pct_cabilla, pct_otros,
    comision_cabilla, comision_otros, total_comision,
    detalle_extras,
    comision_liberada, comision_retenida, estado
  ) VALUES (
    p_despacho_id,
    v_despacho.cot_vendedor_id,
    v_despacho.cotizacion_id,
    v_monto_cabilla,
    v_monto_otros,
    v_config.comision_pct_cabilla,
    v_config.comision_pct_otros,
    ROUND(v_monto_cabilla * v_config.comision_pct_cabilla / 100, 2),
    ROUND(v_monto_otros   * v_config.comision_pct_otros   / 100, 2),
    v_total_comision,
    v_extras_montos,
    v_comision_lib,
    v_comision_ret,
    v_estado_inicial
  )
  RETURNING id INTO v_comision_id;

  RETURN v_comision_id;
END;
$$;
