CREATE OR REPLACE FUNCTION public.validar_pagos_diferencia_devolucion(p_cuenta_id uuid, p_despacho_id uuid, p_total_devuelto_usd numeric, p_total_intercambio_usd numeric, p_pagos jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_despacho   RECORD;
  v_diferencia NUMERIC(12,2);
  v_suma       NUMERIC(12,2);
BEGIN
  IF p_pagos IS NULL OR jsonb_typeof(p_pagos) <> 'array'
     OR jsonb_array_length(p_pagos) = 0
     OR jsonb_array_length(p_pagos) > 12 THEN
    RAISE EXCEPTION 'PAGO_DIFERENCIA_INVALIDO';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_pagos) AS x(metodo TEXT, monto NUMERIC, referencia TEXT)
    WHERE btrim(COALESCE(x.metodo, '')) NOT IN (
        'Efectivo $', 'Efectivo Bs', 'Zelle', 'Transf. / Pago Móvil',
        'Punto de Venta', 'USDT', 'Cruce'
      )
       OR x.monto IS NULL OR x.monto <> x.monto OR ROUND(x.monto, 4) <= 0
       OR x.monto > 1000000000
       OR (btrim(x.metodo) = 'Transf. / Pago Móvil'
           AND btrim(COALESCE(x.referencia, '')) = '')
       OR length(btrim(COALESCE(x.referencia, ''))) > 160
  ) THEN
    RAISE EXCEPTION 'PAGO_DIFERENCIA_INVALIDO';
  END IF;

  SELECT numero, cuenta_id, COALESCE(cliente_factura_id, cliente_id) AS cliente_id
  INTO v_despacho
  FROM public.notas_despacho
  WHERE id = p_despacho_id;

  IF v_despacho.numero IS NULL OR v_despacho.cuenta_id IS DISTINCT FROM p_cuenta_id THEN
    RAISE EXCEPTION 'PAGO_DIFERENCIA_DESPACHO_INVALIDO';
  END IF;

  IF v_despacho.cliente_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.clientes c
    WHERE c.id = v_despacho.cliente_id AND c.cuenta_id = p_cuenta_id
  ) THEN
    RAISE EXCEPTION 'PAGO_DIFERENCIA_SIN_CLIENTE';
  END IF;

  v_diferencia := ROUND((COALESCE(p_total_intercambio_usd, 0) - COALESCE(p_total_devuelto_usd, 0))::NUMERIC, 2);
  IF v_diferencia <= 0 THEN
    RAISE EXCEPTION 'PAGO_DIFERENCIA_SIN_CARGO';
  END IF;

  SELECT ROUND(COALESCE(SUM(ROUND(x.monto, 4)), 0), 2)
  INTO v_suma
  FROM jsonb_to_recordset(p_pagos) AS x(monto NUMERIC);

  IF v_suma > v_diferencia + 0.01 THEN
    RAISE EXCEPTION 'PAGO_DIFERENCIA_EXCEDE_DIFERENCIA';
  END IF;

  RETURN TRUE;
END;
$function$
