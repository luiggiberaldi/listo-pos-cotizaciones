CREATE OR REPLACE FUNCTION public.registrar_pago_externo_cobro_idempotente(p_cuenta_id uuid, p_despacho_id uuid, p_idempotency_key uuid, p_usuario_id uuid, p_usuario_nombre text, p_pagos jsonb, p_evidencia text, p_ip_origen text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_despacho RECORD;
  v_actor RECORD;
  v_cliente_id UUID;
  v_cod_cliente JSONB;
  v_cod_pago JSONB;
  v_formas_cliente JSONB;
  v_formas_pago JSONB;
  v_formas_cliente_nuevas JSONB;
  v_formas_pago_nuevas JSONB;
  v_hash TEXT;
  v_guard RECORD;
  v_monto_nominal NUMERIC(14,4) := 0;
  v_monto_pago NUMERIC(14,4) := 0;
  v_monto_bs NUMERIC(14,4) := 0;
  v_tasa_snapshot NUMERIC(20,8) := 0;
  v_pagos_snapshot JSONB := '[]'::JSONB;
  v_cargos NUMERIC(14,4) := 0;
  v_abonos NUMERIC(14,4) := 0;
  v_saldo_cliente NUMERIC(14,4) := 0;
  v_cargos_cod NUMERIC(14,4) := 0;
  v_deuda_cod NUMERIC(14,4) := 0;
  -- Release 19: atribucion por porciones y guardas de coherencia marca/ledger.
  v_cargo_cxc NUMERIC(14,4) := 0;
  v_abono_marc_dinero NUMERIC(14,4) := 0;
  v_abono_marc_comp NUMERIC(14,4) := 0;
  v_abono_comun_dinero NUMERIC(14,4) := 0;
  v_abono_comun_comp NUMERIC(14,4) := 0;
  v_spill_dinero NUMERIC(14,4) := 0;
  v_spill_comp NUMERIC(14,4) := 0;
  v_mixed BOOLEAN := FALSE;
  v_cod_flag_pagado BOOLEAN := FALSE;
  v_sin_abono BOOLEAN := FALSE;
  v_deuda_cliente NUMERIC(14,4) := 0;
  v_total_pago NUMERIC(14,4) := 0;
  v_pago JSONB;
  v_pago_json JSONB;
  v_metodo TEXT;
  v_abono_id UUID;
  v_ids UUID[] := ARRAY[]::UUID[];
  v_resultado JSONB;
  v_comision_id UUID;
  v_cod_count INTEGER := 0;
  v_cod_pago_count INTEGER := 0;
BEGIN
  IF p_cuenta_id IS NULL OR p_despacho_id IS NULL OR p_idempotency_key IS NULL
     OR p_usuario_id IS NULL OR NULLIF(btrim(p_usuario_nombre),'') IS NULL
     OR p_pagos IS NULL OR jsonb_typeof(p_pagos) <> 'array'
     -- Release 19: la nota del pago (p_evidencia) es OPCIONAL; vacia o NULL se
     -- registra como '(sin nota)' en la descripcion del abono. Solo se limita el
     -- largo maximo (500) para no degradar la auditoria.
     OR length(COALESCE(p_evidencia,'')) > 500 THEN
    RAISE EXCEPTION 'COD_CONCILIACION_PARAMETROS_INVALIDOS';
  END IF;
  IF jsonb_array_length(p_pagos) < 1 OR jsonb_array_length(p_pagos) > 6 THEN
    RAISE EXCEPTION 'COD_CONCILIACION_PARAMETROS_INVALIDOS';
  END IF;

  FOR v_pago_json IN SELECT x.value FROM jsonb_array_elements(p_pagos) AS x(value)
  LOOP
    IF jsonb_typeof(v_pago_json) <> 'object' THEN
      RAISE EXCEPTION 'COD_CONCILIACION_PAGO_O_REFERENCIA_INVALIDOS';
    END IF;
    v_metodo := lower(btrim(COALESCE(v_pago_json->>'metodo','')));
    IF v_metodo NOT IN ('efectivo $','efectivo bs','zelle','transf. / pago móvil','punto de venta','usdt')
       OR COALESCE(v_pago_json->>'monto','') !~ '^[0-9]+([.][0-9]{1,2})?$' THEN
      RAISE EXCEPTION 'COD_CONCILIACION_PAGO_O_REFERENCIA_INVALIDOS';
    END IF;
    v_monto_pago := (v_pago_json->>'monto')::NUMERIC;
    IF v_monto_pago <= 0 OR v_monto_pago <> round(v_monto_pago,2) THEN
      RAISE EXCEPTION 'COD_CONCILIACION_PAGO_O_REFERENCIA_INVALIDOS';
    END IF;
    IF v_metodo = 'efectivo bs' THEN
      IF length(COALESCE(v_pago_json->>'monto_bs','')) > 20
         OR length(COALESCE(v_pago_json->>'tasa_snapshot','')) > 20
         OR COALESCE(v_pago_json->>'monto_bs','') !~ '^[0-9]+([.][0-9]{1,2})?$'
         OR COALESCE(v_pago_json->>'tasa_snapshot','') !~ '^[0-9]+([.][0-9]{1,8})?$'
         OR length(btrim(COALESCE(v_pago_json->>'tasa_fuente',''))) NOT BETWEEN 1 AND 80
         OR (v_pago_json->>'tasa_actualizada_en' IS NOT NULL
           AND NOT pg_input_is_valid(v_pago_json->>'tasa_actualizada_en','timestamptz')) THEN
        RAISE EXCEPTION 'COD_CONCILIACION_TASA_BS_INVALIDA';
      END IF;
      v_monto_bs := (v_pago_json->>'monto_bs')::NUMERIC;
      v_tasa_snapshot := (v_pago_json->>'tasa_snapshot')::NUMERIC;
      IF v_monto_bs <= 0 OR v_tasa_snapshot <= 0 OR v_tasa_snapshot > 1000000000
         OR v_tasa_snapshot <> round(v_tasa_snapshot,8)
         OR round(v_monto_bs / v_tasa_snapshot,2) <> v_monto_pago THEN
        RAISE EXCEPTION 'COD_CONCILIACION_TASA_BS_INVALIDA';
      END IF;
      v_pago_json := v_pago_json || jsonb_build_object(
        'monto',round(v_monto_bs / v_tasa_snapshot,2),
        'equivalente_usd',round(v_monto_bs / v_tasa_snapshot,2),
        'tasa_confirmada_en',clock_timestamp());
    ELSE
      -- Referencia: minimo 4 caracteres en los medios que no son efectivo.
      IF v_metodo NOT IN ('efectivo $','efectivo bs')
         AND length(btrim(COALESCE(v_pago_json->>'referencia',''))) < 4 THEN
        RAISE EXCEPTION 'COD_CONCILIACION_PAGO_O_REFERENCIA_INVALIDOS';
      END IF;
    END IF;
    v_pagos_snapshot := v_pagos_snapshot || jsonb_build_array(v_pago_json);
  END LOOP;
  SELECT COALESCE(SUM((x.value->>'monto')::NUMERIC),0) INTO v_total_pago
  FROM jsonb_array_elements(v_pagos_snapshot) AS x(value);
  IF v_total_pago <= 0 OR v_total_pago <> round(v_total_pago,2) THEN
    RAISE EXCEPTION 'COD_CONCILIACION_MONTO_INVALIDO';
  END IF;

  v_hash := md5(jsonb_build_object('despacho_id',p_despacho_id,
    'pagos',p_pagos,'evidencia',btrim(p_evidencia))::TEXT);
  PERFORM pg_advisory_xact_lock(hashtextextended(p_cuenta_id::TEXT || ':' || p_idempotency_key::TEXT,0));

  SELECT * INTO v_despacho FROM public.notas_despacho nd
  WHERE nd.id=p_despacho_id AND nd.cuenta_id=p_cuenta_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'COD_CONCILIACION_DESPACHO_NO_ENCONTRADO'; END IF;
  IF v_despacho.estado NOT IN ('despachada','entregada') THEN
    RAISE EXCEPTION 'COD_CONCILIACION_ESTADO_INVALIDO';
  END IF;
  v_cliente_id := COALESCE(v_despacho.cliente_factura_id,v_despacho.cliente_id);
  IF v_cliente_id IS NULL THEN RAISE EXCEPTION 'COD_CONCILIACION_CLIENTE_REQUERIDO'; END IF;

  SELECT u.id,u.nombre,u.rol INTO v_actor FROM public.usuarios u
  WHERE u.id=p_usuario_id AND u.cuenta_id=p_cuenta_id AND u.activo=TRUE
    AND u.rol IN ('administracion','jefe','supervisor','desarrollador') LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'COD_CONCILIACION_ACTOR_NO_AUTORIZADO'; END IF;

  PERFORM 1 FROM public.clientes c
  WHERE c.id=v_cliente_id AND c.cuenta_id=p_cuenta_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'COD_CONCILIACION_CLIENTE_REQUERIDO'; END IF;

  SELECT i.payload_hash,i.resultado INTO v_guard
  FROM public.cod_conciliacion_idempotencia i
  WHERE i.cuenta_id=p_cuenta_id AND i.idempotency_key=p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_guard.payload_hash<>v_hash OR v_guard.resultado IS NULL THEN
      RAISE EXCEPTION 'COD_CONCILIACION_IDEMPOTENCIA_REUTILIZADA';
    END IF;
    RETURN v_guard.resultado || jsonb_build_object('idempotent',TRUE);
  END IF;

  IF v_despacho.forma_pago_cliente IS NOT NULL AND btrim(v_despacho.forma_pago_cliente)<>'' THEN
    IF NOT pg_input_is_valid(v_despacho.forma_pago_cliente,'jsonb') THEN
      RAISE EXCEPTION 'COD_CONCILIACION_FORMA_PAGO_INVALIDA';
    END IF;
    v_formas_cliente := v_despacho.forma_pago_cliente::JSONB;
  ELSIF v_despacho.forma_pago IS NOT NULL AND btrim(v_despacho.forma_pago)<>''
        AND pg_input_is_valid(v_despacho.forma_pago,'jsonb') THEN
    v_formas_cliente := v_despacho.forma_pago::JSONB;
  ELSE
    RAISE EXCEPTION 'COD_CONCILIACION_FORMA_PAGO_INVALIDA';
  END IF;
  IF jsonb_typeof(v_formas_cliente)<>'array' THEN
    RAISE EXCEPTION 'COD_CONCILIACION_FORMA_PAGO_INVALIDA';
  END IF;

  IF v_despacho.forma_pago IS NOT NULL AND btrim(v_despacho.forma_pago)<>'' THEN
    IF NOT pg_input_is_valid(v_despacho.forma_pago,'jsonb') THEN
      RAISE EXCEPTION 'COD_CONCILIACION_FORMA_PAGO_INVALIDA';
    END IF;
    v_formas_pago := v_despacho.forma_pago::JSONB;
  ELSE
    v_formas_pago := v_formas_cliente;
  END IF;
  IF jsonb_typeof(v_formas_pago)<>'array'
     OR jsonb_array_length(v_formas_pago)<>jsonb_array_length(v_formas_cliente) THEN
    RAISE EXCEPTION 'COD_CONCILIACION_FORMA_PAGO_INVALIDA';
  END IF;

  SELECT count(*)::INTEGER INTO v_cod_count FROM jsonb_array_elements(v_formas_cliente) AS x(value)
  WHERE jsonb_typeof(x.value)='object' AND lower(btrim(COALESCE(x.value->>'metodo','')))='cobro a destino';
  SELECT count(*)::INTEGER INTO v_cod_pago_count FROM jsonb_array_elements(v_formas_pago) AS x(value)
  WHERE jsonb_typeof(x.value)='object' AND lower(btrim(COALESCE(x.value->>'metodo','')))='cobro a destino';
  IF v_cod_count<>1 OR v_cod_pago_count<>1 THEN RAISE EXCEPTION 'COD_CONCILIACION_COD_AMBIGUO'; END IF;
  SELECT x.value INTO v_cod_cliente FROM jsonb_array_elements(v_formas_cliente) AS x(value)
  WHERE jsonb_typeof(x.value)='object' AND lower(btrim(COALESCE(x.value->>'metodo','')))='cobro a destino';
  SELECT x.value INTO v_cod_pago FROM jsonb_array_elements(v_formas_pago) AS x(value)
  WHERE jsonb_typeof(x.value)='object' AND lower(btrim(COALESCE(x.value->>'metodo','')))='cobro a destino';
  BEGIN
    v_monto_nominal := (v_cod_cliente->>'monto')::NUMERIC;
    v_monto_pago := (v_cod_pago->>'monto')::NUMERIC;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'COD_CONCILIACION_MONTO_NOMINAL_INVALIDO';
  END;
  BEGIN
    v_cod_flag_pagado := COALESCE((v_cod_cliente->>'cobro_destino_pagado')::BOOLEAN, FALSE);
    v_sin_abono := COALESCE((v_cod_cliente->>'conciliado_sin_abono')::BOOLEAN, FALSE);
  EXCEPTION WHEN others THEN
    v_cod_flag_pagado := FALSE;
    v_sin_abono := FALSE;
  END;
  IF v_monto_nominal<=0 OR v_monto_pago IS NULL OR abs(v_monto_pago-v_monto_nominal)>0.01 THEN
    RAISE EXCEPTION 'COD_CONCILIACION_FORMA_PAGO_INVALIDA';
  END IF;
  IF (v_cod_cliente ? 'metodos_pagados' AND jsonb_typeof(v_cod_cliente->'metodos_pagados')<>'array')
     OR (v_cod_pago ? 'metodos_pagados' AND jsonb_typeof(v_cod_pago->'metodos_pagados')<>'array') THEN
    RAISE EXCEPTION 'COD_CONCILIACION_FORMA_PAGO_INVALIDA';
  END IF;

  SELECT COALESCE(SUM(CASE WHEN c.tipo='cargo' THEN ABS(c.monto_usd) ELSE 0 END),0),
         COALESCE(SUM(CASE WHEN c.tipo='abono' THEN ABS(c.monto_usd) ELSE 0 END),0),
         COALESCE(SUM(CASE WHEN c.tipo='cargo' AND lower(COALESCE(c.metodo_pago,''))='cod' THEN ABS(c.monto_usd) ELSE 0 END),0),
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
    INTO v_cargos,v_abonos,v_cargos_cod,
         v_abono_marc_dinero,v_abono_marc_comp,v_abono_comun_dinero,v_abono_comun_comp
  FROM public.cuentas_por_cobrar c
  WHERE c.cuenta_id=p_cuenta_id AND c.cliente_id=v_cliente_id AND c.despacho_id=p_despacho_id;
  -- Release 19: misma atribucion determinista que resumen_financiero_despacho.
  v_cargos_cod := round(v_cargos_cod,2);
  v_cargo_cxc := round(v_cargos - v_cargos_cod,2);
  v_mixed := v_cargo_cxc > 0.01;
  v_spill_dinero := GREATEST(0, round(v_abono_comun_dinero - v_cargo_cxc,2));
  v_spill_comp := GREATEST(0, round(v_abono_comun_comp - GREATEST(0, v_cargo_cxc - v_abono_comun_dinero),2));
  v_deuda_cod := GREATEST(0, round(v_cargos_cod - v_abono_marc_dinero - v_abono_marc_comp - v_spill_dinero - v_spill_comp,2));
  IF v_cargos_cod<=0 THEN
    RAISE EXCEPTION 'COD_CONCILIACION_LEDGER_AMBIGUO';
  END IF;
  IF abs(v_cargos_cod-v_monto_nominal)>0.01 THEN RAISE EXCEPTION 'COD_CONCILIACION_CARGO_NO_COINCIDE'; END IF;
  IF v_mixed AND (v_spill_dinero+v_spill_comp)>0.01 AND v_deuda_cod>0.01 THEN
    RAISE EXCEPTION 'COD_CONCILIACION_ATRIBUCION_AMBIGUA';
  END IF;
  IF (v_sin_abono OR v_cod_flag_pagado) AND v_deuda_cod>0.01 THEN
    RAISE EXCEPTION 'COD_CONCILIACION_FLAG_SIN_SOPORTE';
  END IF;
  SELECT COALESCE(SUM(CASE WHEN c.tipo='cargo' THEN ABS(c.monto_usd)
    WHEN c.tipo='abono' THEN -ABS(c.monto_usd) ELSE 0 END),0) INTO v_deuda_cliente
  FROM public.cuentas_por_cobrar c WHERE c.cuenta_id=p_cuenta_id AND c.cliente_id=v_cliente_id;
  v_saldo_cliente:=GREATEST(0,v_deuda_cliente);
  IF v_deuda_cod<=0 THEN RAISE EXCEPTION 'COD_CONCILIACION_SIN_DEUDA'; END IF;
  IF v_total_pago>v_deuda_cod+0.01 THEN
    RAISE EXCEPTION 'COD_CONCILIACION_MONTO_NO_COINCIDE: saldo %, pago %',v_deuda_cod,v_total_pago;
  END IF;
  IF v_deuda_cliente+0.01<v_total_pago THEN RAISE EXCEPTION 'COD_CONCILIACION_LEDGER_AMBIGUO'; END IF;

  INSERT INTO public.cod_conciliacion_idempotencia(cuenta_id,idempotency_key,despacho_id,payload_hash)
  VALUES(p_cuenta_id,p_idempotency_key,p_despacho_id,v_hash);

  FOR v_pago IN SELECT x.value FROM jsonb_array_elements(v_pagos_snapshot) AS x(value)
  LOOP
    v_metodo:=btrim(v_pago->>'metodo');
    v_monto_pago:=(v_pago->>'monto')::NUMERIC;
    INSERT INTO public.cuentas_por_cobrar(
      cuenta_id,cliente_id,despacho_id,tipo,monto_usd,saldo_usd,metodo_pago,
      forma_pago_abono,referencia,descripcion,registrado_por
    ) VALUES(
      p_cuenta_id,v_cliente_id,p_despacho_id,'abono',v_monto_pago,
      GREATEST(0,round(v_saldo_cliente-v_monto_pago,4)),'cod',v_metodo,
      NULLIF(btrim(v_pago->>'referencia'),''),
      'Pago externo COD — nota: '||COALESCE(NULLIF(btrim(p_evidencia),''),'(sin nota)')||CASE WHEN lower(v_metodo)='efectivo bs' THEN
        ' | snapshot Bs: recibido='||(v_pago->>'monto_bs')||'; tasa='||(v_pago->>'tasa_snapshot')
        ||'; fuente='||(v_pago->>'tasa_fuente')||'; equivalente_usd='||(v_pago->>'equivalente_usd')
        ||'; confirmado_en='||(v_pago->>'tasa_confirmada_en')
        ELSE '' END,p_usuario_id
    ) RETURNING id INTO v_abono_id;
    v_ids:=array_append(v_ids,v_abono_id);
    v_saldo_cliente:=GREATEST(0,v_saldo_cliente-v_monto_pago);
  END LOOP;

  SELECT jsonb_agg(CASE WHEN jsonb_typeof(x.value)='object'
      AND lower(btrim(COALESCE(x.value->>'metodo','')))='cobro a destino'
    THEN x.value||jsonb_build_object(
      'cobro_destino_pagado',(v_deuda_cod-v_total_pago)<=0,
      'conciliado_sin_abono',FALSE,
      'metodos_pagados',COALESCE(v_cod_cliente->'metodos_pagados','[]'::JSONB)||v_pagos_snapshot,
      'conciliado_en',clock_timestamp(),'nota_pago',COALESCE(btrim(p_evidencia),''),
      'idempotency_key',p_idempotency_key)
    ELSE x.value END ORDER BY x.ordinality) INTO v_formas_cliente_nuevas
  FROM jsonb_array_elements(v_formas_cliente) WITH ORDINALITY AS x(value,ordinality);

  SELECT jsonb_agg(CASE WHEN jsonb_typeof(x.value)='object'
      AND lower(btrim(COALESCE(x.value->>'metodo','')))='cobro a destino'
    THEN x.value||jsonb_build_object(
      'cobro_destino_pagado',(v_deuda_cod-v_total_pago)<=0,
      'conciliado_sin_abono',FALSE,
      'metodos_pagados',COALESCE(v_cod_pago->'metodos_pagados','[]'::JSONB)||v_pagos_snapshot,
      'conciliado_en',clock_timestamp(),'nota_pago',COALESCE(btrim(p_evidencia),''),
      'idempotency_key',p_idempotency_key)
    ELSE x.value END ORDER BY x.ordinality) INTO v_formas_pago_nuevas
  FROM jsonb_array_elements(v_formas_pago) WITH ORDINALITY AS x(value,ordinality);

  UPDATE public.notas_despacho SET forma_pago=v_formas_pago_nuevas::TEXT,
    forma_pago_cliente=v_formas_cliente_nuevas::TEXT
  WHERE id=p_despacho_id AND cuenta_id=p_cuenta_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'COD_CONCILIACION_DESPACHO_CAMBIO'; END IF;

  INSERT INTO public.auditoria(
    usuario_id,usuario_nombre,usuario_rol,categoria,accion,descripcion,
    entidad_tipo,entidad_id,meta,ip_origen,cuenta_id
  ) VALUES(
    p_usuario_id,v_actor.nombre,v_actor.rol,'COTIZACION','COD_CONCILIADO_CON_EVIDENCIA',
    'Cobro COD registrado en ledger para despacho #'||v_despacho.numero,
    'despacho',p_despacho_id,
    jsonb_build_object('cuenta_id',p_cuenta_id,'cargo_cod_usd',round(v_cargos_cod,2),
      'pago_usd',round(v_total_pago,2),'saldo_previo_usd',v_deuda_cod,
      'excedente_usd',GREATEST(0,round(v_total_pago-v_deuda_cod,2)),
      'metodos',v_pagos_snapshot,'nota',COALESCE(btrim(p_evidencia),''),'abono_ids',to_jsonb(v_ids),
      'idempotency_key',p_idempotency_key),NULLIF(btrim(p_ip_origen),''),p_cuenta_id
  );

  IF v_deuda_cod-v_total_pago<=0 THEN
    SELECT public.recalcularcomisiondespacho_238b(p_despacho_id) INTO v_comision_id;
  END IF;
  v_resultado:=jsonb_build_object('ok',TRUE,'transaccion_atomica',TRUE,'idempotent',FALSE,
    'cuenta_id',p_cuenta_id,'despacho_id',p_despacho_id,'abono_ids',to_jsonb(v_ids),
    'comision_id',v_comision_id,'saldo_previo_usd',v_deuda_cod,'pago_usd',round(v_total_pago,2),
    'saldo_restante_usd',GREATEST(0,round(v_deuda_cod-v_total_pago,2)),
    'excedente_usd',GREATEST(0,round(v_total_pago-v_deuda_cod,2)),
    'estado_cod',CASE WHEN v_deuda_cod-v_total_pago<=0 THEN 'cobrado' ELSE 'parcial' END,
    'idempotency_key',p_idempotency_key);
  UPDATE public.cod_conciliacion_idempotencia SET resultado=v_resultado
  WHERE cuenta_id=p_cuenta_id AND idempotency_key=p_idempotency_key;
  RETURN v_resultado;
END;
$function$

