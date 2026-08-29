-- Migración 108: Fix para calcular abonos iniciales (mixtos) en comisiones
-- Permite que si un despacho se pagó con $3000 en Efectivo y $3000 en Cta por cobrar,
-- el porcentaje inicial de la comisión tome en cuenta los $3000 iniciales en efectivo.

DROP FUNCTION IF EXISTS public.calcular_comision_despacho(UUID);
CREATE OR REPLACE FUNCTION public.calcular_comision_despacho(p_despacho_id UUID)
RETURNS UUID
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_despacho        RECORD;
  v_config          RECORD;
  v_cat_cabilla     TEXT;
  v_item            RECORD;
  
  v_total_comision  NUMERIC(12,2) := 0;
  v_monto_linea     NUMERIC(12,2) := 0;
  v_comision_linea  NUMERIC(12,2) := 0;
  v_porcentaje_usar NUMERIC(5,2)  := 0;
  
  v_estado_inicial  TEXT := 'retenida';
  v_comision_lib    NUMERIC(12,2) := 0;
  v_comision_ret    NUMERIC(12,2) := 0;
  v_porcentaje_abn  NUMERIC := 0;
  v_total_abonos    NUMERIC(12,2) := 0;
  v_total_despacho  NUMERIC(12,2) := 0;
  v_es_credito      BOOLEAN := FALSE;
  v_pago_inicial    NUMERIC(12,2) := 0;
  v_comision_id     UUID;
  elem              JSONB;
BEGIN
  -- Si ya existe comisión para este despacho, retornar (idempotente)
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

  IF COALESCE(v_despacho.forma_pago::text, '') ILIKE '%Credito%' OR
     COALESCE(v_despacho.forma_pago_cliente::text, '') ILIKE '%Credito%' OR
     COALESCE(v_despacho.forma_pago::text, '') ILIKE '%Cta por cobrar%' OR
     COALESCE(v_despacho.forma_pago_cliente::text, '') ILIKE '%Cta por cobrar%' THEN
    v_es_credito := TRUE;
  END IF;

  -- Determinar total del despacho
  SELECT total_usd INTO v_total_despacho FROM public.notas_despacho WHERE id = p_despacho_id;

  IF v_es_credito THEN
    -- Sumar abonos explícitos en cuentas_por_cobrar
    SELECT COALESCE(SUM(monto_usd), 0) INTO v_total_abonos
    FROM public.cuentas_por_cobrar
    WHERE despacho_id = p_despacho_id AND tipo = 'abono';
    
    -- Sumar abonos iniciales pagados directamente en métodos mixtos (Venta Rápida con Efectivo + Crédito)
    BEGIN
      IF jsonb_typeof(v_despacho.forma_pago) = 'array' THEN
        FOR elem IN SELECT * FROM jsonb_array_elements(v_despacho.forma_pago)
        LOOP
          IF elem->>'metodo' NOT ILIKE '%Cta por cobrar%' AND elem->>'metodo' NOT ILIKE '%Credito%' THEN
            v_pago_inicial := v_pago_inicial + COALESCE((elem->>'monto')::numeric, 0);
          END IF;
        END LOOP;
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

  -- Verificar si hay items en notas_despacho_items (editado) o cotizacion_items (normal)
  IF EXISTS (SELECT 1 FROM public.notas_despacho_items WHERE despacho_id = p_despacho_id) THEN
    -- Iterar notas_despacho_items
    FOR v_item IN
      SELECT ndi.total_linea_usd, lower(trim(p.categoria)) AS cat
      FROM public.notas_despacho_items ndi
      LEFT JOIN public.productos p ON p.id = ndi.producto_id
      WHERE ndi.despacho_id = p_despacho_id
    LOOP
      v_monto_linea := COALESCE(v_item.total_linea_usd, 0);
      IF v_item.cat = v_cat_cabilla THEN
        v_porcentaje_usar := v_config.comision_pct_cabilla;
      ELSE
        v_porcentaje_usar := v_config.comision_pct_otros;
      END IF;
      
      v_comision_linea := ROUND((v_monto_linea * (v_porcentaje_usar / 100))::numeric, 2);
      v_total_comision := v_total_comision + v_comision_linea;
    END LOOP;
  ELSE
    -- Iterar cotizacion_items (fallback si no se editó en el despacho)
    FOR v_item IN
      SELECT (ci.precio_unit_usd * ci.cantidad) AS sum_linea, lower(trim(p.categoria)) AS cat, ci.id AS c_item_id
      FROM public.cotizacion_items ci
      LEFT JOIN public.productos p ON p.id = ci.producto_id
      WHERE ci.cotizacion_id = v_despacho.cotizacion_id
    LOOP
      -- Restar descuentos si los hay
      v_monto_linea := COALESCE(v_item.sum_linea, 0) - COALESCE(
        (SELECT monto_usd FROM public.despacho_descuentos 
         WHERE despacho_id = p_despacho_id AND cotizacion_item_id = v_item.c_item_id LIMIT 1), 
      0);
      
      IF v_monto_linea < 0 THEN v_monto_linea := 0; END IF;

      IF v_item.cat = v_cat_cabilla THEN
        v_porcentaje_usar := v_config.comision_pct_cabilla;
      ELSE
        v_porcentaje_usar := v_config.comision_pct_otros;
      END IF;
      
      v_comision_linea := ROUND((v_monto_linea * (v_porcentaje_usar / 100))::numeric, 2);
      v_total_comision := v_total_comision + v_comision_linea;
    END LOOP;
  END IF;

  -- Calcular liberación vs retención
  v_comision_lib := ROUND((v_total_comision * v_porcentaje_abn)::numeric, 2);
  v_comision_ret := GREATEST(0, v_total_comision - v_comision_lib);

  IF v_porcentaje_abn >= 1 THEN
    v_estado_inicial := 'liberada';
  ELSIF v_porcentaje_abn > 0 THEN
    v_estado_inicial := 'pago_parcial';
  ELSE
    v_estado_inicial := 'retenida';
  END IF;

  IF v_total_comision > 0 THEN
    INSERT INTO public.comisiones (
      despacho_id,
      cotizacion_id,
      estado,
      total_comision,
      pct_cabilla,
      pct_otros,
      detalle_extras,
      comision_liberada,
      comision_retenida,
      pagado_en
    ) VALUES (
      p_despacho_id,
      v_despacho.cotizacion_id,
      v_estado_inicial,
      v_total_comision,
      v_config.comision_pct_cabilla,
      v_config.comision_pct_otros,
      v_config._comision_extras,
      v_comision_lib,
      v_comision_ret,
      CASE WHEN v_estado_inicial = 'pagada' THEN now() ELSE null END
    ) RETURNING id INTO v_comision_id;
  END IF;

  RETURN v_comision_id;
END;
$$;

-- Actualizar comisiones existentes que sufren de este bug:
-- Si existe un despacho que tiene forma_pago como JSON array mixto y su estado de comisión es 'retenida' o 'pago_parcial'
DO $$
DECLARE
  r RECORD;
  v_pago_inicial NUMERIC;
  elem JSONB;
  v_total_abonos NUMERIC;
  v_porcentaje_abn NUMERIC;
  v_comision_lib NUMERIC;
  v_comision_ret NUMERIC;
BEGIN
  FOR r IN 
    SELECT c.despacho_id, nd.total_usd, nd.forma_pago, c.total_comision, c.comision_liberada, c.comision_retenida, c.estado
    FROM public.comisiones c
    JOIN public.notas_despacho nd ON c.despacho_id = nd.id
    WHERE c.estado IN ('retenida', 'pago_parcial')
  LOOP
    v_pago_inicial := 0;
    
    BEGIN
      IF jsonb_typeof(r.forma_pago) = 'array' THEN
        FOR elem IN SELECT * FROM jsonb_array_elements(r.forma_pago)
        LOOP
          IF elem->>'metodo' NOT ILIKE '%Cta por cobrar%' AND elem->>'metodo' NOT ILIKE '%Credito%' THEN
            v_pago_inicial := v_pago_inicial + COALESCE((elem->>'monto')::numeric, 0);
          END IF;
        END LOOP;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_pago_inicial := 0;
    END;

    IF v_pago_inicial > 0 THEN
      -- Obtener abonos en cuentas_por_cobrar específicos para este despacho
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
      
      UPDATE public.comisiones
      SET 
        comision_liberada = LEAST(r.total_comision, v_comision_lib),
        comision_retenida = v_comision_ret,
        estado = CASE 
                   WHEN estado = 'pagada' THEN 'pagada'
                   WHEN v_comision_lib >= r.total_comision THEN 'liberada'
                   WHEN v_comision_lib > 0 THEN 'pago_parcial'
                   ELSE 'retenida'
                 END,
        actualizado_en = now()
      WHERE despacho_id = r.despacho_id;
    END IF;
  END LOOP;
END;
$$;
