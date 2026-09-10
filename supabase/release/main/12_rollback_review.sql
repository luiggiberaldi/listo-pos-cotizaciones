-- 12_rollback_review.sql — RELEASE 12 (principal)
-- Restituye los 4 cuerpos ORIGINALES (dump vivo previo al release).
-- NOTA: el rollback revierte FUNCIONES, no datos. La columna clientes.saldo_a_favor
-- reparada tras el release permanece correcta: el trigger trg_recalcular_saldo_pendiente
-- (que sí conoce consumo_credito) la mantiene.

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
$function$;

CREATE OR REPLACE FUNCTION public.ajustar_finanzas_devolucion_atomica(p_despacho_id uuid, p_total_devuelto_usd numeric, p_total_intercambio_usd numeric, p_usuario_id uuid DEFAULT NULL::uuid, p_usuario_nombre text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_despacho           RECORD;
  v_cliente            RECORD;
  v_usuario_fk         UUID;
  v_comision           RECORD;
  v_total_original     NUMERIC(12,4);
  v_total_nuevo        NUMERIC(12,4);
  v_balance_neto       NUMERIC(12,4);
  v_cxc_despacho       NUMERIC(12,4) := 0;
  v_saldo_pendiente    NUMERIC(12,4) := 0;
  v_saldo_favor        NUMERIC(12,4) := 0;
  v_tiene_cliente      BOOLEAN := FALSE;
  v_abono              NUMERIC(12,4) := 0;
  v_credito            NUMERIC(12,4) := 0;
  v_cargo              NUMERIC(12,4) := 0;
  v_factor             NUMERIC(12,8);
  v_liberada           NUMERIC(12,2);
  v_retenida           NUMERIC(12,2);
  v_comision_nueva     NUMERIC(12,2);
  v_comision_ajustada  BOOLEAN := FALSE;
  v_destino            TEXT := COALESCE(NULLIF(btrim(COALESCE(current_setting('app.devolucion_destino', TRUE), '')), ''), 'saldo_a_favor');
  v_pagos_reembolso    JSONB := NULLIF(current_setting('app.devolucion_reembolso_pagos', TRUE), '')::JSONB;
  v_pago               RECORD;
  v_reembolso_total    NUMERIC(12,4) := 0;
  v_metodos_resumen    TEXT;
  v_refs_resumen       TEXT;
BEGIN
  IF p_despacho_id IS NULL
     OR p_total_devuelto_usd IS NULL
     OR p_total_intercambio_usd IS NULL
     OR p_total_devuelto_usd < 0
     OR p_total_intercambio_usd < 0
     OR p_usuario_id IS NULL
     OR p_usuario_nombre IS NULL
     OR char_length(trim(p_usuario_nombre)) = 0 THEN
    RAISE EXCEPTION 'PARAMETROS_FINANZAS_DEVOLUCION_INVALIDOS';
  END IF;

  IF v_destino NOT IN ('saldo_a_favor', 'reembolso') THEN
    RAISE EXCEPTION 'DESTINO_SALDO_INVALIDO';
  END IF;
  IF v_destino = 'reembolso' AND v_pagos_reembolso IS NULL THEN
    RAISE EXCEPTION 'REEMBOLSO_PAGOS_REQUERIDOS';
  END IF;

  SELECT *
  INTO v_despacho
  FROM public.notas_despacho
  WHERE id = p_despacho_id
  FOR UPDATE;

  IF NOT FOUND OR v_despacho.estado <> 'entregada' THEN
    RAISE EXCEPTION 'DESPACHO_FINANZAS_NO_DISPONIBLE';
  END IF;

  v_total_nuevo := COALESCE(v_despacho.total_usd, 0);
  v_total_original := ROUND((v_total_nuevo
    + p_total_devuelto_usd
    - p_total_intercambio_usd)::NUMERIC, 4);

  IF v_total_original < 0 OR v_total_nuevo < 0 THEN
    RAISE EXCEPTION 'TOTAL_DEVOLUCION_INVALIDO';
  END IF;

  SELECT u.id
  INTO v_usuario_fk
  FROM public.usuarios u
  WHERE u.id = p_usuario_id
    AND u.activo = TRUE
    AND (v_despacho.cuenta_id IS NULL OR u.cuenta_id = v_despacho.cuenta_id)
  LIMIT 1;

  IF v_usuario_fk IS NULL THEN
    SELECT u.id
    INTO v_usuario_fk
    FROM public.usuarios u
    WHERE u.activo = TRUE
      AND (v_despacho.cuenta_id IS NULL OR u.cuenta_id = v_despacho.cuenta_id)
      AND u.rol IN ('supervisor', 'administracion', 'jefe', 'logistica', 'desarrollador')
    ORDER BY u.nombre
    LIMIT 1;
  END IF;

  IF v_usuario_fk IS NULL THEN
    RAISE EXCEPTION 'USUARIO_CXC_NO_ENCONTRADO';
  END IF;

  IF COALESCE(v_despacho.cliente_factura_id, v_despacho.cliente_id) IS NOT NULL THEN
    SELECT *
    INTO v_cliente
    FROM public.clientes
    WHERE id = COALESCE(v_despacho.cliente_factura_id, v_despacho.cliente_id)
      AND (v_despacho.cuenta_id IS NULL OR cuenta_id = v_despacho.cuenta_id)
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'CLIENTE_CXC_NO_ENCONTRADO';
    END IF;

    v_tiene_cliente := TRUE;
    v_saldo_pendiente := COALESCE(v_cliente.saldo_pendiente, 0);
    v_saldo_favor := COALESCE(v_cliente.saldo_a_favor, 0);

    v_balance_neto := ROUND((p_total_intercambio_usd - p_total_devuelto_usd)::NUMERIC, 4);

    IF v_balance_neto > 0 THEN
      v_cargo := v_balance_neto;

      INSERT INTO public.cuentas_por_cobrar (
        cliente_id, despacho_id, tipo, monto_usd, saldo_usd,
        descripcion, registrado_por, cuenta_id
      ) VALUES (
        v_cliente.id,
        p_despacho_id,
        'cargo',
        v_cargo,
        ROUND((v_saldo_pendiente + v_cargo)::NUMERIC, 4),
        'Cargo por diferencia en intercambio — Despacho #' || v_despacho.numero,
        v_usuario_fk,
        v_despacho.cuenta_id
      );
    ELSIF v_balance_neto < 0 THEN
      IF v_destino = 'reembolso' THEN
        -- Reembolso coherente: deuda intacta; todo el balance es crédito que
        -- se consume abajo con devolucion_credito en la misma transacción.
        v_credito := ROUND(abs(v_balance_neto)::NUMERIC, 4);
        INSERT INTO public.cuentas_por_cobrar (
          cliente_id, despacho_id, tipo, monto_usd, saldo_usd,
          forma_pago_abono, referencia, descripcion, registrado_por, cuenta_id
        ) VALUES (
          v_cliente.id,
          p_despacho_id,
          'credito',
          v_credito,
          GREATEST(0, ROUND(v_saldo_pendiente::NUMERIC, 4)),
          'Devolución',
          'Despacho #' || v_despacho.numero,
          'Saldo a favor para reembolso — Despacho #' || v_despacho.numero,
          v_usuario_fk,
          v_despacho.cuenta_id
        );
      ELSE
        -- Histórico: compensa la deuda del despacho; excedente a crédito.
        SELECT COALESCE(SUM(
          CASE
            WHEN c.tipo = 'cargo' THEN c.monto_usd
            WHEN c.tipo = 'abono' THEN -c.monto_usd
            ELSE 0
          END
        ), 0)
        INTO v_cxc_despacho
        FROM public.cuentas_por_cobrar c
        WHERE c.despacho_id = p_despacho_id;

        v_cxc_despacho := GREATEST(0, v_cxc_despacho);
        v_abono := ROUND(LEAST(abs(v_balance_neto), v_cxc_despacho)::NUMERIC, 4);

        IF v_abono > 0 THEN
          INSERT INTO public.cuentas_por_cobrar (
            cliente_id, despacho_id, tipo, monto_usd, saldo_usd,
            forma_pago_abono, referencia, descripcion, registrado_por, cuenta_id
          ) VALUES (
            v_cliente.id,
            p_despacho_id,
            'abono',
            v_abono,
            GREATEST(0, ROUND((v_saldo_pendiente - v_abono)::NUMERIC, 4)),
            'Devolución',
            'Despacho #' || v_despacho.numero,
            'Abono por devolución/intercambio — Despacho #' || v_despacho.numero,
            v_usuario_fk,
            v_despacho.cuenta_id
          );
        END IF;

        v_credito := ROUND((abs(v_balance_neto) - v_abono)::NUMERIC, 4);
        IF v_credito > 0 THEN
          INSERT INTO public.cuentas_por_cobrar (
            cliente_id, despacho_id, tipo, monto_usd, saldo_usd,
            forma_pago_abono, referencia, descripcion, registrado_por, cuenta_id
          ) VALUES (
            v_cliente.id,
            p_despacho_id,
            'credito',
            v_credito,
            GREATEST(0, ROUND((v_saldo_pendiente - v_abono)::NUMERIC, 4)),
            'Devolución',
            'Despacho #' || v_despacho.numero,
            'Saldo a favor por excedente en intercambio — Despacho #' || v_despacho.numero,
            v_usuario_fk,
            v_despacho.cuenta_id
          );
        END IF;
      END IF;
    END IF;
  ELSE
    v_balance_neto := ROUND((p_total_intercambio_usd - p_total_devuelto_usd)::NUMERIC, 4);
  END IF;

  -- Escalado MULTI-FILA (restaurado desde 257): con el split de sábados un
  -- despacho puede tener varias filas de comisión (dueño del cliente +
  -- designado del día); todas deben escalar por el mismo factor. La versión
  -- de 262 solo escalaba la primera fila y dejaba la otra sin ajustar.
  IF EXISTS (
    SELECT 1 FROM public.comisiones c
    WHERE c.despachoid = p_despacho_id
      AND (c.estado = 'pagada' OR COALESCE(c.montopagado, 0) > 0.01)
  ) THEN
    RAISE EXCEPTION 'COMISION_YA_PAGADA: revierta el pago antes de registrar la devolución';
  END IF;

  IF v_total_original > 0 THEN
    v_factor := v_total_nuevo / v_total_original;

    FOR v_comision IN
      SELECT * FROM public.comisiones c
      WHERE c.despachoid = p_despacho_id
      FOR UPDATE
    LOOP
      v_comision_nueva := ROUND((COALESCE(v_comision.totalcomision, 0) * v_factor)::NUMERIC, 2);
      v_liberada := ROUND((COALESCE(v_comision.comision_liberada, v_comision.totalcomision) * v_factor)::NUMERIC, 2);
      v_liberada := LEAST(v_comision_nueva, GREATEST(0, v_liberada));
      v_retenida := ROUND((v_comision_nueva - v_liberada)::NUMERIC, 2);

      UPDATE public.comisiones
      SET totalcomision = v_comision_nueva,
          comisioncabilla = ROUND((COALESCE(comisioncabilla, 0) * v_factor)::NUMERIC, 2),
          comisionotros = ROUND((COALESCE(comisionotros, 0) * v_factor)::NUMERIC, 2),
          comision_liberada = v_liberada,
          comision_retenida = v_retenida,
          estado = CASE WHEN v_retenida > 0.01 THEN 'cta_cobrar' ELSE 'pendiente' END,
          actualizadoen = now()
      WHERE id = v_comision.id;
      v_comision_ajustada := TRUE;
    END LOOP;
  END IF;

  -- REEMBOLSO ATÓMICO (idéntico al principal).
  IF v_destino = 'reembolso' AND v_tiene_cliente
     AND v_pagos_reembolso IS NOT NULL AND v_pagos_reembolso <> 'null'::JSONB
     AND jsonb_typeof(v_pagos_reembolso) = 'array'
     AND jsonb_array_length(v_pagos_reembolso) > 0 THEN

    IF jsonb_array_length(v_pagos_reembolso) > 12 THEN
      RAISE EXCEPTION 'REEMBOLSO_DEMASIADOS_PAGOS';
    END IF;

    FOR v_pago IN
      SELECT * FROM jsonb_to_recordset(v_pagos_reembolso) AS x(
        metodo TEXT, monto NUMERIC, referencia TEXT
      )
    LOOP
      IF v_pago.metodo IS NULL OR btrim(v_pago.metodo) = ''
         OR v_pago.metodo NOT IN ('Efectivo $', 'Efectivo Bs', 'Zelle', 'Transf. / Pago Móvil', 'Punto de Venta', 'USDT') THEN
        RAISE EXCEPTION 'REEMBOLSO_METODO_INVALIDO';
      END IF;
      IF v_pago.monto IS NULL OR v_pago.monto <= 0 THEN
        RAISE EXCEPTION 'REEMBOLSO_MONTO_INVALIDO';
      END IF;
      IF v_pago.metodo IN ('Transf. / Pago Móvil', 'Zelle', 'USDT')
         AND (v_pago.referencia IS NULL OR btrim(v_pago.referencia) = '') THEN
        RAISE EXCEPTION 'REEMBOLSO_REFERENCIA_OBLIGATORIA';
      END IF;
    END LOOP;

    SELECT COALESCE(SUM(x.monto), 0) INTO v_reembolso_total
    FROM jsonb_to_recordset(v_pagos_reembolso) AS x(monto NUMERIC);
    v_reembolso_total := ROUND(v_reembolso_total::NUMERIC, 4);
    IF v_reembolso_total > abs(v_balance_neto) + 0.01 THEN
      RAISE EXCEPTION 'REEMBOLSO_SUPERA_SALDO_A_FAVOR';
    END IF;

    FOR v_pago IN
      SELECT * FROM jsonb_to_recordset(v_pagos_reembolso) AS x(
        metodo TEXT, monto NUMERIC, referencia TEXT
      )
    LOOP
      INSERT INTO public.cuentas_por_cobrar (
        cliente_id, despacho_id, tipo, monto_usd, saldo_usd,
        forma_pago_abono, referencia, descripcion, registrado_por, cuenta_id
      ) VALUES (
        v_cliente.id, p_despacho_id, 'devolucion_credito', ROUND(v_pago.monto::NUMERIC, 4),
        0,
        v_pago.metodo,
        COALESCE(NULLIF(btrim(COALESCE(v_pago.referencia, '')), ''), 'Despacho #' || v_despacho.numero),
        'Reembolso por devolución entregado al cliente — Despacho #' || v_despacho.numero || ' (' || v_pago.metodo || ')',
        v_usuario_fk, v_despacho.cuenta_id
      );
      v_metodos_resumen := concat_ws(' | ', v_metodos_resumen,
        v_pago.metodo || ': $' || to_char(ROUND(v_pago.monto::NUMERIC, 2), 'FM999999990.00'));
      v_refs_resumen := concat_ws(' | ', v_refs_resumen,
        NULLIF(btrim(COALESCE(v_pago.referencia, '')), ''));
    END LOOP;

    UPDATE public.despacho_devoluciones
    SET destino_saldo = 'reembolso',
        reembolso_metodo = COALESCE(NULLIF(v_metodos_resumen, ''), 'Efectivo $'),
        reembolso_referencia = NULLIF(v_refs_resumen, ''),
        reembolso_monto = v_reembolso_total
    WHERE despacho_id = p_despacho_id;
  END IF;

  -- Triggers de CxC mantienen saldos; se recalculan explícitamente igual que 226.
  IF v_tiene_cliente THEN
    SELECT COALESCE(SUM(CASE
      WHEN c.tipo = 'cargo' THEN c.monto_usd
      WHEN c.tipo = 'abono' THEN -c.monto_usd
      ELSE 0
    END), 0),
    COALESCE(SUM(CASE
      WHEN c.tipo = 'credito' THEN c.monto_usd
      WHEN c.tipo = 'abono' AND c.forma_pago_abono = 'Saldo a favor' THEN -c.monto_usd
      WHEN c.tipo = 'devolucion_credito' THEN -c.monto_usd
      ELSE 0
    END), 0)
    INTO v_saldo_pendiente, v_saldo_favor
    FROM public.cuentas_por_cobrar c
    WHERE c.cliente_id = v_cliente.id;

    UPDATE public.clientes
    SET saldo_pendiente = GREATEST(0, ROUND(v_saldo_pendiente::NUMERIC, 4)),
        saldo_a_favor = GREATEST(0, ROUND(v_saldo_favor::NUMERIC, 4))
    WHERE id = v_cliente.id;
  END IF;

  RETURN jsonb_build_object(
    'balance_neto_usd', v_balance_neto,
    'cargo_monto', v_cargo,
    'abono_monto', v_abono,
    'credito_monto', v_credito,
    'destino_saldo', v_destino,
    'reembolso_total', v_reembolso_total,
    'comision_ajustada', v_comision_ajustada
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.ajustar_finanzas_devolucion_neta(p_despacho_id uuid, p_total_devuelto_usd numeric, p_total_intercambio_usd numeric, p_usuario_id uuid, p_usuario_nombre text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_despacho           RECORD;
  v_cliente            RECORD;
  v_usuario_fk         UUID;
  v_comision           RECORD;
  v_total_original     NUMERIC(12,4);
  v_total_nuevo        NUMERIC(12,4);
  v_base_original      NUMERIC(12,4) := 0;
  v_base_nueva         NUMERIC(12,4) := 0;
  v_balance_neto       NUMERIC(12,4) := 0;
  v_cxc_despacho       NUMERIC(12,4) := 0;
  v_saldo_pendiente    NUMERIC(12,4) := 0;
  v_saldo_favor        NUMERIC(12,4) := 0;
  v_tiene_cliente      BOOLEAN := FALSE;
  v_abono              NUMERIC(12,4) := 0;
  v_credito            NUMERIC(12,4) := 0;
  v_cargo              NUMERIC(12,4) := 0;
  v_factor             NUMERIC(12,8);
  v_liberada           NUMERIC(12,2);
  v_retenida           NUMERIC(12,2);
  v_comision_nueva     NUMERIC(12,2);
  v_comision_ajustada  BOOLEAN := FALSE;
  -- Destino y pagos vía GUC transaccional (set_config(..., true) por el wrapper).
  v_destino            TEXT := COALESCE(NULLIF(btrim(COALESCE(current_setting('app.devolucion_destino', TRUE), '')), ''), 'saldo_a_favor');
  v_pagos_reembolso    JSONB := NULLIF(current_setting('app.devolucion_reembolso_pagos', TRUE), '')::JSONB;
  v_pago               RECORD;
  v_reembolso_total    NUMERIC(12,4) := 0;
  v_metodos_resumen    TEXT;
  v_refs_resumen       TEXT;
BEGIN
  IF p_despacho_id IS NULL
     OR p_total_devuelto_usd IS NULL OR p_total_intercambio_usd IS NULL
     OR p_total_devuelto_usd < 0 OR p_total_intercambio_usd < 0
     OR p_usuario_id IS NULL OR p_usuario_nombre IS NULL
     OR btrim(p_usuario_nombre) = '' THEN
    RAISE EXCEPTION 'PARAMETROS_FINANZAS_DEVOLUCION_INVALIDOS';
  END IF;

  IF v_destino NOT IN ('saldo_a_favor', 'reembolso') THEN
    RAISE EXCEPTION 'DESTINO_SALDO_INVALIDO';
  END IF;
  IF v_destino = 'reembolso' AND v_pagos_reembolso IS NULL THEN
    RAISE EXCEPTION 'REEMBOLSO_PAGOS_REQUERIDOS';
  END IF;

  SELECT *
  INTO v_despacho
  FROM public.notas_despacho
  WHERE id = p_despacho_id
  FOR UPDATE;

  IF NOT FOUND OR v_despacho.estado <> 'entregada' THEN
    RAISE EXCEPTION 'DESPACHO_FINANZAS_NO_DISPONIBLE';
  END IF;

  -- La operación de inventario ya redujo total_usd. Reconstruimos el valor
  -- anterior para prorratear únicamente la parte devuelta en esta llamada.
  v_total_nuevo := COALESCE(v_despacho.total_usd, 0);
  v_total_original := ROUND((v_total_nuevo
    + p_total_devuelto_usd - p_total_intercambio_usd)::NUMERIC, 4);
  IF v_total_original < 0 OR v_total_nuevo < 0 THEN
    RAISE EXCEPTION 'TOTAL_DEVOLUCION_INVALIDO';
  END IF;

  SELECT u.id
  INTO v_usuario_fk
  FROM public.usuarios u
  WHERE u.id = p_usuario_id AND u.activo = TRUE
    AND u.cuenta_id = v_despacho.cuenta_id
  LIMIT 1;
  IF v_usuario_fk IS NULL THEN
    SELECT u.id
    INTO v_usuario_fk
    FROM public.usuarios u
    WHERE u.activo = TRUE AND u.cuenta_id = v_despacho.cuenta_id
      AND u.rol IN ('supervisor', 'administracion', 'jefe', 'logistica', 'desarrollador')
    ORDER BY u.nombre, u.id
    LIMIT 1;
  END IF;
  IF v_usuario_fk IS NULL THEN RAISE EXCEPTION 'USUARIO_CXC_NO_ENCONTRADO'; END IF;

  IF COALESCE(v_despacho.cliente_factura_id, v_despacho.cliente_id) IS NOT NULL THEN
    SELECT *
    INTO v_cliente
    FROM public.clientes
    WHERE id = COALESCE(v_despacho.cliente_factura_id, v_despacho.cliente_id)
      AND cuenta_id = v_despacho.cuenta_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CLIENTE_CXC_NO_ENCONTRADO'; END IF;

    v_tiene_cliente := TRUE;
    v_saldo_pendiente := COALESCE(v_cliente.saldo_pendiente, 0);
    v_saldo_favor := COALESCE(v_cliente.saldo_a_favor, 0);
    v_balance_neto := ROUND((p_total_intercambio_usd - p_total_devuelto_usd)::NUMERIC, 4);

    IF v_balance_neto > 0 THEN
      v_cargo := v_balance_neto;
      INSERT INTO public.cuentas_por_cobrar (
        cliente_id, despacho_id, tipo, monto_usd, saldo_usd,
        descripcion, registrado_por, cuenta_id
      ) VALUES (
        v_cliente.id, p_despacho_id, 'cargo', v_cargo,
        ROUND((v_saldo_pendiente + v_cargo)::NUMERIC, 4),
        'Cargo por diferencia en intercambio — Despacho #' || v_despacho.numero,
        v_usuario_fk, v_despacho.cuenta_id
      );
    ELSIF v_balance_neto < 0 THEN
      IF v_destino = 'reembolso' THEN
        -- Semántica coherente de reembolso: el cliente recibe efectivo, la
        -- deuda NO se compensa. Todo el balance queda como crédito y se
        -- consume abajo con las filas devolucion_credito de esta misma
        -- transacción (saldo a favor neto ≈ 0 al cerrar).
        v_credito := ROUND(abs(v_balance_neto)::NUMERIC, 4);
        INSERT INTO public.cuentas_por_cobrar (
          cliente_id, despacho_id, tipo, monto_usd, saldo_usd,
          forma_pago_abono, referencia, descripcion, registrado_por, cuenta_id
        ) VALUES (
          v_cliente.id, p_despacho_id, 'credito', v_credito,
          GREATEST(0, ROUND(v_saldo_pendiente::NUMERIC, 4)),
          'Devolución', 'Despacho #' || v_despacho.numero,
          'Saldo a favor para reembolso — Despacho #' || v_despacho.numero,
          v_usuario_fk, v_despacho.cuenta_id
        );
      ELSE
        -- Comportamiento histórico: primero compensa la deuda del propio
        -- despacho; el excedente queda como crédito a favor.
        SELECT COALESCE(SUM(CASE
          WHEN c.tipo = 'cargo' THEN c.monto_usd
          WHEN c.tipo = 'abono' THEN -c.monto_usd
          ELSE 0
        END), 0)
        INTO v_cxc_despacho
        FROM public.cuentas_por_cobrar c
        WHERE c.despacho_id = p_despacho_id;

        v_cxc_despacho := GREATEST(0, v_cxc_despacho);
        v_abono := ROUND(LEAST(abs(v_balance_neto), v_cxc_despacho)::NUMERIC, 4);

        IF v_abono > 0 THEN
          INSERT INTO public.cuentas_por_cobrar (
            cliente_id, despacho_id, tipo, monto_usd, saldo_usd,
            forma_pago_abono, referencia, descripcion, registrado_por, cuenta_id
          ) VALUES (
            v_cliente.id, p_despacho_id, 'abono', v_abono,
            GREATEST(0, ROUND((v_saldo_pendiente - v_abono)::NUMERIC, 4)),
            'Devolución', 'Despacho #' || v_despacho.numero,
            'Abono por devolución/intercambio — Despacho #' || v_despacho.numero,
            v_usuario_fk, v_despacho.cuenta_id
          );
        END IF;

        v_credito := ROUND((abs(v_balance_neto) - v_abono)::NUMERIC, 4);
        IF v_credito > 0 THEN
          INSERT INTO public.cuentas_por_cobrar (
            cliente_id, despacho_id, tipo, monto_usd, saldo_usd,
            forma_pago_abono, referencia, descripcion, registrado_por, cuenta_id
          ) VALUES (
            v_cliente.id, p_despacho_id, 'credito', v_credito,
            GREATEST(0, ROUND((v_saldo_pendiente - v_abono)::NUMERIC, 4)),
            'Devolución', 'Despacho #' || v_despacho.numero,
            'Saldo a favor por excedente en intercambio — Despacho #' || v_despacho.numero,
            v_usuario_fk, v_despacho.cuenta_id
          );
        END IF;
      END IF;
    END IF;
  ELSE
    v_balance_neto := ROUND((p_total_intercambio_usd - p_total_devuelto_usd)::NUMERIC, 4);
  END IF;

  -- Las comisiones legacy se conservan intactas. Solo una fila creada con
  -- calculo_version = '238b' se recalcula con la política nueva.
  SELECT *
  INTO v_comision
  FROM public.comisiones c
  WHERE c.despachoid = p_despacho_id
  FOR UPDATE;

  IF FOUND AND v_comision.calculo_version = '238b' THEN
    IF v_comision.estado = 'pagada' OR COALESCE(v_comision.montopagado, 0) > 0.01 THEN
      RAISE EXCEPTION 'COMISION_YA_PAGADA: revierta el pago antes de registrar la devolución';
    END IF;

    -- Total de artículos netos = total cabecera menos flete, corte y descuento.
    v_base_original := GREATEST(0, ROUND((v_total_original
      - COALESCE(v_despacho.flete_usd, 0)
      - COALESCE(v_despacho.corte_usd, 0)
      - COALESCE(v_despacho.descuento_total_usd, 0))::NUMERIC, 4));
    v_base_nueva := GREATEST(0, ROUND((v_total_nuevo
      - COALESCE(v_despacho.flete_usd, 0)
      - COALESCE(v_despacho.corte_usd, 0)
      - COALESCE(v_despacho.descuento_total_usd, 0))::NUMERIC, 4));

    IF v_base_original > 0 THEN
      v_factor := v_base_nueva / v_base_original;
      v_comision_nueva := ROUND((COALESCE(v_comision.totalcomision, 0) * v_factor)::NUMERIC, 2);
      v_liberada := ROUND((COALESCE(v_comision.comision_liberada, v_comision.totalcomision) * v_factor)::NUMERIC, 2);
      v_liberada := LEAST(v_comision_nueva, GREATEST(0, v_liberada));
      v_retenida := ROUND((v_comision_nueva - v_liberada)::NUMERIC, 2);

      UPDATE public.comisiones
      SET totalcomision = v_comision_nueva,
          comisioncabilla = ROUND((COALESCE(comisioncabilla, 0) * v_factor)::NUMERIC, 2),
          comisionotros = ROUND((COALESCE(comisionotros, 0) * v_factor)::NUMERIC, 2),
          comision_liberada = v_liberada,
          comision_retenida = v_retenida,
          estado = CASE WHEN v_retenida > 0.01 THEN 'cta_cobrar' ELSE 'pendiente' END,
          actualizadoen = now()
      WHERE id = v_comision.id;
      v_comision_ajustada := TRUE;
    END IF;
  END IF;

  -- REEMBOLSO ATÓMICO: filas devolucion_credito + metadatos dentro de ESTA
  -- transacción. Sustituye los INSERT REST que hacía el Worker post-RPC.
  IF v_destino = 'reembolso' AND v_tiene_cliente
     AND v_pagos_reembolso IS NOT NULL AND v_pagos_reembolso <> 'null'::JSONB
     AND jsonb_typeof(v_pagos_reembolso) = 'array'
     AND jsonb_array_length(v_pagos_reembolso) > 0 THEN

    IF jsonb_array_length(v_pagos_reembolso) > 12 THEN
      RAISE EXCEPTION 'REEMBOLSO_DEMASIADOS_PAGOS';
    END IF;

    FOR v_pago IN
      SELECT * FROM jsonb_to_recordset(v_pagos_reembolso) AS x(
        metodo TEXT, monto NUMERIC, referencia TEXT
      )
    LOOP
      IF v_pago.metodo IS NULL OR btrim(v_pago.metodo) = ''
         OR v_pago.metodo NOT IN ('Efectivo $', 'Efectivo Bs', 'Zelle', 'Transf. / Pago Móvil', 'Punto de Venta', 'USDT') THEN
        RAISE EXCEPTION 'REEMBOLSO_METODO_INVALIDO';
      END IF;
      IF v_pago.monto IS NULL OR v_pago.monto <= 0 THEN
        RAISE EXCEPTION 'REEMBOLSO_MONTO_INVALIDO';
      END IF;
      IF v_pago.metodo IN ('Transf. / Pago Móvil', 'Zelle', 'USDT')
         AND (v_pago.referencia IS NULL OR btrim(v_pago.referencia) = '') THEN
        RAISE EXCEPTION 'REEMBOLSO_REFERENCIA_OBLIGATORIA';
      END IF;
    END LOOP;

    SELECT COALESCE(SUM(x.monto), 0) INTO v_reembolso_total
    FROM jsonb_to_recordset(v_pagos_reembolso) AS x(monto NUMERIC);
    v_reembolso_total := ROUND(v_reembolso_total::NUMERIC, 4);
    IF v_reembolso_total > abs(v_balance_neto) + 0.01 THEN
      RAISE EXCEPTION 'REEMBOLSO_SUPERA_SALDO_A_FAVOR';
    END IF;

    FOR v_pago IN
      SELECT * FROM jsonb_to_recordset(v_pagos_reembolso) AS x(
        metodo TEXT, monto NUMERIC, referencia TEXT
      )
    LOOP
      INSERT INTO public.cuentas_por_cobrar (
        cliente_id, despacho_id, tipo, monto_usd, saldo_usd,
        forma_pago_abono, referencia, descripcion, registrado_por, cuenta_id
      ) VALUES (
        v_cliente.id, p_despacho_id, 'devolucion_credito', ROUND(v_pago.monto::NUMERIC, 4),
        0,
        v_pago.metodo,
        COALESCE(NULLIF(btrim(COALESCE(v_pago.referencia, '')), ''), 'Despacho #' || v_despacho.numero),
        'Reembolso por devolución entregado al cliente — Despacho #' || v_despacho.numero || ' (' || v_pago.metodo || ')',
        v_usuario_fk, v_despacho.cuenta_id
      );
      v_metodos_resumen := concat_ws(' | ', v_metodos_resumen,
        v_pago.metodo || ': $' || to_char(ROUND(v_pago.monto::NUMERIC, 2), 'FM999999990.00'));
      v_refs_resumen := concat_ws(' | ', v_refs_resumen,
        NULLIF(btrim(COALESCE(v_pago.referencia, '')), ''));
    END LOOP;

    -- Metadatos de reembolso en los documentos de devolución (antes: PATCH
    -- REST del Worker, fuera de la transacción).
    UPDATE public.despacho_devoluciones
    SET destino_saldo = 'reembolso',
        reembolso_metodo = COALESCE(NULLIF(v_metodos_resumen, ''), 'Efectivo $'),
        reembolso_referencia = NULLIF(v_refs_resumen, ''),
        reembolso_monto = v_reembolso_total
    WHERE despacho_id = p_despacho_id;
  END IF;

  IF v_tiene_cliente THEN
    SELECT COALESCE(SUM(CASE
      WHEN c.tipo = 'cargo' THEN c.monto_usd
      WHEN c.tipo = 'abono' THEN -c.monto_usd
      ELSE 0 END), 0),
      COALESCE(SUM(CASE
        WHEN c.tipo = 'credito' THEN c.monto_usd
        WHEN c.tipo = 'abono' AND c.forma_pago_abono = 'Saldo a favor' THEN -c.monto_usd
        WHEN c.tipo = 'devolucion_credito' THEN -c.monto_usd
        ELSE 0 END), 0)
    INTO v_saldo_pendiente, v_saldo_favor
    FROM public.cuentas_por_cobrar c
    WHERE c.cliente_id = v_cliente.id;

    UPDATE public.clientes
    SET saldo_pendiente = GREATEST(0, ROUND(v_saldo_pendiente::NUMERIC, 4)),
        saldo_a_favor = GREATEST(0, ROUND(v_saldo_favor::NUMERIC, 4))
    WHERE id = v_cliente.id;
  END IF;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'balance_neto_usd', v_balance_neto,
    'cargo_monto', v_cargo,
    'abono_monto', v_abono,
    'credito_monto', v_credito,
    'destino_saldo', v_destino,
    'reembolso_total', v_reembolso_total,
    'comision_ajustada', v_comision_ajustada,
    'comision_base_original', v_base_original,
    'comision_base_nueva', v_base_nueva
  );
END
$function$;

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

  -- Mismo cierre que 03/04: los triggers mantienen los saldos denormalizados;
  -- se recalculan bajo el mismo bloqueo para dejarlo explícito.
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
$function$;

