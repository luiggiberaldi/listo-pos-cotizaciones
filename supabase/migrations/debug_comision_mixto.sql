CREATE OR REPLACE FUNCTION public.debug_comision_mixto()
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  r RECORD;
  v_pago_inicial NUMERIC;
  elem JSONB;
  v_forma_pago_json JSONB;
  v_total_abonos NUMERIC;
  v_porcentaje_abn NUMERIC;
  v_comision_lib NUMERIC;
  v_comision_ret NUMERIC;
  v_log JSONB := '[]'::jsonb;
  v_error TEXT;
  v_type TEXT;
BEGIN
  FOR r IN 
    SELECT c.despacho_id, nd.total_usd, nd.forma_pago, c.total_comision, c.comision_liberada, c.comision_retenida, c.estado
    FROM public.comisiones c
    JOIN public.notas_despacho nd ON c.despacho_id = nd.id
    WHERE c.estado IN ('retenida', 'pago_parcial')
  LOOP
    v_pago_inicial := 0;
    v_type := jsonb_typeof(r.forma_pago::jsonb);
    
    BEGIN
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
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
      v_log := v_log || jsonb_build_object('despacho_id', r.despacho_id, 'error', v_error);
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
      
      v_log := v_log || jsonb_build_object(
        'despacho_id', r.despacho_id,
        'v_pago_inicial', v_pago_inicial,
        'v_total_abonos', v_total_abonos,
        'v_porcentaje_abn', v_porcentaje_abn,
        'v_comision_lib', v_comision_lib,
        'v_comision_ret', v_comision_ret
      );
    ELSE
      v_log := v_log || jsonb_build_object(
        'despacho_id', r.despacho_id,
        'v_pago_inicial', 0,
        'v_type', v_type,
        'forma_pago_raw', r.forma_pago,
        'parsed', v_forma_pago_json
      );
    END IF;
  END LOOP;
  
  RETURN v_log;
END;
$$;
