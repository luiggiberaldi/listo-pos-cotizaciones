-- Rollback de 325 (OP-2026-088): vuelve a la función de 318 con el cálculo dentro y quita las ayudas.
BEGIN;
CREATE OR REPLACE FUNCTION public.facturar_prestamo_atomico(
  p_cuenta_id uuid,
  p_prestamo_id uuid,
  p_cantidad numeric,
  p_usuario_id uuid,
  p_tasa_bcv numeric,
  p_idempotency_key uuid
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

  -- Descuento en dólares de la línea (por despacho_item_id, o por la línea equivalente de la cotización).
  SELECT COALESCE(SUM(dd.monto_usd), 0) INTO v_desc_linea
  FROM public.despacho_descuentos dd
  WHERE dd.despacho_id = v_ndi.despacho_id
    AND (
      dd.despacho_item_id = v_ndi.id
      OR (dd.despacho_item_id IS NULL AND dd.cotizacion_item_id = (
            SELECT ci.id FROM public.cotizacion_items ci
            WHERE ci.cotizacion_id = v_desp.cotizacion_id
              AND ci.producto_id IS NOT DISTINCT FROM v_ndi.producto_id
            ORDER BY (ci.orden IS NOT DISTINCT FROM v_ndi.orden) DESC, ci.orden
            LIMIT 1))
    );

  v_cant_base := COALESCE(NULLIF(v_ndi.cantidad_original, 0), NULLIF(v_ndi.cantidad, 0), 1);
  v_precio_unit := GREATEST(0,
    COALESCE(v_ndi.precio_unit_usd, 0) * (1 - COALESCE(v_ndi.descuento_pct, 0) / 100)
    - v_desc_linea / v_cant_base);
  v_precio_unit := ROUND(v_precio_unit, 4);
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
    format('Facturación de préstamo de %s %s %s (Orig: %s) · precio despacho $%s · tasa BCV del día %s Bs/$ (≈ Bs %s)',
      trim(to_char(v_cantidad, 'FM999999990.####')), COALESCE(v_ndi.unidad_snap, 'und'),
      COALESCE(v_ndi.nombre_snap, 'Producto'), v_desp_ref,
      to_char(v_precio_unit, 'FM999999990.00##'), to_char(p_tasa_bcv, 'FM999999990.00##'),
      to_char(v_monto_bs, 'FM999999999990.00')),
    v_actor.id, p_cuenta_id, p_idempotency_key
  )
  RETURNING id INTO v_cargo_id;

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

REVOKE ALL ON FUNCTION public.facturar_prestamo_atomico(uuid, uuid, numeric, uuid, numeric, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.facturar_prestamo_atomico(uuid, uuid, numeric, uuid, numeric, uuid) TO service_role;

DROP FUNCTION IF EXISTS public.precios_unitarios_prestamos(UUID[]);
DROP FUNCTION IF EXISTS public.precio_unitario_prestamo(UUID);
COMMIT;
