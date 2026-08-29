-- 03_comision_split_cliente_ajeno_rollback.sql
-- Proyecto principal — Rollback del release 03 (split por cliente ajeno).
--
-- Restaura el estado pre-03: cuerpos exactos de las funciones (capturados de
-- pg_get_functiondef antes de aplicar el cambio), índice único original
-- ux_comisiones_despachoid_238a y columnas de configuración eliminadas.
-- Las filas split NO pagadas se eliminan y regeneran con la lógica anterior
-- vía recalcularcomisiondespacho_238b; si existe CUALQUIER fila split pagada
-- el rollback aborta para resolución manual.
--
-- SAFETY GATE: igual que el release, solo se ejecuta en ventana autorizada.

BEGIN;

DO $$
BEGIN
  RAISE EXCEPTION 'REVIEW_ONLY: 03_comision_split_cliente_ajeno_rollback.sql no debe ejecutarse todavía';
END
$$;

-- Despachos afectados por el split (según evidencia de cálculo)
CREATE TEMP TABLE _split_despachos AS
  SELECT DISTINCT despachoid
  FROM public.comisiones
  WHERE calculo_evidencia->>'split_cliente_ajeno' = 'true';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.comisiones c
    JOIN _split_despachos d ON d.despachoid = c.despachoid
    WHERE c.estado = 'pagada' OR COALESCE(c.montopagado, 0) > 0.01
  ) THEN
    RAISE EXCEPTION 'ROLLBACK_BLOQUEADO: existen comisiones split pagadas — resolución manual requerida';
  END IF;
END
$$;

-- 1) Restaurar cuerpos pre-03 (idénticos a los dumpeados antes del cambio)

-- === calcularcomisiondespacho_238b (pre-split) ===
CREATE OR REPLACE FUNCTION public.calcularcomisiondespacho_238b(p_despachoid uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_despacho RECORD;
  v_cfg RECORD;
  v_item RECORD;
  v_breakdown JSONB;
  v_payment JSONB;
  v_extra_details JSONB := '[]'::jsonb;
  v_existing UUID;
  v_comision_id UUID;
  v_has_dispatch_items BOOLEAN;
  v_pct_cabilla NUMERIC := 0;
  v_pct_otros NUMERIC := 0;
  v_pct_externos NUMERIC := 0;
  v_cat_cabilla TEXT := 'cabilla';
  v_extras JSONB := '[]'::jsonb;
  v_base_cabilla NUMERIC := 0;
  v_base_otros NUMERIC := 0;
  v_base_externos NUMERIC := 0;
  v_raw_extras NUMERIC := 0;
  v_excluded_commission NUMERIC := 0;
  v_comision_cabilla NUMERIC := 0;
  v_comision_otros NUMERIC := 0;
  v_comision_extras NUMERIC := 0;
  v_raw_total NUMERIC := 0;
  v_total NUMERIC := 0;
  v_fraction NUMERIC := 1;
  v_cxc_excluded NUMERIC := 0;
  v_payment_excluded_commission NUMERIC := 0;
  v_extra_commission NUMERIC;
  v_idx INTEGER;
BEGIN
  IF p_despachoid IS NULL THEN
    RAISE EXCEPTION 'DESPACHO_ID_REQUERIDO';
  END IF;

  SELECT nd.id, nd.cotizacion_id, nd.cuenta_id, nd.estado, nd.cliente_id,
         nd.vendedor_id, nd.total_usd, nd.forma_pago, nd.forma_pago_cliente,
         COALESCE(cl.vendedor_id, nd.vendedor_id) AS vendedor_comision_id,
         u.rol AS vendedor_rol, u.es_externo AS vendedor_es_externo,
         u.markup_pct AS vendedor_markup_pct,
         u.comision_pct AS vendedor_comision_pct,
         u.comision_pct_cabilla AS vendedor_comision_pct_cabilla
  INTO v_despacho
  FROM public.notas_despacho nd
  LEFT JOIN public.clientes cl ON cl.id = nd.cliente_id
  LEFT JOIN public.usuarios u ON u.id = COALESCE(cl.vendedor_id, nd.vendedor_id)
  WHERE nd.id = p_despachoid;

  IF NOT FOUND THEN RAISE EXCEPTION 'DESPACHO_NO_ENCONTRADO'; END IF;
  IF v_despacho.cuenta_id IS NULL THEN RAISE EXCEPTION 'CUENTA_ID_REQUERIDO'; END IF;
  IF v_despacho.vendedor_comision_id IS NULL THEN RETURN NULL; END IF;
  IF v_despacho.estado NOT IN ('despachada', 'entregada') THEN RETURN NULL; END IF;

  SELECT c.id INTO v_existing
  FROM public.comisiones c
  WHERE c.despachoid = p_despachoid
    AND c.cuentaid = v_despacho.cuenta_id
  FOR UPDATE;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  IF v_despacho.vendedor_rol IN ('admin', 'jefe', 'logistica', 'administracion', 'desarrollador')
     OR (v_despacho.vendedor_rol = 'vendedor_sin_comision'
         AND NOT COALESCE(v_despacho.vendedor_es_externo, FALSE)
         AND COALESCE(v_despacho.vendedor_markup_pct, 0) <= 0) THEN
    RETURN NULL;
  END IF;

  SELECT cn.* INTO v_cfg
  FROM public.configuracion_negocio cn
  WHERE cn.cuenta_id = v_despacho.cuenta_id OR cn.id = 1
  ORDER BY CASE WHEN cn.cuenta_id = v_despacho.cuenta_id THEN 0 ELSE 1 END
  LIMIT 1;

  IF FOUND THEN
    v_cat_cabilla := lower(trim(COALESCE(v_cfg.comision_categoria_cabilla, 'cabilla')));
    IF COALESCE(v_despacho.vendedor_es_externo, FALSE) THEN
      v_pct_cabilla := COALESCE(v_cfg.comision_ext_pct_cabilla, 2);
      v_pct_otros := COALESCE(v_cfg.comision_ext_pct_otros, 3);
      v_pct_externos := COALESCE(v_cfg.comision_ext_pct_externos, 3);
      v_extras := COALESCE(v_cfg._comision_ext_extras, '[]'::jsonb);
    ELSE
      v_pct_cabilla := COALESCE(v_despacho.vendedor_comision_pct_cabilla,
        v_cfg.comision_pct_cabilla, 2);
      v_pct_otros := COALESCE(v_despacho.vendedor_comision_pct,
        v_cfg.comision_pct_otros, 3);
      v_pct_externos := COALESCE(v_cfg.comision_pct_externos, v_pct_otros, 3);
      v_extras := COALESCE(v_cfg._comision_extras, '[]'::jsonb);
    END IF;
  END IF;

  IF v_despacho.vendedor_rol = 'vendedor_sin_comision'
     AND NOT COALESCE(v_despacho.vendedor_es_externo, FALSE) THEN
    v_pct_cabilla := 0;
    v_pct_otros := 0;
    v_pct_externos := 0;
  END IF;

  IF jsonb_typeof(v_extras) = 'string'
     AND pg_input_is_valid(v_extras #>> '{}', 'jsonb') THEN
    v_extras := (v_extras #>> '{}')::jsonb;
  END IF;
  IF jsonb_typeof(v_extras) <> 'array' THEN v_extras := '[]'::jsonb; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'cat', elem->>'cat',
    'pct', CASE WHEN COALESCE(elem->>'pct', '') ~ '^-?[0-9]+([.][0-9]+)?$'
      THEN (elem->>'pct')::numeric ELSE v_pct_otros END,
    'monto', 0, 'comision', 0
  )), '[]'::jsonb)
  INTO v_extra_details
  FROM jsonb_array_elements(v_extras) AS elem;

  v_payment := public.comision_238b_pago_split(
    v_despacho.total_usd, v_despacho.forma_pago_cliente, v_despacho.forma_pago
  );
  IF COALESCE((v_payment->>'requires_manual_review')::boolean, FALSE) THEN
    RETURN NULL;
  END IF;
  v_fraction := COALESCE((v_payment->>'fraction')::numeric, 1);

  SELECT EXISTS (
    SELECT 1 FROM public.notas_despacho_items ndi
    WHERE ndi.despacho_id = p_despachoid
  ) INTO v_has_dispatch_items;

  IF v_has_dispatch_items THEN
    FOR v_item IN
      SELECT ndi.total_linea_usd AS value_usd,
             COALESCE(p.categoria, '') AS categoria,
             ndi.nombre_snap AS nombre,
             ndi.origen,
             COALESCE(ndi.es_prestamo, FALSE) AS es_prestamo
      FROM public.notas_despacho_items ndi
      LEFT JOIN public.productos p ON p.id = ndi.producto_id
      WHERE ndi.despacho_id = p_despachoid
    LOOP
      v_breakdown := public.comision_238b_item_breakdown(
        v_item.value_usd, v_item.categoria, v_item.nombre, v_item.origen,
        v_item.es_prestamo, COALESCE(v_despacho.vendedor_es_externo, FALSE),
        v_cat_cabilla, v_pct_cabilla, v_pct_otros, v_pct_externos, v_extras
      );
      IF COALESCE((v_breakdown->>'excluded')::boolean, FALSE) THEN
        v_excluded_commission := v_excluded_commission
          + COALESCE((v_breakdown->>'commission_excluded')::numeric, 0);
        CONTINUE;
      END IF;
      IF v_breakdown->>'bucket' = 'cabilla' THEN
        v_base_cabilla := v_base_cabilla + (v_breakdown->>'value_usd')::numeric;
      ELSIF v_breakdown->>'bucket' = 'externo' THEN
        v_base_externos := v_base_externos + (v_breakdown->>'value_usd')::numeric;
      ELSIF v_breakdown->>'bucket' = 'extra' THEN
        v_raw_extras := v_raw_extras + (v_breakdown->>'commission')::numeric;
        SELECT COALESCE(jsonb_agg(CASE
          WHEN lower(trim(COALESCE(elem->>'cat', ''))) = lower(trim(v_breakdown->>'category'))
          THEN elem || jsonb_build_object(
            'monto', COALESCE((elem->>'monto')::numeric, 0) + (v_breakdown->>'value_usd')::numeric,
            'comision', COALESCE((elem->>'comision')::numeric, 0) + (v_breakdown->>'commission')::numeric
          ) ELSE elem END), '[]'::jsonb)
        INTO v_extra_details FROM jsonb_array_elements(v_extra_details) AS elem;
      ELSE
        v_base_otros := v_base_otros + (v_breakdown->>'value_usd')::numeric;
      END IF;
    END LOOP;
  ELSE
    FOR v_item IN
      SELECT GREATEST(COALESCE(ci.total_linea_usd, 0) - COALESCE(dd.monto_usd, 0), 0) AS value_usd,
             COALESCE(p.categoria, '') AS categoria,
             ci.nombre_snap AS nombre,
             ci.origen,
             FALSE AS es_prestamo
      FROM public.cotizacion_items ci
      LEFT JOIN public.productos p ON p.id = ci.producto_id
      LEFT JOIN public.despacho_descuentos dd
        ON dd.despacho_id = p_despachoid AND dd.cotizacion_item_id = ci.id
      WHERE ci.cotizacion_id = v_despacho.cotizacion_id
    LOOP
      v_breakdown := public.comision_238b_item_breakdown(
        v_item.value_usd, v_item.categoria, v_item.nombre, v_item.origen,
        v_item.es_prestamo, COALESCE(v_despacho.vendedor_es_externo, FALSE),
        v_cat_cabilla, v_pct_cabilla, v_pct_otros, v_pct_externos, v_extras
      );
      IF COALESCE((v_breakdown->>'excluded')::boolean, FALSE) THEN
        v_excluded_commission := v_excluded_commission
          + COALESCE((v_breakdown->>'commission_excluded')::numeric, 0);
        CONTINUE;
      END IF;
      IF v_breakdown->>'bucket' = 'cabilla' THEN
        v_base_cabilla := v_base_cabilla + (v_breakdown->>'value_usd')::numeric;
      ELSIF v_breakdown->>'bucket' = 'externo' THEN
        v_base_externos := v_base_externos + (v_breakdown->>'value_usd')::numeric;
      ELSIF v_breakdown->>'bucket' = 'extra' THEN
        v_raw_extras := v_raw_extras + (v_breakdown->>'commission')::numeric;
        SELECT COALESCE(jsonb_agg(CASE
          WHEN lower(trim(COALESCE(elem->>'cat', ''))) = lower(trim(v_breakdown->>'category'))
          THEN elem || jsonb_build_object(
            'monto', COALESCE((elem->>'monto')::numeric, 0) + (v_breakdown->>'value_usd')::numeric,
            'comision', COALESCE((elem->>'comision')::numeric, 0) + (v_breakdown->>'commission')::numeric
          ) ELSE elem END), '[]'::jsonb)
        INTO v_extra_details FROM jsonb_array_elements(v_extra_details) AS elem;
      ELSE
        v_base_otros := v_base_otros + (v_breakdown->>'value_usd')::numeric;
      END IF;
    END LOOP;
  END IF;

  v_comision_cabilla := round(v_base_cabilla * v_pct_cabilla / 100 * v_fraction, 2);
  v_comision_otros := round((v_base_otros * v_pct_otros / 100
    + v_base_externos * v_pct_externos / 100) * v_fraction, 2);
  v_raw_total := round(v_base_cabilla * v_pct_cabilla / 100
    + v_base_otros * v_pct_otros / 100
    + v_base_externos * v_pct_externos / 100 + v_raw_extras, 2);

  IF jsonb_array_length(v_extra_details) > 0 THEN
    FOR v_idx IN 0 .. jsonb_array_length(v_extra_details) - 1 LOOP
    v_extra_commission := round(
      COALESCE((v_extra_details->v_idx->>'comision')::numeric, 0) * v_fraction, 2
    );
    v_extra_details := jsonb_set(
      v_extra_details, ARRAY[v_idx::text, 'comision'], to_jsonb(v_extra_commission)
    );
    v_comision_extras := v_comision_extras + v_extra_commission;
    END LOOP;
  END IF;

  v_total := round(v_comision_cabilla + v_comision_otros + v_comision_extras, 2);
  v_payment_excluded_commission := CASE
    WHEN COALESCE((v_payment->>'excluded_by_payment')::boolean, FALSE)
      THEN round(v_raw_total, 2)
    ELSE 0
  END;
  v_cxc_excluded := CASE
    WHEN v_payment_excluded_commission > 0 THEN 0
    ELSE round(v_raw_total * (1 - v_fraction), 2)
  END;

  INSERT INTO public.comisiones (
    despachoid, vendedorid, cotizacionid, cuentaid,
    totalcomision, comisioncabilla, comisionotros, pctcabilla, pctotros,
    estado, comision_liberada, comision_retenida,
    detalle_extras, comision_cxc_excluida, comision_pago_excluida,
    comision_otras_exclusiones, fraccion_no_cxc, calculo_version,
    politica_comision, fuente_calculo,
    calculo_evidencia, creadoen, actualizadoen
  ) VALUES (
    p_despachoid, v_despacho.vendedor_comision_id, v_despacho.cotizacion_id,
    v_despacho.cuenta_id, v_total, v_comision_cabilla, v_comision_otros,
    v_pct_cabilla, v_pct_otros, 'generada', v_total, 0,
    v_extra_details, v_cxc_excluded, v_payment_excluded_commission,
    round(v_excluded_commission, 2), v_fraction, '238b',
    'fecha_despacho_no_cxc', 'stored_net_238b',
    jsonb_build_object(
      'payment_split', v_payment,
      'base_cabilla_usd', round(v_base_cabilla, 4),
      'base_otros_usd', round(v_base_otros, 4),
      'base_externos_usd', round(v_base_externos, 4),
      'commission_before_payment', v_raw_total,
      'commission_after_payment', v_total,
      'cxc_excluded_commission', v_cxc_excluded,
      'payment_excluded_commission', v_payment_excluded_commission,
      'excluded_products_commission', round(v_excluded_commission, 2),
      'excluded_by_payment', COALESCE((v_payment->>'excluded_by_payment')::boolean, FALSE),
      'excluded_products_policy', jsonb_build_array('prestamo', 'corte')
    ), now(), now()
  )
  ON CONFLICT (despachoid) DO NOTHING
  RETURNING id INTO v_comision_id;

  IF v_comision_id IS NULL THEN
    SELECT id INTO v_comision_id FROM public.comisiones WHERE despachoid = p_despachoid;
  END IF;
  RETURN v_comision_id;
END
$function$

-- === recalcularcomisiondespacho_238b (pre-split) ===
CREATE OR REPLACE FUNCTION public.recalcularcomisiondespacho_238b(p_despachoid uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existing RECORD;
  v_result UUID;
BEGIN
  IF p_despachoid IS NULL THEN
    RAISE EXCEPTION 'DESPACHO_ID_REQUERIDO';
  END IF;

  SELECT c.id, c.calculo_version
  INTO v_existing
  FROM public.comisiones c
  WHERE c.despachoid = p_despachoid
  FOR UPDATE;

  IF FOUND AND v_existing.calculo_version IS DISTINCT FROM '238b' THEN
    RETURN v_existing.id;
  END IF;

  IF FOUND THEN
    DELETE FROM public.comisiones WHERE id = v_existing.id;
  END IF;

  v_result := public.calcularcomisiondespacho_238b(p_despachoid);
  RETURN v_result;
END
$function$

-- === ajustar_finanzas_devolucion_atomica (pre-multi-fila) ===
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

  SELECT *
  INTO v_despacho
  FROM public.notas_despacho
  WHERE id = p_despacho_id
  FOR UPDATE;

  IF NOT FOUND OR v_despacho.estado <> 'entregada' THEN
    RAISE EXCEPTION 'DESPACHO_FINANZAS_NO_DISPONIBLE';
  END IF;

  -- La RPC 225 ya actualizó total_usd dentro de esta misma transacción.
  -- Reconstruimos el total anterior para calcular comisión sin descontar dos
  -- veces la devolución.
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

  -- Bloquear el cliente antes de leer saldos para evitar dos devoluciones que
  -- calculen el mismo saldo y generen abonos/créditos inconsistentes.
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
      -- Solo se devuelve contra la deuda originada por este despacho. El
      -- excedente se convierte en crédito a favor del cliente.
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
  ELSE
    v_balance_neto := ROUND((p_total_intercambio_usd - p_total_devuelto_usd)::NUMERIC, 4);
  END IF;

  -- La comisión ya pagada no puede recalcularse silenciosamente después de
  -- devolver mercancía. En ese caso se revierte toda la transacción.
  SELECT *
  INTO v_comision
  FROM public.comisiones c
  WHERE c.despachoid = p_despacho_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_comision.estado = 'pagada' OR COALESCE(v_comision.montopagado, 0) > 0.01 THEN
      RAISE EXCEPTION 'COMISION_YA_PAGADA: revierta el pago antes de registrar la devolución';
    END IF;

    IF v_total_original > 0 THEN
      v_factor := v_total_nuevo / v_total_original;
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

  -- Los triggers de cuentas_por_cobrar mantienen los saldos denormalizados.
  -- Reforzamos el resultado final bajo el mismo bloqueo para dejarlo explícito.
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
    'comision_ajustada', v_comision_ajustada
  );
END;
$function$

-- 2) Eliminar filas 238b de los despachos split y regenerar con la lógica vieja
DELETE FROM public.comisiones
WHERE despachoid IN (SELECT despachoid FROM _split_despachos)
  AND calculo_version = '238b';

DROP INDEX IF EXISTS public.ux_comisiones_despacho_vendedor;
CREATE UNIQUE INDEX ux_comisiones_despachoid_238a ON public.comisiones (despachoid);

DO $$
DECLARE
  d RECORD;
BEGIN
  FOR d IN SELECT despachoid FROM _split_despachos LOOP
    PERFORM public.recalcularcomisiondespacho_238b(d.despachoid);
  END LOOP;
END
$$;

-- 3) Configuración: eliminar los campos del split
ALTER TABLE public.configuracion_negocio
  DROP COLUMN IF EXISTS comision_split_activo,
  DROP COLUMN IF EXISTS comision_split_pct_vendedor,
  DROP COLUMN IF EXISTS comision_split_pct_dueno,
  DROP COLUMN IF EXISTS comision_split_dias;

-- 4) Grants como estaban (patrón 239)
REVOKE ALL ON FUNCTION public.calcularcomisiondespacho_238b(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recalcularcomisiondespacho_238b(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ajustar_finanzas_devolucion_atomica(uuid, numeric, numeric, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calcularcomisiondespacho_238b(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.recalcularcomisiondespacho_238b(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ajustar_finanzas_devolucion_atomica(uuid, numeric, numeric, uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
