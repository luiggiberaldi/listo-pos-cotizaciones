CREATE OR REPLACE FUNCTION public.registrar_devolucion_parcial_cobro_idempotente(p_cuenta_id uuid, p_despacho_id uuid, p_idempotency_key uuid, p_devoluciones jsonb, p_intercambios jsonb DEFAULT '[]'::jsonb, p_motivo text DEFAULT NULL::text, p_usuario_id uuid DEFAULT NULL::uuid, p_usuario_nombre text DEFAULT NULL::text, p_usuario_color text DEFAULT NULL::text, p_cotizacion_reemplazo_id uuid DEFAULT NULL::uuid, p_total_devuelto_usd numeric DEFAULT 0, p_total_intercambio_usd numeric DEFAULT 0, p_reemplazo jsonb DEFAULT NULL::jsonb, p_pagos_diferencia jsonb DEFAULT NULL::jsonb, p_destino_saldo text DEFAULT 'saldo_a_favor'::text, p_pagos_reembolso jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_resultado JSONB;
  v_cobro     JSONB;
  v_destino   TEXT := COALESCE(NULLIF(btrim(COALESCE(p_destino_saldo, '')), ''), 'saldo_a_favor');
BEGIN
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_OBLIGATORIA';
  END IF;

  IF v_destino NOT IN ('saldo_a_favor', 'reembolso') THEN
    RAISE EXCEPTION 'DESTINO_SALDO_INVALIDO';
  END IF;

  -- Validación temprana: un payload inválido no consume la clave idempotente.
  IF p_pagos_diferencia IS NOT NULL AND p_pagos_diferencia <> 'null'::JSONB THEN
    IF jsonb_typeof(p_pagos_diferencia) <> 'array' THEN
      RAISE EXCEPTION 'PAGO_DIFERENCIA_INVALIDO';
    END IF;
    IF jsonb_array_length(p_pagos_diferencia) > 0 THEN
      PERFORM public.validar_pagos_diferencia_devolucion(
        p_cuenta_id, p_despacho_id, p_total_devuelto_usd, p_total_intercambio_usd,
        p_pagos_diferencia
      );
    END IF;
  END IF;

  IF v_destino = 'reembolso' THEN
    IF p_pagos_reembolso IS NULL OR p_pagos_reembolso = 'null'::JSONB
       OR jsonb_typeof(p_pagos_reembolso) <> 'array'
       OR jsonb_array_length(p_pagos_reembolso) = 0 THEN
      RAISE EXCEPTION 'REEMBOLSO_PAGOS_REQUERIDOS';
    END IF;
    IF jsonb_array_length(p_pagos_reembolso) > 12 THEN
      RAISE EXCEPTION 'REEMBOLSO_DEMASIADOS_PAGOS';
    END IF;
  END IF;

  -- GUC transaccionales: la RPC profunda los propaga a ajustar_finanzas_
  -- devolucion_neta sin cambiar firmas (is_local = true ⇒ mueren al cerrar).
  PERFORM set_config('app.devolucion_destino', v_destino, TRUE);
  PERFORM set_config(
    'app.devolucion_reembolso_pagos',
    CASE WHEN v_destino = 'reembolso' THEN p_pagos_reembolso::TEXT ELSE NULL END,
    TRUE
  );

  v_resultado := public.registrar_devolucion_parcial_idempotente(
    p_cuenta_id, p_despacho_id, p_idempotency_key, p_devoluciones, p_intercambios,
    p_motivo, p_usuario_id, p_usuario_nombre, p_usuario_color,
    p_cotizacion_reemplazo_id, p_total_devuelto_usd, p_total_intercambio_usd, p_reemplazo
  );

  -- Replay: devolver el resultado original guardado sin re-insertar abonos.
  IF COALESCE((v_resultado->>'idempotent')::BOOLEAN, FALSE) THEN
    RETURN v_resultado;
  END IF;

  IF p_pagos_diferencia IS NOT NULL AND p_pagos_diferencia <> 'null'::JSONB
     AND jsonb_typeof(p_pagos_diferencia) = 'array'
     AND jsonb_array_length(p_pagos_diferencia) > 0 THEN
    v_cobro := public.registrar_cobro_diferencia_devolucion(
      p_cuenta_id, p_despacho_id, p_usuario_id, p_usuario_nombre,
      p_total_devuelto_usd, p_total_intercambio_usd, p_pagos_diferencia
    );
    v_resultado := v_resultado || v_cobro;
  END IF;

  RETURN v_resultado;
END;
$function$
