CREATE OR REPLACE FUNCTION public.confirmar_entrega_finanzas_idempotente(p_cuenta_id uuid, p_despacho_id uuid, p_idempotency_key uuid, p_usuario_id uuid, p_usuario_nombre text, p_usuario_color text DEFAULT NULL::text, p_tasa_snapshot numeric DEFAULT NULL::numeric, p_permitir_negativo boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_despacho        RECORD;
  v_cliente         RECORD;
  v_guard           JSONB;
  v_inventario      JSONB;
  v_resultado       JSONB;
  v_forma_pago      JSONB := '[]'::JSONB;
  v_forma_pago_text TEXT;
  v_pago            JSONB;
  v_cliente_id      UUID;
  v_metodo          TEXT;
  v_metodo_cxc      TEXT;
  v_monto           NUMERIC(12,4);
  v_saldo           NUMERIC(12,4) := 0;
  v_usuario_fk      UUID;
  v_total_asignado NUMERIC(12,4) := 0;
  v_excedente       NUMERIC(12,4) := 0;
  v_vuelto_a_favor  BOOLEAN := FALSE;
  v_cxc_creados     INTEGER := 0;
  v_comision_id     UUID;
  v_saldo_pendiente NUMERIC(12,4) := 0;
  v_saldo_favor    NUMERIC(12,4) := 0;
BEGIN
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_OBLIGATORIA';
  END IF;

  IF p_cuenta_id IS NULL OR p_despacho_id IS NULL
     OR p_usuario_id IS NULL OR p_usuario_nombre IS NULL
     OR btrim(p_usuario_nombre) = '' THEN
    RAISE EXCEPTION 'PARAMETROS_ENTREGA_FINANCIERA_INVALIDOS';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.usuarios
    WHERE id = p_usuario_id AND cuenta_id = p_cuenta_id AND activo = TRUE
  ) THEN
    RAISE EXCEPTION 'USUARIO_FUERA_DE_TENANT';
  END IF;

  SELECT *
  INTO v_despacho
  FROM public.notas_despacho
  WHERE id = p_despacho_id AND cuenta_id = p_cuenta_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DESPACHO_NO_ENCONTRADO_EN_TENANT'; END IF;

  v_guard := public.reservar_operacion_inventario(
    p_cuenta_id, p_idempotency_key, 'dispatch_delivery_financial'
  );
  IF COALESCE((v_guard->>'existente')::BOOLEAN, FALSE) THEN
    IF v_guard->'resultado' IS NULL OR v_guard->'resultado' = 'null'::JSONB THEN
      RAISE EXCEPTION 'OPERACION_IDEMPOTENTE_SIN_RESULTADO';
    END IF;
    RETURN (v_guard->'resultado') || jsonb_build_object('idempotent', TRUE);
  END IF;

  v_inventario := public.confirmar_entrega_inventario_atomica(
    p_despacho_id, p_usuario_id, p_usuario_nombre, p_usuario_color,
    p_tasa_snapshot, p_permitir_negativo
  );

  -- El Worker histórico prioriza forma_pago_cliente y cae a forma_pago.
  v_forma_pago_text := COALESCE(
    NULLIF(btrim(v_despacho.forma_pago_cliente::TEXT), ''),
    NULLIF(btrim(v_despacho.forma_pago::TEXT), ''),
    '[]'
  );
  BEGIN
    IF lower(v_forma_pago_text) = lower('Cta por cobrar') THEN
      v_forma_pago := jsonb_build_array(
        jsonb_build_object('metodo', 'Cta por cobrar', 'monto', COALESCE(v_despacho.total_usd, 0))
      );
    ELSE
      v_forma_pago := v_forma_pago_text::JSONB;
    END IF;
  EXCEPTION WHEN others THEN
    -- Un texto legacy no estructurado no crea cargos implícitos. La comisión
    -- histórica seguirá siendo calculable, pero no se inventa una deuda.
    v_forma_pago := '[]'::JSONB;
  END;
  IF jsonb_typeof(v_forma_pago) <> 'array' THEN
    v_forma_pago := '[]'::JSONB;
  END IF;

  v_cliente_id := COALESCE(v_despacho.cliente_factura_id, v_despacho.cliente_id);
  SELECT u.id
  INTO v_usuario_fk
  FROM public.usuarios u
  WHERE u.id = p_usuario_id
    AND u.activo = TRUE
    AND u.cuenta_id = p_cuenta_id
  LIMIT 1;
  IF v_usuario_fk IS NULL THEN
    SELECT u.id
    INTO v_usuario_fk
    FROM public.usuarios u
    WHERE u.activo = TRUE
      AND u.cuenta_id = p_cuenta_id
      AND u.rol IN ('supervisor', 'administracion', 'jefe', 'logistica', 'desarrollador')
    ORDER BY u.nombre, u.id
    LIMIT 1;
  END IF;
  IF v_usuario_fk IS NULL THEN RAISE EXCEPTION 'USUARIO_CXC_NO_ENCONTRADO'; END IF;

  IF v_cliente_id IS NOT NULL THEN
    SELECT *
    INTO v_cliente
    FROM public.clientes
    WHERE id = v_cliente_id AND cuenta_id = p_cuenta_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CLIENTE_CXC_NO_ENCONTRADO_EN_TENANT'; END IF;
    v_saldo := COALESCE(v_cliente.saldo_pendiente, 0);
  END IF;

  FOR v_pago IN SELECT value FROM jsonb_array_elements(v_forma_pago)
  LOOP
    v_metodo := btrim(COALESCE(v_pago->>'metodo', ''));
    v_monto := COALESCE(NULLIF(v_pago->>'monto', '')::NUMERIC, 0);
    IF v_monto < 0 THEN RAISE EXCEPTION 'MONTO_FORMA_PAGO_INVALIDO'; END IF;
    IF v_monto = 0 THEN CONTINUE; END IF;

    v_total_asignado := v_total_asignado + v_monto;
    v_vuelto_a_favor := v_vuelto_a_favor
      OR COALESCE((v_pago->>'vuelto_a_favor')::BOOLEAN, FALSE);

    IF lower(v_metodo) IN ('cta por cobrar', 'cobro a destino') AND v_cliente_id IS NOT NULL THEN
      v_metodo_cxc := CASE WHEN lower(v_metodo) = 'cobro a destino' THEN 'cod' ELSE 'cxc' END;
      IF NOT EXISTS (
        SELECT 1
        FROM public.cuentas_por_cobrar c
        WHERE c.despacho_id = p_despacho_id
          AND c.tipo = 'cargo'
          AND lower(COALESCE(c.metodo_pago, 'cxc')) = v_metodo_cxc
          AND c.cuenta_id = p_cuenta_id
      ) THEN
        v_saldo := ROUND((v_saldo + v_monto)::NUMERIC, 4);
        INSERT INTO public.cuentas_por_cobrar (
          cliente_id, despacho_id, tipo, monto_usd, saldo_usd,
          descripcion, registrado_por, cuenta_id, metodo_pago
        ) VALUES (
          v_cliente_id, p_despacho_id, 'cargo', v_monto, v_saldo,
          'Orden de despacho #' || v_despacho.numero ||
            CASE WHEN v_metodo_cxc = 'cod' THEN ' (COD)' ELSE ' (Crédito)' END,
          v_usuario_fk, p_cuenta_id, v_metodo_cxc
        );
        v_cxc_creados := v_cxc_creados + 1;
      END IF;
    ELSIF lower(v_metodo) = 'saldo a favor' AND v_cliente_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1
        FROM public.cuentas_por_cobrar c
        WHERE c.despacho_id = p_despacho_id
          AND c.tipo = 'abono'
          AND lower(COALESCE(c.forma_pago_abono, '')) = 'saldo a favor'
          AND c.cuenta_id = p_cuenta_id
      ) THEN
        v_saldo := GREATEST(0, ROUND((v_saldo - v_monto)::NUMERIC, 4));
        INSERT INTO public.cuentas_por_cobrar (
          cliente_id, despacho_id, tipo, monto_usd, saldo_usd,
          forma_pago_abono, referencia, descripcion, registrado_por, cuenta_id,
          metodo_pago
        ) VALUES (
          v_cliente_id, p_despacho_id, 'abono', v_monto, v_saldo,
          'Saldo a favor', 'Despacho #' || v_despacho.numero,
          'Pago con Saldo a Favor', v_usuario_fk, p_cuenta_id, 'cxc'
        );
        v_cxc_creados := v_cxc_creados + 1;
      END IF;
    END IF;
  END LOOP;

  -- El excedente con vuelto a favor se contabiliza como crédito solo una vez.
  v_excedente := ROUND((v_total_asignado - COALESCE(v_despacho.total_usd, 0))::NUMERIC, 4);
  IF v_excedente > 0.015 AND v_vuelto_a_favor AND v_cliente_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.cuentas_por_cobrar c
       WHERE c.despacho_id = p_despacho_id
         AND c.tipo = 'credito'
         AND c.cuenta_id = p_cuenta_id
     ) THEN
    INSERT INTO public.cuentas_por_cobrar (
      cliente_id, despacho_id, tipo, monto_usd, saldo_usd,
      referencia, descripcion, registrado_por, cuenta_id, metodo_pago
    ) VALUES (
      v_cliente_id, p_despacho_id, 'credito', v_excedente, v_saldo,
      'Despacho #' || v_despacho.numero,
      'Excedente de pago en Despacho #' || v_despacho.numero,
      v_usuario_fk, p_cuenta_id, 'cxc'
    );
    v_cxc_creados := v_cxc_creados + 1;
  END IF;

  IF v_cliente_id IS NOT NULL THEN
    SELECT
      COALESCE(SUM(CASE
        WHEN c.tipo = 'cargo' THEN c.monto_usd
        WHEN c.tipo = 'abono' THEN -c.monto_usd
        ELSE 0 END), 0),
      COALESCE(SUM(CASE
        WHEN c.tipo = 'credito' THEN c.monto_usd
        WHEN c.tipo = 'abono' AND lower(COALESCE(c.forma_pago_abono, '')) = 'saldo a favor' THEN -c.monto_usd
        WHEN c.tipo = 'devolucion_credito' THEN -c.monto_usd
        ELSE 0 END), 0)
    INTO v_saldo_pendiente, v_saldo_favor
    FROM public.cuentas_por_cobrar c
    WHERE c.cliente_id = v_cliente_id AND c.cuenta_id = p_cuenta_id;

    UPDATE public.clientes
    SET saldo_pendiente = GREATEST(0, ROUND(v_saldo_pendiente::NUMERIC, 4)),
        saldo_a_favor = GREATEST(0, ROUND(v_saldo_favor::NUMERIC, 4))
    WHERE id = v_cliente_id AND cuenta_id = p_cuenta_id;
  END IF;

  -- La función histórica calcula la comisión con los contratos v2 del
  -- principal. Al estar dentro de esta transacción, un error revierte todo.
  SELECT public.calcularcomisiondespacho(p_despacho_id)
  INTO v_comision_id;

  v_resultado := COALESCE(v_inventario, '{}'::JSONB)
    || jsonb_build_object(
      'ok', TRUE,
      'nuevo_estado', 'entregada',
      'finanzas_atomicas', TRUE,
      'cxc_movimientos_creados', v_cxc_creados,
      'comision_id', v_comision_id,
      'idempotency_key', p_idempotency_key
    );
  PERFORM public.guardar_operacion_inventario(p_cuenta_id, p_idempotency_key, v_resultado);
  RETURN v_resultado;
END
$function$
