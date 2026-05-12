-- 110_fix_retroactive_comisiones.sql
-- FIX: La función original (102) ignoraba los pagos iniciales en efectivo
-- cuando la venta era mixta (Efectivo + Cta por cobrar).
-- Este parche SOLO corrige la lógica de retención sin tocar el cálculo de montos.

-- PARTE 1: Actualizar registros existentes directamente
-- Para la comisión del despacho a9b7c6eb (y cualquier otra en estado retenida),
-- recalculamos el porcentaje pagado usando forma_pago de notas_despacho.
DO $$
DECLARE
  r RECORD;
  v_pago_inicial NUMERIC;
  elem JSONB;
  v_forma_pago_json JSONB;
  v_total_abonos NUMERIC;
  v_porcentaje_abn NUMERIC;
  v_comision_lib NUMERIC;
  v_comision_ret NUMERIC;
  v_type TEXT;
  v_nuevo_estado TEXT;
BEGIN
  FOR r IN 
    SELECT c.id AS comision_id, c.despacho_id, nd.total_usd, nd.forma_pago, 
           c.total_comision, c.comision_liberada, c.comision_retenida, c.estado
    FROM public.comisiones c
    JOIN public.notas_despacho nd ON c.despacho_id = nd.id
    WHERE c.estado IN ('retenida', 'pago_parcial')
  LOOP
    v_pago_inicial := 0;
    
    BEGIN
      IF r.forma_pago IS NOT NULL THEN
        v_type := jsonb_typeof(r.forma_pago::jsonb);
        IF v_type = 'string' THEN
          v_forma_pago_json := (r.forma_pago::jsonb#>>'{}')::jsonb;
        ELSE
          v_forma_pago_json := r.forma_pago::jsonb;
        END IF;

        IF jsonb_typeof(v_forma_pago_json) = 'array' THEN
          FOR elem IN SELECT * FROM jsonb_array_elements(v_forma_pago_json)
          LOOP
            IF elem->>'metodo' NOT ILIKE '%Cta por cobrar%' AND elem->>'metodo' NOT ILIKE '%Credito%' THEN
              v_pago_inicial := v_pago_inicial + COALESCE((elem->>'monto')::numeric, 0);
            END IF;
          END LOOP;
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_pago_inicial := 0;
    END;

    -- Obtener abonos registrados en cuentas_por_cobrar
    SELECT COALESCE(SUM(monto_usd), 0) INTO v_total_abonos
    FROM public.cuentas_por_cobrar
    WHERE despacho_id = r.despacho_id AND tipo = 'abono';
    
    v_total_abonos := v_total_abonos + v_pago_inicial;
    
    IF r.total_usd > 0 THEN
      v_porcentaje_abn := v_total_abonos / r.total_usd;
    ELSE
      v_porcentaje_abn := 1;
    END IF;
    IF v_porcentaje_abn > 1 THEN v_porcentaje_abn := 1; END IF;
    
    v_comision_lib := ROUND((r.total_comision * v_porcentaje_abn)::numeric, 2);
    v_comision_ret := GREATEST(0, r.total_comision - v_comision_lib);
    
    IF v_porcentaje_abn >= 1 THEN
      v_nuevo_estado := 'liberada';
    ELSIF v_porcentaje_abn > 0 THEN
      v_nuevo_estado := 'pago_parcial';
    ELSE
      v_nuevo_estado := 'retenida';
    END IF;

    UPDATE public.comisiones
    SET comision_liberada = v_comision_lib,
        comision_retenida = v_comision_ret,
        estado = v_nuevo_estado,
        actualizado_en = now()
    WHERE id = r.comision_id;
  END LOOP;
END;
$$;

-- PARTE 2: Parchear la función calcular_comision_despacho para futuros despachos.
-- Reemplazamos SOLO la lógica de crédito para que sume pagos iniciales.
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
  
  -- Variables NUEVAS para parsear pagos iniciales
  v_pago_inicial    NUMERIC(12,2) := 0;
  v_fp_elem         JSONB;
  v_forma_pago_json JSONB;
  v_fp_type         TEXT;
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

  -- ═══════════════════════════════════════════════════════════════════════
  -- FIX: Calcular prorrateo considerando pagos iniciales en efectivo
  -- ═══════════════════════════════════════════════════════════════════════
  v_total_despacho := COALESCE(v_despacho.total_usd, 0);
  
  IF COALESCE(v_despacho.forma_pago::text, '') ILIKE '%Credito%' OR
     COALESCE(v_despacho.forma_pago_cliente::text, '') ILIKE '%Credito%' OR
     COALESCE(v_despacho.forma_pago::text, '') ILIKE '%Cta por cobrar%' OR
     COALESCE(v_despacho.forma_pago_cliente::text, '') ILIKE '%Cta por cobrar%' THEN
    v_es_credito := TRUE;
  END IF;

  IF v_es_credito THEN
    -- Abonos registrados en cuentas_por_cobrar
    SELECT COALESCE(SUM(monto_usd), 0) INTO v_total_abonos
    FROM public.cuentas_por_cobrar
    WHERE despacho_id = p_despacho_id AND tipo = 'abono';

    -- FIX: Sumar pagos iniciales NO-crédito del campo forma_pago
    BEGIN
      IF v_despacho.forma_pago IS NOT NULL THEN
        v_fp_type := jsonb_typeof(v_despacho.forma_pago::jsonb);
        IF v_fp_type = 'string' THEN
          v_forma_pago_json := (v_despacho.forma_pago::jsonb#>>'{}')::jsonb;
        ELSE
          v_forma_pago_json := v_despacho.forma_pago::jsonb;
        END IF;

        IF jsonb_typeof(v_forma_pago_json) = 'array' THEN
          FOR v_fp_elem IN SELECT * FROM jsonb_array_elements(v_forma_pago_json)
          LOOP
            IF v_fp_elem->>'metodo' NOT ILIKE '%Cta por cobrar%' AND v_fp_elem->>'metodo' NOT ILIKE '%Credito%' THEN
              v_pago_inicial := v_pago_inicial + COALESCE((v_fp_elem->>'monto')::numeric, 0);
            END IF;
          END LOOP;
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_pago_inicial := 0;
    END;

    v_total_abonos := v_total_abonos + v_pago_inicial;

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
  IF v_tiene_items_despacho THEN
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
