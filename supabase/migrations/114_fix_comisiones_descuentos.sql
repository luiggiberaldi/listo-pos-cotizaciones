-- 114_fix_comisiones_descuentos.sql
-- FIX: Considera los descuentos al calcular el estado de las comisiones (liberada/retenida)
-- Un despacho con descuento requiere menor recaudo para alcanzar el 100% de pago.

-- 1. Reemplazar tg_actualizar_comision_por_abono
CREATE OR REPLACE FUNCTION public.tg_actualizar_comision_por_abono()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_despacho_total NUMERIC(12,4);
  v_com_total      NUMERIC(12,2);
  v_com_liberada   NUMERIC(12,2);
  v_porcentaje_abn NUMERIC;
  v_monto_a_liberar NUMERIC(12,2);
  r RECORD;
  v_monto_restante NUMERIC;
  v_deuda_despacho NUMERIC;
  v_monto_aplicado NUMERIC;
BEGIN
  -- Solo actuar si es un abono
  IF NEW.tipo = 'abono' THEN
    -- Identificar a qué despacho(s) afecta. 
    IF NEW.despacho_id IS NOT NULL THEN
      
      -- 1. Obtener el total del despacho específico, restando el descuento
      SELECT GREATEST(0, total_usd - COALESCE(descuento_total_usd, 0)) INTO v_despacho_total
      FROM public.notas_despacho
      WHERE id = NEW.despacho_id;
      
      -- Si existe el despacho y su total a pagar es mayor a 0
      IF FOUND AND v_despacho_total > 0 THEN
        
        -- 2. Obtener la comisión asociada a ese despacho
        SELECT total_comision, comision_liberada 
        INTO v_com_total, v_com_liberada
        FROM public.comisiones
        WHERE despacho_id = NEW.despacho_id;
        
        IF FOUND THEN
          -- 3. Calcular porcentaje y monto a liberar
          v_porcentaje_abn := NEW.monto_usd / v_despacho_total;
          v_monto_a_liberar := ROUND((v_com_total * v_porcentaje_abn)::numeric, 2);
          
          -- 4. Actualizar comisión
          UPDATE public.comisiones
          SET 
            comision_liberada = LEAST(v_com_total, comision_liberada + v_monto_a_liberar),
            comision_retenida = GREATEST(0, comision_retenida - v_monto_a_liberar),
            estado = CASE 
                       WHEN estado = 'pagada' THEN 'pagada' -- Si ya fue pagada al empleado no cambiar
                       WHEN (comision_liberada + v_monto_a_liberar) >= v_com_total THEN 'liberada'
                       ELSE 'pago_parcial'
                     END,
            actualizado_en = now()
          WHERE despacho_id = NEW.despacho_id;
        END IF;
      ELSIF FOUND AND v_despacho_total = 0 THEN
        -- Si el total a pagar es 0, liberar la comisión completamente
        UPDATE public.comisiones
        SET comision_liberada = total_comision,
            comision_retenida = 0,
            estado = CASE WHEN estado = 'pagada' THEN 'pagada' ELSE 'liberada' END,
            actualizado_en = now()
        WHERE despacho_id = NEW.despacho_id AND estado IN ('retenida', 'pago_parcial');
      END IF;
      
    ELSE
      -- Lógica FIFO para abonos globales (sin despacho_id explícito)
      v_monto_restante := NEW.monto_usd;
      
      -- Recorrer despachos con comisiones retenidas o parciales, del más antiguo al más reciente
      FOR r IN 
        SELECT nd.id AS despacho_id, GREATEST(0, nd.total_usd - COALESCE(nd.descuento_total_usd, 0)) AS total_usd, c.total_comision, c.comision_liberada, c.comision_retenida
        FROM public.notas_despacho nd
        JOIN public.comisiones c ON c.despacho_id = nd.id
        WHERE nd.cliente_id = NEW.cliente_id
          AND c.estado IN ('retenida', 'pago_parcial')
        ORDER BY nd.creado_en ASC
      LOOP
        EXIT WHEN v_monto_restante <= 0;
        
        -- Calcular la deuda restante del despacho en base a la porción de comisión retenida
        -- Si la comisión retenida es el X% de la comisión total, entonces la deuda es el X% del total_usd.
        IF r.total_comision > 0 AND r.total_usd > 0 THEN
          v_deuda_despacho := ROUND((r.comision_retenida / r.total_comision) * r.total_usd, 2);
        ELSE
          v_deuda_despacho := 0;
        END IF;
        
        IF v_deuda_despacho > 0 THEN
          IF v_monto_restante >= v_deuda_despacho THEN
            v_monto_aplicado := v_deuda_despacho;
          ELSE
            v_monto_aplicado := v_monto_restante;
          END IF;
          
          -- Liberar la comisión proporcional al monto aplicado sobre el total del despacho
          v_porcentaje_abn := v_monto_aplicado / r.total_usd;
          v_monto_a_liberar := ROUND((r.total_comision * v_porcentaje_abn)::numeric, 2);
          
          UPDATE public.comisiones
          SET 
            comision_liberada = LEAST(r.total_comision, comision_liberada + v_monto_a_liberar),
            comision_retenida = GREATEST(0, comision_retenida - v_monto_a_liberar),
            estado = CASE 
                       WHEN estado = 'pagada' THEN 'pagada'
                       WHEN (comision_liberada + v_monto_a_liberar) >= r.total_comision THEN 'liberada'
                       ELSE 'pago_parcial'
                     END,
            actualizado_en = now()
          WHERE despacho_id = r.despacho_id;
          
          v_monto_restante := v_monto_restante - v_monto_aplicado;
        ELSIF r.total_usd = 0 THEN
          UPDATE public.comisiones
          SET comision_liberada = r.total_comision,
              comision_retenida = 0,
              estado = CASE WHEN estado = 'pagada' THEN 'pagada' ELSE 'liberada' END,
              actualizado_en = now()
          WHERE despacho_id = r.despacho_id;
        END IF;
      END LOOP;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- 2. Reemplazar calcular_comision_despacho para restar descuentos
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
  
  -- Variables para parsear pagos iniciales
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

  -- FIX: Calcular prorrateo restando los descuentos
  v_total_despacho := GREATEST(0, COALESCE(v_despacho.total_usd, 0) - COALESCE(v_despacho.descuento_total_usd, 0));
  
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

    -- Sumar pagos iniciales NO-crédito del campo forma_pago
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

-- 3. Actualizar retroactivamente las comisiones retenidas
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
  v_total_despacho NUMERIC;
BEGIN
  FOR r IN 
    SELECT c.id AS comision_id, c.despacho_id, nd.total_usd, nd.descuento_total_usd, nd.forma_pago, 
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
    
    v_total_despacho := GREATEST(0, COALESCE(r.total_usd, 0) - COALESCE(r.descuento_total_usd, 0));

    IF v_total_despacho > 0 THEN
      v_porcentaje_abn := v_total_abonos / v_total_despacho;
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
