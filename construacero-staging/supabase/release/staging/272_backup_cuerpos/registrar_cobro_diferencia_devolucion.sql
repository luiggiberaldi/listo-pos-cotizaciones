CREATE OR REPLACE FUNCTION public.registrar_cobro_diferencia_devolucion(p_cuenta_id uuid, p_despacho_id uuid, p_usuario_id uuid, p_usuario_nombre text, p_total_devuelto_usd numeric, p_total_intercambio_usd numeric, p_pagos jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_despacho   RECORD;
  v_cliente_id UUID;
  v_saldo      NUMERIC(12,4);
  v_favor      NUMERIC(12,4);
  v_pagado     NUMERIC(12,4) := 0;
  v_diferencia NUMERIC(12,2);
  v_pago       RECORD;
BEGIN
  PERFORM public.validar_pagos_diferencia_devolucion(
    p_cuenta_id, p_despacho_id, p_total_devuelto_usd, p_total_intercambio_usd, p_pagos
  );

  SELECT numero, cuenta_id, COALESCE(cliente_factura_id, cliente_id) AS cliente_id
  INTO v_despacho
  FROM public.notas_despacho
  WHERE id = p_despacho_id AND cuenta_id = p_cuenta_id
  FOR UPDATE;
  IF v_despacho.numero IS NULL THEN
    RAISE EXCEPTION 'PAGO_DIFERENCIA_DESPACHO_INVALIDO';
  END IF;

  v_cliente_id := v_despacho.cliente_id;
  SELECT saldo_pendiente
  INTO v_saldo
  FROM public.clientes
  WHERE id = v_cliente_id AND cuenta_id = p_cuenta_id
  FOR UPDATE;
  IF v_saldo IS NULL THEN
    RAISE EXCEPTION 'PAGO_DIFERENCIA_SIN_CLIENTE';
  END IF;

  v_diferencia := ROUND((COALESCE(p_total_intercambio_usd, 0) - COALESCE(p_total_devuelto_usd, 0))::NUMERIC, 2);

  FOR v_pago IN
    SELECT * FROM jsonb_to_recordset(p_pagos) AS x(metodo TEXT, monto NUMERIC, referencia TEXT)
  LOOP
    INSERT INTO public.cuentas_por_cobrar (
      cliente_id, despacho_id, tipo, monto_usd, saldo_usd,
      forma_pago_abono, referencia, descripcion, registrado_por, cuenta_id,
      metodo_pago
    ) VALUES (
      v_cliente_id,
      p_despacho_id,
      'abono',
      ROUND(v_pago.monto, 4),
      GREATEST(0, ROUND((v_saldo - ROUND(v_pago.monto, 4))::NUMERIC, 4)),
      btrim(v_pago.metodo),
      NULLIF(btrim(COALESCE(v_pago.referencia, '')), ''),
      'Cobro de diferencia en intercambio — Despacho #' || v_despacho.numero,
      p_usuario_id,
      p_cuenta_id,
      'cxc'
    );
    v_saldo := GREATEST(0, ROUND((v_saldo - ROUND(v_pago.monto, 4))::NUMERIC, 4));
    v_pagado := v_pagado + ROUND(v_pago.monto, 4);
  END LOOP;

  -- Mismo cierre que las RPC 03/245: los triggers mantienen los saldos
  -- denormalizados; se recalculan bajo el mismo bloqueo para dejarlo explícito.
  SELECT
    COALESCE(SUM(CASE
      WHEN c.tipo = 'cargo' THEN c.monto_usd
      WHEN c.tipo = 'abono' THEN -c.monto_usd
      ELSE 0 END), 0),
    COALESCE(SUM(CASE
      WHEN c.tipo = 'credito' THEN c.monto_usd
      WHEN c.tipo = 'abono' AND c.forma_pago_abono = 'Saldo a favor' THEN -c.monto_usd
      WHEN c.tipo = 'devolucion_credito' THEN -c.monto_usd
      ELSE 0 END), 0)
  INTO v_saldo, v_favor
  FROM public.cuentas_por_cobrar c
  WHERE c.cliente_id = v_cliente_id;

  UPDATE public.clientes
  SET saldo_pendiente = GREATEST(0, ROUND(v_saldo::NUMERIC, 4)),
      saldo_a_favor = GREATEST(0, ROUND(v_favor::NUMERIC, 4))
  WHERE id = v_cliente_id;

  RETURN jsonb_build_object(
    'pagos_diferencia', p_pagos,
    'pagado_diferencia_usd', ROUND(v_pagado, 2),
    'pendiente_diferencia_usd', GREATEST(0, ROUND((v_diferencia - v_pagado)::NUMERIC, 2))
  );
END;
$function$
