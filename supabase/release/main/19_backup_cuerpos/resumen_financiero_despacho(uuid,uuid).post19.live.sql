CREATE OR REPLACE FUNCTION public.resumen_financiero_despacho(p_cuenta_id uuid, p_despacho_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_despacho RECORD;
  v_cliente_id UUID;
  v_cargos NUMERIC(14,4) := 0;
  v_abonos NUMERIC(14,4) := 0;
  v_cargo_cod NUMERIC(14,4) := 0;
  v_abono_cod NUMERIC(14,4) := 0;
  v_cobrado NUMERIC(14,4) := 0;
  v_compensado NUMERIC(14,4) := 0;
  -- Release 19: atribucion por porciones (credito vs COD) para pagos mixtos.
  v_cargo_cxc NUMERIC(14,4) := 0;
  v_abono_marc_dinero NUMERIC(14,4) := 0;
  v_abono_marc_comp NUMERIC(14,4) := 0;
  v_abono_comun_dinero NUMERIC(14,4) := 0;
  v_abono_comun_comp NUMERIC(14,4) := 0;
  v_spill_dinero NUMERIC(14,4) := 0;
  v_spill_comp NUMERIC(14,4) := 0;
  v_pagado_cod_dinero NUMERIC(14,4) := 0;
  v_pagado_cod_comp NUMERIC(14,4) := 0;
  v_abono_cxc NUMERIC(14,4) := 0;
  v_creditos NUMERIC(14,4) := 0;
  v_devolucion_credito NUMERIC(14,4) := 0;
  v_consumo_credito NUMERIC(14,4) := 0;
  v_devuelto NUMERIC(14,4) := 0;
  v_intercambio NUMERIC(14,4) := 0;
  v_deuda NUMERIC(14,4) := 0;
  v_saldo_favor NUMERIC(14,4) := 0;
  v_cod JSONB := NULL;
  v_cod_presente BOOLEAN := FALSE;
  v_cod_monto NUMERIC(14,4) := 0;
  v_cod_flag_pagado BOOLEAN := FALSE;
  v_sin_abono BOOLEAN := FALSE;
  v_estado TEXT;
  v_revisar BOOLEAN := FALSE;
  v_motivo TEXT := NULL;
  v_mixed BOOLEAN := FALSE;
  v_fp_text TEXT;
  v_fp JSONB;
  v_deuda_cod NUMERIC(14,4);
BEGIN
  IF p_cuenta_id IS NULL OR p_despacho_id IS NULL THEN
    RAISE EXCEPTION 'CUENTA_Y_DESPACHO_REQUERIDOS';
  END IF;

  SELECT nd.id, nd.numero, nd.cuenta_id, nd.estado, nd.cliente_id,
         nd.cliente_factura_id, nd.total_usd, nd.forma_pago, nd.forma_pago_cliente
    INTO v_despacho
  FROM public.notas_despacho nd
  WHERE nd.id = p_despacho_id AND nd.cuenta_id = p_cuenta_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'DESPACHO_NO_ENCONTRADO_O_SIN_PERMISO'; END IF;
  v_cliente_id := COALESCE(v_despacho.cliente_factura_id, v_despacho.cliente_id);

  v_fp_text := COALESCE(NULLIF(btrim(v_despacho.forma_pago_cliente), ''),
                        NULLIF(btrim(v_despacho.forma_pago), ''));
  IF v_fp_text IS NOT NULL AND pg_input_is_valid(v_fp_text, 'jsonb') THEN
    v_fp := v_fp_text::JSONB;
    IF jsonb_typeof(v_fp) = 'array' THEN
      SELECT e.value INTO v_cod
      FROM jsonb_array_elements(v_fp) AS e(value)
      WHERE jsonb_typeof(e.value) = 'object'
        AND lower(trim(COALESCE(e.value->>'metodo', e.value->>'metodo_pago', ''))) = 'cobro a destino'
      LIMIT 1;
      v_cod_presente := v_cod IS NOT NULL;
    ELSIF jsonb_typeof(v_fp) = 'object' THEN
      IF lower(trim(COALESCE(v_fp->>'metodo', v_fp->>'metodo_pago', ''))) = 'cobro a destino' THEN
        v_cod := v_fp;
        v_cod_presente := TRUE;
      ELSE
        v_revisar := TRUE;
      END IF;
    ELSE
      v_revisar := TRUE;
    END IF;
  ELSIF v_fp_text IS NOT NULL THEN
    v_revisar := lower(v_fp_text) LIKE '%cobro a destino%';
  END IF;

  IF v_cod_presente THEN
    BEGIN
      v_cod_monto := COALESCE(NULLIF(v_cod->>'monto', '')::NUMERIC,
                              NULLIF(v_cod->>'amount', '')::NUMERIC, 0);
      v_cod_flag_pagado := COALESCE((v_cod->>'cobro_destino_pagado')::BOOLEAN, FALSE);
      v_sin_abono := COALESCE((v_cod->>'conciliado_sin_abono')::BOOLEAN, FALSE);
    EXCEPTION WHEN others THEN
      v_revisar := TRUE;
      v_cod_monto := 0;
    END;
  END IF;

  SELECT
    COALESCE(SUM(CASE WHEN c.tipo='cargo' THEN ABS(c.monto_usd) ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN c.tipo='abono' THEN ABS(c.monto_usd) ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN c.tipo='cargo' AND lower(COALESCE(c.metodo_pago,''))='cod' THEN ABS(c.monto_usd) ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN c.tipo='abono'
      AND lower(COALESCE(c.forma_pago_abono,'')) NOT LIKE '%devoluci%'
      AND lower(COALESCE(c.forma_pago_abono,'')) NOT LIKE '%compensa%'
      AND lower(COALESCE(c.forma_pago_abono,'')) NOT LIKE '%cruce%'
      AND lower(COALESCE(c.forma_pago_abono,'')) NOT LIKE '%saldo a favor%'
      THEN ABS(c.monto_usd) ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN c.tipo='abono'
      AND (lower(COALESCE(c.forma_pago_abono,'')) LIKE '%devoluci%'
        OR lower(COALESCE(c.forma_pago_abono,'')) LIKE '%compensa%'
        OR lower(COALESCE(c.forma_pago_abono,'')) LIKE '%cruce%'
        OR lower(COALESCE(c.forma_pago_abono,'')) LIKE '%saldo a favor%')
      THEN ABS(c.monto_usd) ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN c.tipo='abono' AND lower(COALESCE(c.metodo_pago,''))='cod'
      AND lower(COALESCE(c.forma_pago_abono,'')) NOT LIKE '%devoluci%'
      AND lower(COALESCE(c.forma_pago_abono,'')) NOT LIKE '%compensa%'
      AND lower(COALESCE(c.forma_pago_abono,'')) NOT LIKE '%cruce%'
      AND lower(COALESCE(c.forma_pago_abono,'')) NOT LIKE '%saldo a favor%'
      THEN ABS(c.monto_usd) ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN c.tipo='abono' AND lower(COALESCE(c.metodo_pago,''))='cod'
      AND (lower(COALESCE(c.forma_pago_abono,'')) LIKE '%devoluci%'
        OR lower(COALESCE(c.forma_pago_abono,'')) LIKE '%compensa%'
        OR lower(COALESCE(c.forma_pago_abono,'')) LIKE '%cruce%'
        OR lower(COALESCE(c.forma_pago_abono,'')) LIKE '%saldo a favor%')
      THEN ABS(c.monto_usd) ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN c.tipo='abono' AND lower(COALESCE(c.metodo_pago,''))<>'cod'
      AND lower(COALESCE(c.forma_pago_abono,'')) NOT LIKE '%devoluci%'
      AND lower(COALESCE(c.forma_pago_abono,'')) NOT LIKE '%compensa%'
      AND lower(COALESCE(c.forma_pago_abono,'')) NOT LIKE '%cruce%'
      AND lower(COALESCE(c.forma_pago_abono,'')) NOT LIKE '%saldo a favor%'
      THEN ABS(c.monto_usd) ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN c.tipo='abono' AND lower(COALESCE(c.metodo_pago,''))<>'cod'
      AND (lower(COALESCE(c.forma_pago_abono,'')) LIKE '%devoluci%'
        OR lower(COALESCE(c.forma_pago_abono,'')) LIKE '%compensa%'
        OR lower(COALESCE(c.forma_pago_abono,'')) LIKE '%cruce%'
        OR lower(COALESCE(c.forma_pago_abono,'')) LIKE '%saldo a favor%')
      THEN ABS(c.monto_usd) ELSE 0 END),0)
  INTO v_cargos, v_abonos, v_cargo_cod, v_cobrado, v_compensado,
       v_abono_marc_dinero, v_abono_marc_comp, v_abono_comun_dinero, v_abono_comun_comp
  FROM public.cuentas_por_cobrar c
  WHERE c.despacho_id=p_despacho_id AND c.cliente_id=v_cliente_id AND c.cuenta_id=v_despacho.cuenta_id;

  v_deuda := round(v_cargos-v_abonos,2);
  IF v_cod_presente AND v_cargo_cod=0 AND v_cod_monto>0 THEN v_revisar := TRUE; END IF;
  v_cargo_cod := round(v_cargo_cod,2);
  -- Release 19: atribucion determinista de porciones.
  --   abonos marcados metodo_pago='cod' (flujo atomico) -> porcion COD;
  --   abonos comunes (flujo CxC / legados) -> porcion CxC primero y DESBORDE al COD;
  --   con cargo_cxc=0 el desborde es todo, o sea identico al contrato release 14.
  v_cargo_cxc := round(v_cargos-v_cargo_cod,2);
  v_mixed := v_cargo_cxc > 0.01;
  v_abono_marc_dinero := round(v_abono_marc_dinero,2);
  v_abono_marc_comp := round(v_abono_marc_comp,2);
  v_abono_comun_dinero := round(v_abono_comun_dinero,2);
  v_abono_comun_comp := round(v_abono_comun_comp,2);
  v_spill_dinero := GREATEST(0, round(v_abono_comun_dinero - v_cargo_cxc,2));
  v_spill_comp := GREATEST(0, round(v_abono_comun_comp - GREATEST(0, v_cargo_cxc - v_abono_comun_dinero),2));
  v_abono_cxc := round(v_abono_comun_dinero + v_abono_comun_comp - v_spill_dinero - v_spill_comp,2);
  v_pagado_cod_dinero := round(v_abono_marc_dinero + v_spill_dinero,2);
  v_pagado_cod_comp := round(v_abono_marc_comp + v_spill_comp,2);
  v_abono_cod := round(v_pagado_cod_dinero + v_pagado_cod_comp,2);
  v_cobrado := round(v_cobrado,2);
  v_compensado := round(v_compensado,2);

  SELECT COALESCE(SUM(ABS(d.total_devuelto_usd)),0) INTO v_devuelto
  FROM public.despacho_devoluciones d WHERE d.despacho_id=p_despacho_id;
  SELECT COALESCE(SUM(ABS(i.total_usd)),0) INTO v_intercambio
  FROM public.despacho_devolucion_intercambios i WHERE i.despacho_id=p_despacho_id;

  IF v_cliente_id IS NOT NULL THEN
    SELECT
      COALESCE(SUM(CASE WHEN c.tipo='credito' THEN ABS(c.monto_usd) ELSE 0 END),0),
      COALESCE(SUM(CASE WHEN c.tipo='devolucion_credito' THEN ABS(c.monto_usd) ELSE 0 END),0),
      COALESCE(SUM(CASE WHEN c.tipo='consumo_credito' THEN ABS(c.monto_usd)
        WHEN c.tipo='abono' AND lower(COALESCE(c.forma_pago_abono,'')) LIKE '%saldo a favor%'
        THEN ABS(c.monto_usd) ELSE 0 END),0)
    INTO v_creditos, v_devolucion_credito, v_consumo_credito
    FROM public.cuentas_por_cobrar c WHERE c.cliente_id=v_cliente_id AND c.cuenta_id=v_despacho.cuenta_id;
  END IF;
  v_saldo_favor := GREATEST(0,round(v_creditos-v_devolucion_credito-v_consumo_credito,2));

  IF NOT v_cod_presente OR v_cod_monto<=0 THEN
    v_estado := 'sin_cargo';
  ELSIF v_cargo_cod<=0 THEN
    v_estado := 'manual_review'; v_revisar := TRUE; v_motivo := 'cod_sin_cargo';
  ELSIF abs(v_cargo_cod-v_cod_monto)>0.01 THEN
    v_estado := 'manual_review'; v_revisar := TRUE; v_motivo := 'cargo_no_coincide';
  ELSE
    v_deuda_cod := GREATEST(0,round(v_cargo_cod-v_abono_cod,2));

    IF v_deuda_cod>0 THEN
      IF v_mixed AND (v_spill_dinero+v_spill_comp)>0.01 THEN
        -- Dinero sin marca que desbordo la porcion CxC y dejo COD abierto:
        -- atribucion ambigua (caso #3064); una persona debe decidir con evidencia.
        v_estado := 'manual_review'; v_revisar := TRUE; v_motivo := 'atribucion_ambigua';
      ELSIF v_sin_abono OR v_cod_flag_pagado THEN
        -- La marca dice pagado pero el ledger muestra deuda sin respaldo (caso #3879/#2185).
        v_estado := 'manual_review'; v_revisar := TRUE; v_motivo := 'flag_sin_respaldo';
      ELSIF v_pagado_cod_dinero>0.01 THEN
        -- Solo dinero real cuenta como pago parcial (paridad v14: una
        -- compensacion parcial deja el estado en 'pendiente').
        v_estado := 'parcial';
      ELSE
        v_estado := 'pendiente';
      END IF;
    ELSE
      IF v_pagado_cod_dinero>0.01 THEN
        v_estado := 'cobrado';
      ELSIF v_pagado_cod_comp>0.01 THEN
        v_estado := 'compensado';
      ELSE
        v_estado := 'manual_review'; v_revisar := TRUE; v_motivo := 'sin_movimientos';
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'despacho_id',v_despacho.id,'numero',v_despacho.numero,'cuenta_id',v_despacho.cuenta_id,
    'cliente_id',v_cliente_id,'moneda','USD',
    'ledger',jsonb_build_object('cargo_usd',round(v_cargos,2),'abono_usd',round(v_abonos,2),
      'deuda_usd',GREATEST(0,v_deuda),'cobrado_usd',v_cobrado,'compensado_usd',v_compensado,
      'cargo_cod_usd',v_cargo_cod,'abono_cod_usd',v_abono_cod,
      'deuda_cod_usd',GREATEST(0,round(v_cargo_cod-v_abono_cod,2)),
      'cargo_cxc_usd',v_cargo_cxc,'abono_cxc_usd',v_abono_cxc,
      'deuda_cxc_usd',GREATEST(0,round(v_cargo_cxc-v_abono_cxc,2)),
      'abono_cod_marcado_usd',round(v_abono_marc_dinero+v_abono_marc_comp,2),
      'desborde_sin_marca_usd',round(v_spill_dinero+v_spill_comp,2),
      'saldo_a_favor_cliente_usd',v_saldo_favor),
    'devoluciones',jsonb_build_object('total_usd',round(v_devuelto,2),'intercambios_usd',round(v_intercambio,2)),
    'cod',jsonb_build_object('presente',v_cod_presente,'monto_nominal_usd',round(v_cod_monto,2),
      'flag_pagado_legacy',v_cod_flag_pagado,'conciliado_sin_abono_legacy',v_sin_abono,
      'estado',v_estado,'revisar',v_revisar,'pago_mixto',v_mixed,'motivo_revision',v_motivo),
    'fuente','cuentas_por_cobrar','solo_lectura',TRUE);
END;
$function$

