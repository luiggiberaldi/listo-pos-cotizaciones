-- 326_staging_prestamo_pago_comision_tasa.sql — Solo STAGING (OP-2026-091)
-- Facturar un préstamo: (1) tasa principal del sistema (con su tipo anotado), (2) opción "Paga ahora"
-- (cobro + pago en un solo paso) o "A crédito", (3) comisión del vendedor sobre lo facturado con el mismo
-- porcentaje de una venta normal, (4) cierre de la falla N44-INV: revertir la entrega con préstamos
-- devueltos/facturados queda bloqueado en todos los estados. Además se corrige el texto del cargo,
-- que mostraba "##" por un formato de número mal escrito.
-- Rollback: 326_staging_prestamo_pago_comision_tasa_rollback.sql
BEGIN;

DROP FUNCTION IF EXISTS public.facturar_prestamo_atomico(uuid, uuid, numeric, uuid, numeric, uuid);

CREATE OR REPLACE FUNCTION public.comision_prestamo_facturado_staging(
  p_despacho_id UUID, p_producto_id UUID, p_nombre TEXT, p_origen TEXT,
  p_monto_usd NUMERIC, p_cobrado BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_d            RECORD;
  v_cfg          RECORD;
  v_cat          TEXT;
  v_cat_cabilla  TEXT := 'cabilla';
  v_pct_cabilla  NUMERIC := 2;
  v_pct_otros    NUMERIC := 3;
  v_pct_externos NUMERIC := 3;
  v_extras       JSONB := '[]'::jsonb;
  v_row          RECORD;
  v_bd           JSONB;
  v_com          NUMERIC;
  v_bucket       TEXT;
  v_estado       TEXT;
BEGIN
  IF COALESCE(p_monto_usd, 0) <= 0 THEN
    RETURN jsonb_build_object('aplica', FALSE, 'motivo', 'monto_cero');
  END IF;

  SELECT nd.id, nd.cuenta_id,
         COALESCE(cl.vendedor_id, nd.vendedor_id) AS vendedor_comision_id,
         u.rol AS vendedor_rol, u.es_externo AS vendedor_es_externo, u.markup_pct AS vendedor_markup_pct,
         u.comision_pct AS vendedor_comision_pct, u.comision_pct_cabilla AS vendedor_comision_pct_cabilla
  INTO v_d
  FROM public.notas_despacho nd
  LEFT JOIN public.clientes cl ON cl.id = nd.cliente_id
  LEFT JOIN public.usuarios u ON u.id = COALESCE(cl.vendedor_id, nd.vendedor_id)
  WHERE nd.id = p_despacho_id;
  IF NOT FOUND OR v_d.vendedor_comision_id IS NULL THEN
    RETURN jsonb_build_object('aplica', FALSE, 'motivo', 'sin_vendedor');
  END IF;
  IF v_d.vendedor_rol IN ('admin', 'jefe', 'logistica', 'administracion', 'desarrollador')
     OR (v_d.vendedor_rol = 'vendedor_sin_comision'
         AND NOT COALESCE(v_d.vendedor_es_externo, FALSE)
         AND COALESCE(v_d.vendedor_markup_pct, 0) <= 0) THEN
    RETURN jsonb_build_object('aplica', FALSE, 'motivo', 'vendedor_sin_comision');
  END IF;

  SELECT cn.* INTO v_cfg
  FROM public.configuracion_negocio cn
  WHERE cn.cuenta_id = v_d.cuenta_id OR cn.id = 1
  ORDER BY CASE WHEN cn.cuenta_id = v_d.cuenta_id THEN 0 ELSE 1 END
  LIMIT 1;
  IF FOUND THEN
    v_cat_cabilla := lower(trim(COALESCE(v_cfg.comision_categoria_cabilla, 'cabilla')));
    IF COALESCE(v_d.vendedor_es_externo, FALSE) THEN
      v_pct_cabilla := COALESCE(v_cfg.comision_ext_pct_cabilla, 2);
      v_pct_otros := COALESCE(v_cfg.comision_ext_pct_otros, 3);
      v_pct_externos := COALESCE(v_cfg.comision_ext_pct_externos, 3);
      v_extras := COALESCE(v_cfg._comision_ext_extras, '[]'::jsonb);
    ELSE
      v_pct_cabilla := COALESCE(v_d.vendedor_comision_pct_cabilla, v_cfg.comision_pct_cabilla, 2);
      v_pct_otros := COALESCE(v_d.vendedor_comision_pct, v_cfg.comision_pct_otros, 3);
      v_pct_externos := COALESCE(v_cfg.comision_pct_externos, v_pct_otros, 3);
      v_extras := COALESCE(v_cfg._comision_extras, '[]'::jsonb);
    END IF;
  END IF;
  IF v_d.vendedor_rol = 'vendedor_sin_comision' AND NOT COALESCE(v_d.vendedor_es_externo, FALSE) THEN
    v_pct_cabilla := 0; v_pct_otros := 0; v_pct_externos := 0;
  END IF;

  SELECT p.categoria INTO v_cat FROM public.productos p WHERE p.id = p_producto_id;
  v_bd := public.comision_238b_item_breakdown(
    p_monto_usd, COALESCE(v_cat, ''), p_nombre, p_origen, FALSE,
    COALESCE(v_d.vendedor_es_externo, FALSE), v_cat_cabilla, v_pct_cabilla, v_pct_otros, v_pct_externos, v_extras);
  v_com := round(COALESCE((v_bd->>'commission')::numeric, 0), 2);
  v_bucket := v_bd->>'bucket';
  IF v_com <= 0 THEN
    RETURN jsonb_build_object('aplica', FALSE, 'motivo', 'porcentaje_cero');
  END IF;

  SELECT * INTO v_row FROM public.comisiones
  WHERE despachoid = p_despacho_id AND vendedorid = v_d.vendedor_comision_id
  FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM public.calcularcomisiondespacho_238b(p_despacho_id);
    SELECT * INTO v_row FROM public.comisiones
    WHERE despachoid = p_despacho_id AND vendedorid = v_d.vendedor_comision_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('aplica', FALSE, 'motivo', 'sin_fila_comision');
    END IF;
  END IF;

  IF p_cobrado THEN
    -- Cobrado en el momento: queda liberada. Si ya estaba pagada al vendedor, vuelve a "pendiente" por la diferencia.
    v_estado := CASE WHEN v_row.estado = 'pagada' THEN 'pendiente' ELSE v_row.estado END;
    UPDATE public.comisiones SET
      totalcomision = round(COALESCE(totalcomision, 0) + v_com, 2),
      comision_liberada = round(COALESCE(comision_liberada, 0) + v_com, 2),
      comisioncabilla = CASE WHEN v_bucket = 'cabilla' THEN round(COALESCE(comisioncabilla, 0) + v_com, 2) ELSE comisioncabilla END,
      comisionotros = CASE WHEN v_bucket <> 'cabilla' THEN round(COALESCE(comisionotros, 0) + v_com, 2) ELSE comisionotros END,
      estado = v_estado,
      pagadaen = CASE WHEN v_row.estado = 'pagada' THEN NULL ELSE pagadaen END,
      pagadapor = CASE WHEN v_row.estado = 'pagada' THEN NULL ELSE pagadapor END,
      actualizadoen = now()
    WHERE id = v_row.id;
  ELSE
    -- A crédito: queda retenida ("cuenta por cobrar") hasta que administración la libere al cobrarse.
    v_estado := 'cta_cobrar';
    UPDATE public.comisiones SET
      totalcomision = round(COALESCE(totalcomision, 0) + v_com, 2),
      comision_retenida = round(COALESCE(comision_retenida, 0) + v_com, 2),
      comisioncabilla = CASE WHEN v_bucket = 'cabilla' THEN round(COALESCE(comisioncabilla, 0) + v_com, 2) ELSE comisioncabilla END,
      comisionotros = CASE WHEN v_bucket <> 'cabilla' THEN round(COALESCE(comisionotros, 0) + v_com, 2) ELSE comisionotros END,
      estado = v_estado,
      pagadaen = NULL, pagadapor = NULL,
      actualizadoen = now()
    WHERE id = v_row.id;
  END IF;

  UPDATE public.comisiones SET calculo_evidencia = jsonb_set(
    COALESCE(calculo_evidencia, '{}'::jsonb), '{prestamos_facturados}',
    COALESCE(calculo_evidencia->'prestamos_facturados', '[]'::jsonb)
      || jsonb_build_array(jsonb_build_object('monto_usd', p_monto_usd, 'comision', v_com, 'bucket', v_bucket,
                                              'pct', v_bd->'pct', 'cobrado', p_cobrado, 'fecha', now())))
  WHERE id = v_row.id;

  RETURN jsonb_build_object('aplica', TRUE, 'comision_usd', v_com, 'bucket', v_bucket,
                            'pct', v_bd->'pct', 'estado', v_estado, 'liberada', p_cobrado);
END;
$function$;

CREATE OR REPLACE FUNCTION public.facturar_prestamo_atomico(
  p_cuenta_id uuid,
  p_prestamo_id uuid,
  p_cantidad numeric,
  p_usuario_id uuid,
  p_tasa_bcv numeric,
  p_idempotency_key uuid,
  p_tasa_modo text DEFAULT 'bcv',
  p_pago_metodo text DEFAULT NULL,
  p_pago_referencia text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_guard        JSONB;
  v_actor        RECORD;
  v_cp           RECORD;
  v_ndi          RECORD;
  v_desp         RECORD;
  v_cliente      RECORD;
  v_cantidad     NUMERIC(12,4);
  v_restante     NUMERIC(12,4);
  v_nueva_fact   NUMERIC(12,4);
  v_devuelta     NUMERIC(12,4);
  v_desc_linea   NUMERIC(12,4);
  v_cant_base    NUMERIC(12,4);
  v_precio_unit  NUMERIC(12,4);
  v_total        NUMERIC(12,2);
  v_monto_bs     NUMERIC(14,2);
  v_estado       TEXT;
  v_cargo_id     UUID;
  v_desp_ref     TEXT;
  v_resultado    JSONB;
  v_modo         TEXT;
  v_abono_id     UUID;
  v_com          JSONB;
BEGIN
  IF p_cuenta_id IS NULL OR p_prestamo_id IS NULL OR p_usuario_id IS NULL THEN
    RAISE EXCEPTION 'PARAMETROS_FACTURAR_PRESTAMO_INVALIDOS';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_OBLIGATORIA';
  END IF;
  v_cantidad := ROUND(COALESCE(p_cantidad, 0)::NUMERIC, 4);
  IF v_cantidad <= 0 THEN
    RAISE EXCEPTION 'CANTIDAD_FACTURAR_INVALIDA';
  END IF;
  IF p_tasa_bcv IS NULL OR p_tasa_bcv <= 0 THEN
    RAISE EXCEPTION 'TASA_BCV_OBLIGATORIA';
  END IF;
  v_modo := lower(COALESCE(NULLIF(trim(p_tasa_modo), ''), 'bcv'));
  IF v_modo NOT IN ('bcv', 'usdt', 'manual') THEN
    RAISE EXCEPTION 'TASA_MODO_INVALIDO';
  END IF;
  IF p_pago_metodo IS NOT NULL AND (trim(p_pago_metodo) = '' OR NOT public.cxc_es_pago_real(p_pago_metodo)) THEN
    RAISE EXCEPTION 'PAGO_METODO_INVALIDO';
  END IF;

  v_guard := public.reservar_operacion_inventario(p_cuenta_id, p_idempotency_key, 'loan_invoice');
  IF COALESCE((v_guard->>'existente')::BOOLEAN, FALSE) THEN
    IF v_guard->'resultado' IS NULL OR v_guard->'resultado' = 'null'::JSONB THEN
      RAISE EXCEPTION 'OPERACION_IDEMPOTENTE_SIN_RESULTADO';
    END IF;
    RETURN (v_guard->'resultado') || jsonb_build_object('idempotent', TRUE);
  END IF;

  SELECT u.id, u.nombre, u.rol INTO v_actor
  FROM public.usuarios u
  WHERE u.id = p_usuario_id AND u.cuenta_id = p_cuenta_id AND u.activo = TRUE
    AND u.rol IN ('administracion', 'jefe', 'desarrollador');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROL_NO_AUTORIZADO_FACTURAR_PRESTAMO';
  END IF;

  -- Candado sobre el préstamo: serializa con devoluciones y otros cobros del mismo préstamo.
  SELECT cp.* INTO v_cp
  FROM public.cliente_prestamos cp
  WHERE cp.id = p_prestamo_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRESTAMO_NO_ENCONTRADO';
  END IF;

  SELECT c.id, c.cuenta_id, c.saldo_pendiente INTO v_cliente
  FROM public.clientes c
  WHERE c.id = v_cp.cliente_id
  FOR UPDATE;
  IF NOT FOUND OR v_cliente.cuenta_id IS DISTINCT FROM p_cuenta_id THEN
    RAISE EXCEPTION 'PRESTAMO_NO_ENCONTRADO';
  END IF;

  v_devuelta := COALESCE(v_cp.cantidad_devuelta, 0);
  v_restante := COALESCE(v_cp.cantidad_prestada, 0) - v_devuelta - COALESCE(v_cp.cantidad_facturada, 0);
  IF v_cantidad > v_restante + 0.0001 THEN
    RAISE EXCEPTION 'CANTIDAD_SUPERA_PENDIENTE_PRESTAMO: pendiente %', GREATEST(v_restante, 0);
  END IF;

  SELECT ndi.* INTO v_ndi
  FROM public.notas_despacho_items ndi
  WHERE ndi.id = v_cp.despacho_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'LINEA_DE_PRESTAMO_NO_ENCONTRADA';
  END IF;

  SELECT d.id, d.numero, d.cotizacion_id INTO v_desp
  FROM public.notas_despacho d
  WHERE d.id = v_ndi.despacho_id;

  -- OP-2026-088: el precio sale de la misma función que usa la pantalla para mostrar la vista previa.
  v_precio_unit := public.precio_unitario_prestamo(v_cp.id);
  v_total := ROUND(v_cantidad * v_precio_unit, 2);
  IF v_total <= 0 THEN
    RAISE EXCEPTION 'PRESTAMO_SIN_PRECIO: la línea del despacho no tiene precio';
  END IF;
  v_monto_bs := ROUND(v_total * p_tasa_bcv, 2);

  v_desp_ref := CASE WHEN v_desp.numero IS NOT NULL THEN 'DES-' || lpad(v_desp.numero::TEXT, 5, '0') ELSE 'Préstamo' END;

  INSERT INTO public.cuentas_por_cobrar (
    cliente_id, despacho_id, tipo, monto_usd, saldo_usd, descripcion,
    registrado_por, cuenta_id, idempotency_key
  ) VALUES (
    v_cp.cliente_id, v_cp.despacho_id, 'cargo', v_total,
    ROUND(COALESCE(v_cliente.saldo_pendiente, 0) + v_total, 2),
    format('Facturación de préstamo de %s %s %s (Orig: %s) · precio despacho $%s · tasa principal (%s) %s Bs/$ (≈ Bs %s)',
      trim(to_char(v_cantidad, 'FM999999990.####')), COALESCE(v_ndi.unidad_snap, 'und'),
      COALESCE(v_ndi.nombre_snap, 'Producto'), v_desp_ref,
      trim(to_char(v_precio_unit, 'FM999999990.00')), upper(v_modo), trim(to_char(p_tasa_bcv, 'FM999999990.00')),
      to_char(v_monto_bs, 'FM999999999990.00')),
    v_actor.id, p_cuenta_id, p_idempotency_key
  )
  RETURNING id INTO v_cargo_id;

  -- OP-2026-091: "Paga ahora" registra el pago en el mismo paso (el saldo del cliente no cambia).
  IF p_pago_metodo IS NOT NULL THEN
    INSERT INTO public.cuentas_por_cobrar (
      cliente_id, despacho_id, tipo, monto_usd, saldo_usd, forma_pago_abono, referencia,
      descripcion, registrado_por, cuenta_id, idempotency_key
    ) VALUES (
      v_cp.cliente_id, v_cp.despacho_id, 'abono', v_total,
      ROUND(COALESCE(v_cliente.saldo_pendiente, 0), 2),
      trim(p_pago_metodo), NULLIF(trim(COALESCE(p_pago_referencia, '')), ''),
      format('Pago al facturar préstamo de %s %s %s (Orig: %s)',
        trim(to_char(v_cantidad, 'FM999999990.####')), COALESCE(v_ndi.unidad_snap, 'und'),
        COALESCE(v_ndi.nombre_snap, 'Producto'), v_desp_ref),
      v_actor.id, p_cuenta_id, md5(p_idempotency_key::text || ':abono')::uuid::text
    )
    RETURNING id INTO v_abono_id;
  END IF;

  -- Comisión del vendedor sobre lo facturado (mismo porcentaje que una venta normal).
  v_com := public.comision_prestamo_facturado_staging(
    v_cp.despacho_id, v_ndi.producto_id, v_ndi.nombre_snap, v_ndi.origen, v_total, p_pago_metodo IS NOT NULL);

  v_nueva_fact := COALESCE(v_cp.cantidad_facturada, 0) + v_cantidad;
  v_estado := CASE
    WHEN v_devuelta + v_nueva_fact >= COALESCE(v_cp.cantidad_prestada, 0) - 0.0001 THEN 'facturado'
    WHEN v_devuelta > 0 THEN 'devuelto_parcial'
    ELSE 'pendiente'
  END;

  UPDATE public.cliente_prestamos
  SET cantidad_facturada = v_nueva_fact,
      estado = v_estado
  WHERE id = v_cp.id;

  v_resultado := jsonb_build_object(
    'ok', TRUE,
    'tasa_modo', v_modo,
    'pago_metodo', p_pago_metodo,
    'abono_id', v_abono_id,
    'comision', v_com,
    'prestamo_id', v_cp.id,
    'cliente_id', v_cp.cliente_id,
    'despacho_id', v_cp.despacho_id,
    'cargo_id', v_cargo_id,
    'cantidad', v_cantidad,
    'precio_unit_usd', v_precio_unit,
    'monto_usd', v_total,
    'tasa_bcv', p_tasa_bcv,
    'monto_bs', v_monto_bs,
    'cantidad_facturada', v_nueva_fact,
    'estado', v_estado,
    'producto_nombre', v_ndi.nombre_snap,
    'unidad', COALESCE(v_ndi.unidad_snap, 'und'),
    'despacho_ref', v_desp_ref,
    'idempotency_key', p_idempotency_key
  );
  PERFORM public.guardar_operacion_inventario(p_cuenta_id, p_idempotency_key, v_resultado);
  RETURN v_resultado;
END;
$function$;

CREATE OR REPLACE FUNCTION public.revertir_entrega_finanzas_atomica(p_despacho_id uuid, p_nuevo_estado text, p_usuario_id uuid, p_usuario_nombre text, p_usuario_color text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_despacho    RECORD;
  v_comision    RECORD;
  v_inventario  JSONB;
  v_cxc_count   INTEGER := 0;
  v_com_count   INTEGER := 0;
BEGIN
  IF p_despacho_id IS NULL
     OR p_nuevo_estado NOT IN ('pendiente', 'despachada', 'anulada')
     OR p_usuario_id IS NULL
     OR p_usuario_nombre IS NULL
     OR char_length(trim(p_usuario_nombre)) = 0 THEN
    RAISE EXCEPTION 'PARAMETROS_REVERSA_FINANCIERA_INVALIDOS';
  END IF;

  SELECT *
  INTO v_despacho
  FROM public.notas_despacho
  WHERE id = p_despacho_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DESPACHO_NO_ENCONTRADO';
  END IF;

  IF v_despacho.estado <> 'entregada' THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO: Solo se puede revertir un despacho entregado';
  END IF;

  IF COALESCE(v_despacho.flete_pagado, FALSE) THEN
    RAISE EXCEPTION 'FLETE_YA_PAGADO: revierta primero la liquidación del transportista';
  END IF;

  -- OP-2026-091 (N44-INV): con un préstamo devuelto o facturado no se revierte la entrega a ningún
  -- estado (antes solo se revisaba al pasar a pendiente/anulada y se podía borrar un cobro ya facturado).
  PERFORM public.verificar_prestamos_despacho_reaperturable(p_despacho_id);

  -- Un abono real no se puede borrar silenciosamente. El Worker mantiene el
  -- mismo guardarraíl antes de llamar a esta RPC.
  IF EXISTS (
    SELECT 1
    FROM public.cuentas_por_cobrar
    WHERE despacho_id = p_despacho_id
      AND tipo = 'abono'
      AND COALESCE(forma_pago_abono, '') <> 'Saldo a favor'
  ) THEN
    RAISE EXCEPTION 'CXC_CON_ABONOS: anule primero los cobros registrados';
  END IF;

  -- Una comisión pagada tampoco puede desaparecer por una reversión.
  SELECT *
  INTO v_comision
  FROM public.comisiones
  WHERE despachoid = p_despacho_id
  FOR UPDATE;

  IF FOUND AND (v_comision.estado = 'pagada' OR COALESCE(v_comision.montopagado, 0) > 0.01) THEN
    RAISE EXCEPTION 'COMISION_YA_PAGADA: revierta primero el pago de comisión';
  END IF;

  -- La 224 restaura el stock neto de devoluciones/intercambios y actualiza el
  -- estado. Todas las operaciones siguientes forman parte de esta transacción.
  v_inventario := public.revertir_entrega_inventario_atomica(
    p_despacho_id,
    p_nuevo_estado,
    p_usuario_id,
    p_usuario_nombre,
    p_usuario_color
  );

  DELETE FROM public.cuentas_por_cobrar
  WHERE despacho_id = p_despacho_id;
  GET DIAGNOSTICS v_cxc_count = ROW_COUNT;

  DELETE FROM public.comisiones
  WHERE despachoid = p_despacho_id;
  GET DIAGNOSTICS v_com_count = ROW_COUNT;

  RETURN v_inventario || jsonb_build_object(
    'finanzas_revertidas', TRUE,
    'cxc_movimientos_eliminados', v_cxc_count,
    'comisiones_eliminadas', v_com_count
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.facturar_prestamo_atomico(uuid, uuid, numeric, uuid, numeric, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.facturar_prestamo_atomico(uuid, uuid, numeric, uuid, numeric, uuid, text, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.comision_prestamo_facturado_staging(uuid, uuid, text, text, numeric, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.comision_prestamo_facturado_staging(uuid, uuid, text, text, numeric, boolean) TO service_role;

COMMIT;
