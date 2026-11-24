-- 301_cxc_reparto_devoluciones.sql — PRODUCCIÓN (proyecto oyfyuszgjwcepjpngclv)
-- OP-2026-059: versión para producción de la migración de staging 300_staging_cxc_reparto_devoluciones.sql (OP-2026-042).
-- PREPARADA, NO APLICADA. Aplicar solo con aprobación del dueño y en el orden de
-- docs/operaciones/OP-2026-059_paso-a-produccion-cxc.md. Reversa: 301_cxc_reparto_devoluciones_rollback.sql
--
-- DIFERENCIA IMPORTANTE CON STAGING: en producción la devolución NO pasa por
-- ajustar_finanzas_devolucion_atomica (eso es solo de staging), sino por
--   registrar_devolucion_parcial_cobro_idempotente -> registrar_devolucion_parcial_idempotente
--   -> ajustar_finanzas_devolucion_neta.
-- Por eso aquí se modifica ajustar_finanzas_devolucion_neta, partiendo de su definición ACTUAL en
-- producción (bajada el 2026-11-24 en solo lectura), con los mismos 4 cambios que staging hizo en _atomica:
--   1) variables v_anular_id / v_abono_anular / v_abono_anulado;
--   2) error si se pide anular un abono con destino "reembolso";
--   3) rama "saldo a favor": anular el abono confirmado y calcular lo pendiente del despacho con
--      cxc_pendiente_despacho (mismo reparto que la pantalla);
--   4) devolver 'abono_anulado' en el resultado.
-- registrar_devolucion_parcial_cobro_idempotente: cuerpo ACTUAL de producción + parámetro opcional
-- p_anular_abono_id. Permisos: SOLO service_role, igual que hoy en producción (staging lo abrió a anon y
-- authenticated; eso NO se copia).
-- ajustar_finanzas_devolucion_atomica NO se toca en producción (ninguna ruta la usa).
--
-- ── Texto de staging, adaptado (nombres sin "_staging") ──

BEGIN;

CREATE OR REPLACE FUNCTION public.cxc_reparto_cliente(p_cliente_id uuid)
 RETURNS TABLE(cargo_id uuid, despacho_id uuid, monto numeric, pendiente numeric)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c_id    UUID[]    := ARRAY[]::UUID[];
  c_desp  UUID[]    := ARRAY[]::UUID[];
  c_monto NUMERIC[] := ARRAY[]::NUMERIC[];
  c_pend  NUMERIC[] := ARRAY[]::NUMERIC[];
  a_desp  UUID[]    := ARRAY[]::UUID[];
  a_rest  NUMERIC[] := ARRAY[]::NUMERIC[];
  r RECORD;
  i INT; j INT; nc INT; na INT;
  v_aplicar NUMERIC;
BEGIN
  FOR r IN
    SELECT x.id, x.tipo, x.despacho_id AS desp, x.monto_usd
    FROM public.cuentas_por_cobrar x
    WHERE x.cliente_id = p_cliente_id AND x.tipo IN ('cargo', 'abono')
    ORDER BY x.creado_en, x.id
  LOOP
    IF r.tipo = 'cargo' THEN
      c_id := c_id || r.id;
      c_desp := c_desp || r.desp;
      c_monto := c_monto || ROUND(r.monto_usd, 4);
      c_pend := c_pend || ROUND(r.monto_usd, 4);
    ELSE
      a_desp := a_desp || r.desp;
      a_rest := a_rest || ROUND(r.monto_usd, 4);
    END IF;
  END LOOP;
  nc := COALESCE(array_length(c_id, 1), 0);
  na := COALESCE(array_length(a_rest, 1), 0);

  -- Fase 1: abono enlazado -> primer cargo de su despacho
  FOR i IN 1..na LOOP
    IF a_desp[i] IS NOT NULL THEN
      FOR j IN 1..nc LOOP
        IF c_desp[j] = a_desp[i] THEN
          IF c_pend[j] > 0 THEN
            v_aplicar := LEAST(c_pend[j], a_rest[i]);
            c_pend[j] := ROUND(c_pend[j] - v_aplicar, 4);
            a_rest[i] := ROUND(a_rest[i] - v_aplicar, 4);
          END IF;
          EXIT;
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  -- Fase 2: lo que sobra, del cargo mas viejo al mas nuevo
  FOR i IN 1..na LOOP
    IF a_rest[i] > 0 THEN
      FOR j IN 1..nc LOOP
        IF c_pend[j] > 0 THEN
          v_aplicar := LEAST(c_pend[j], a_rest[i]);
          c_pend[j] := ROUND(c_pend[j] - v_aplicar, 4);
          a_rest[i] := ROUND(a_rest[i] - v_aplicar, 4);
        END IF;
        EXIT WHEN a_rest[i] <= 0;
      END LOOP;
    END IF;
  END LOOP;

  FOR j IN 1..nc LOOP
    cargo_id := c_id[j];
    despacho_id := c_desp[j];
    monto := c_monto[j];
    pendiente := c_pend[j];
    RETURN NEXT;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cxc_pendiente_despacho(p_cliente_id uuid, p_despacho_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(ROUND(SUM(r.pendiente), 4), 0)
  FROM public.cxc_reparto_cliente(p_cliente_id) r
  WHERE r.despacho_id = p_despacho_id;
$function$;

REVOKE ALL ON FUNCTION public.cxc_reparto_cliente(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cxc_pendiente_despacho(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cxc_reparto_cliente(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.cxc_pendiente_despacho(uuid, uuid) TO service_role;

-- Vista de pagos de mas: respeta las reglas de acceso de quien consulta (security_invoker).
CREATE OR REPLACE VIEW public.v_cxc_pagado_de_mas
WITH (security_invoker = true) AS
SELECT x.cliente_id,
       ROUND(SUM(CASE WHEN x.tipo = 'cargo' THEN x.monto_usd ELSE 0 END), 2) AS cargos_usd,
       ROUND(SUM(CASE WHEN x.tipo = 'abono' THEN x.monto_usd ELSE 0 END), 2) AS abonos_usd,
       ROUND(SUM(CASE WHEN x.tipo = 'abono' THEN x.monto_usd WHEN x.tipo = 'cargo' THEN -x.monto_usd ELSE 0 END), 2) AS pagado_de_mas_usd
FROM public.cuentas_por_cobrar x
WHERE x.tipo IN ('cargo', 'abono')
GROUP BY x.cliente_id
HAVING SUM(CASE WHEN x.tipo = 'abono' THEN x.monto_usd WHEN x.tipo = 'cargo' THEN -x.monto_usd ELSE 0 END) > 0.005;

REVOKE ALL ON public.v_cxc_pagado_de_mas FROM anon;
GRANT SELECT ON public.v_cxc_pagado_de_mas TO authenticated, service_role;

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
  -- OP-2026-042: abono manual que el operador confirma que era esta misma devolución
  v_anular_id          UUID := NULLIF(btrim(COALESCE(current_setting('app.devolucion_anular_abono', TRUE), '')), '')::UUID;
  v_abono_anular       RECORD;
  v_abono_anulado      JSONB := NULL;
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
  IF v_anular_id IS NOT NULL AND v_destino <> 'saldo_a_favor' THEN
    RAISE EXCEPTION 'ANULAR_ABONO_SOLO_CON_SALDO_A_FAVOR';
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
        -- OP-2026-042 (falla G1): si el operador confirmó que un abono manual
        -- (p. ej. un "Cruce") era esta misma devolución, se anula aquí, dentro
        -- de la misma operación, para no cancelar dos veces el mismo crédito.
        IF v_anular_id IS NOT NULL THEN
          SELECT * INTO v_abono_anular
          FROM public.cuentas_por_cobrar
          WHERE id = v_anular_id AND cliente_id = v_cliente.id AND tipo = 'abono'
          FOR UPDATE;
          IF NOT FOUND THEN
            RAISE EXCEPTION 'ABONO_A_ANULAR_INVALIDO';
          END IF;
          IF v_abono_anular.despacho_id IS NOT NULL AND v_abono_anular.despacho_id <> p_despacho_id THEN
            RAISE EXCEPTION 'ABONO_A_ANULAR_ES_DE_OTRO_DESPACHO';
          END IF;
          IF COALESCE(v_abono_anular.forma_pago_abono, '') IN ('Devolución', 'Saldo a favor') THEN
            RAISE EXCEPTION 'ABONO_A_ANULAR_NO_PERMITIDO';
          END IF;
          v_abono_anulado := to_jsonb(v_abono_anular);
          DELETE FROM public.cuentas_por_cobrar WHERE id = v_anular_id;
        END IF;

        -- OP-2026-042 (falla G1): lo pendiente del despacho se calcula con el
        -- MISMO reparto que la pantalla de CxC (abonos enlazados primero y luego
        -- los sueltos del más viejo al más nuevo). Antes solo se miraban los
        -- abonos enlazados y una devolución podía descontar dos veces.
        v_cxc_despacho := GREATEST(0, public.cxc_pendiente_despacho(v_cliente.id, p_despacho_id));
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
        WHEN c.tipo = 'consumo_credito' THEN -c.monto_usd
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
    'abono_anulado', v_abono_anulado,
    'comision_base_original', v_base_original,
    'comision_base_nueva', v_base_nueva
  );
END
$function$;

REVOKE ALL ON FUNCTION public.ajustar_finanzas_devolucion_neta(uuid, numeric, numeric, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ajustar_finanzas_devolucion_neta(uuid, numeric, numeric, uuid, text) TO service_role;

DROP FUNCTION IF EXISTS public.registrar_devolucion_parcial_cobro_idempotente(uuid,uuid,uuid,jsonb,jsonb,text,uuid,text,text,uuid,numeric,numeric,jsonb,jsonb,text,jsonb);

CREATE OR REPLACE FUNCTION public.registrar_devolucion_parcial_cobro_idempotente(p_cuenta_id uuid, p_despacho_id uuid, p_idempotency_key uuid, p_devoluciones jsonb, p_intercambios jsonb DEFAULT '[]'::jsonb, p_motivo text DEFAULT NULL::text, p_usuario_id uuid DEFAULT NULL::uuid, p_usuario_nombre text DEFAULT NULL::text, p_usuario_color text DEFAULT NULL::text, p_cotizacion_reemplazo_id uuid DEFAULT NULL::uuid, p_total_devuelto_usd numeric DEFAULT 0, p_total_intercambio_usd numeric DEFAULT 0, p_reemplazo jsonb DEFAULT NULL::jsonb, p_pagos_diferencia jsonb DEFAULT NULL::jsonb, p_destino_saldo text DEFAULT 'saldo_a_favor'::text, p_pagos_reembolso jsonb DEFAULT NULL::jsonb, p_anular_abono_id uuid DEFAULT NULL::uuid)
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
  -- OP-2026-042: abono manual que el operador confirmó que era esta devolución (lo anula _neta)
  PERFORM set_config('app.devolucion_anular_abono', COALESCE(p_anular_abono_id::TEXT, ''), TRUE);
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
$function$;

REVOKE ALL ON FUNCTION public.registrar_devolucion_parcial_cobro_idempotente(uuid,uuid,uuid,jsonb,jsonb,text,uuid,text,text,uuid,numeric,numeric,jsonb,jsonb,text,jsonb,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_devolucion_parcial_cobro_idempotente(uuid,uuid,uuid,jsonb,jsonb,text,uuid,text,text,uuid,numeric,numeric,jsonb,jsonb,text,jsonb,uuid) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
