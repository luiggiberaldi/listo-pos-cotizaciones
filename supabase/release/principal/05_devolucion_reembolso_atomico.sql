-- 05_devolucion_reembolso_atomico.sql
-- Release principal — Fase 3 del plan de devoluciones CxC (2026-09-04).
--
-- Problema que corrige:
--   1. El reembolso en efectivo (filas devolucion_credito + metadatos en
--      despacho_devoluciones) lo insertaba el Worker DESPUÉS de la transacción
--      atómica: un fallo dejaba saldo a favor nunca pagado en efectivo.
--   2. Semántica incoherente: con destino 'reembolso' la RPC compensaba la
--      deuda del despacho (abono) Y el Worker pagaba efectivo — doble beneficio.
--
-- Qué hace:
--   * ajustar_finanzas_devolucion_neta se reemplaza IN-PLACE (misma identidad
--     de 5 argumentos, sin sobrecargas) y lee dos GUC transaccionales:
--       app.devolucion_destino         ('saldo_a_favor' | 'reembolso')
--       app.devolucion_reembolso_pagos (JSONB con los pagos del reembolso)
--     Sin GUC el comportamiento es idéntico al actual (compatibilidad total
--     con los llamadores existentes). Se usan GUC en vez de parámetros nuevos
--     para evitar el problema de resolución de overloads (lección 42725 ya
--     documentada en BITACORA): el wrapper intermedio llama con 5 args y
--     seguiría resolviendo a la firma vieja si cambiáramos la identidad.
--   * destino 'reembolso': NO compensa deuda; crea 'credito' por el total y
--     lo consume con filas 'devolucion_credito' DENTRO de la misma
--     transacción, además de persistir los metadatos de reembolso.
--   * registrar_devolucion_parcial_cobro_idempotente pasa de 14 a 16
--     parámetros (DROP + CREATE, definición única): p_destino_saldo y
--     p_pagos_reembolso opcionales. Fija los GUC (locales a la transacción)
--     antes de delegar en la RPC profunda de 13 argumentos.
--
-- Rollback: 05_devolucion_reembolso_atomico_rollback.sql

BEGIN;

-- Precondiciones: columnas de metadatos de reembolso (migración 134) y wrapper 14 args (release 02).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'despacho_devoluciones'
      AND column_name IN ('destino_saldo', 'reembolso_metodo', 'reembolso_referencia', 'reembolso_monto')
    GROUP BY table_schema, table_name
    HAVING count(*) = 4
  ) THEN
    RAISE EXCEPTION 'PRECONDICION_FALTANTE: columnas de reembolso ausentes en despacho_devoluciones (migracion 134)';
  END IF;

  IF to_regprocedure('public.registrar_devolucion_parcial_cobro_idempotente(UUID, UUID, UUID, JSONB, JSONB, TEXT, UUID, TEXT, TEXT, UUID, NUMERIC, NUMERIC, JSONB, JSONB)') IS NULL THEN
    RAISE EXCEPTION 'PRECONDICION_FALTANTE: falta registrar_devolucion_parcial_cobro_idempotente de 14 parámetros (release 02)';
  END IF;

  IF to_regprocedure('public.ajustar_finanzas_devolucion_neta(UUID, NUMERIC, NUMERIC, UUID, TEXT)') IS NULL THEN
    RAISE EXCEPTION 'PRECONDICION_FALTANTE: falta ajustar_finanzas_devolucion_neta de 5 parámetros (release/main/03)';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 1) Finanzas de devolución destino-aware. MISMA identidad (5 args): la
--    resolución de llamadas existentes no cambia. El destino llega por GUC
--    transaccional fijado por el wrapper (ver abajo); sin GUC el flujo es el
--    histórico byte-a-byte.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ajustar_finanzas_devolucion_neta(
  p_despacho_id           UUID,
  p_total_devuelto_usd    NUMERIC,
  p_total_intercambio_usd NUMERIC,
  p_usuario_id            UUID,
  p_usuario_nombre        TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

-- ---------------------------------------------------------------------------
-- 2) Wrapper de 16 parámetros. DROP + CREATE (definición única, sin
--    overloads): los 2 parámetros nuevos tienen default, así que un Worker
--    viejo que envíe 14 argumentos nombrados también resuelve aquí y obtiene
--    el comportamiento histórico. Fija los GUC con is_local = true para que
--    vivan solo dentro de esta transacción.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.registrar_devolucion_parcial_cobro_idempotente(
  UUID, UUID, UUID, JSONB, JSONB, TEXT, UUID, TEXT, TEXT, UUID, NUMERIC, NUMERIC, JSONB, JSONB
);

CREATE FUNCTION public.registrar_devolucion_parcial_cobro_idempotente(
  p_cuenta_id                UUID,
  p_despacho_id              UUID,
  p_idempotency_key          UUID,
  p_devoluciones             JSONB,
  p_intercambios             JSONB DEFAULT '[]'::JSONB,
  p_motivo                   TEXT DEFAULT NULL,
  p_usuario_id               UUID DEFAULT NULL,
  p_usuario_nombre           TEXT DEFAULT NULL,
  p_usuario_color            TEXT DEFAULT NULL,
  p_cotizacion_reemplazo_id  UUID DEFAULT NULL,
  p_total_devuelto_usd       NUMERIC DEFAULT 0,
  p_total_intercambio_usd    NUMERIC DEFAULT 0,
  p_reemplazo                JSONB DEFAULT NULL,
  p_pagos_diferencia         JSONB DEFAULT NULL,
  p_destino_saldo            TEXT DEFAULT 'saldo_a_favor',
  p_pagos_reembolso          JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.registrar_devolucion_parcial_cobro_idempotente(UUID, UUID, UUID, JSONB, JSONB, TEXT, UUID, TEXT, TEXT, UUID, NUMERIC, NUMERIC, JSONB, JSONB, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.registrar_devolucion_parcial_cobro_idempotente(UUID, UUID, UUID, JSONB, JSONB, TEXT, UUID, TEXT, TEXT, UUID, NUMERIC, NUMERIC, JSONB, JSONB, TEXT, JSONB)
  TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
