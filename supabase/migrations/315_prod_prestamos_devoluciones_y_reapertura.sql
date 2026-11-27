-- 315_prod_prestamos_devoluciones_y_reapertura.sql — PRODUCCIÓN (OP-2026-097)
-- 1) Protege reapertura de despachos con préstamos devueltos/facturados en todos los estados (N27/N44-INV).
-- 2) Devolución física de préstamos con bloqueo FOR UPDATE, 4 decimales y soporte a archivados (N33).
-- 3) Devolución parcial (registrar_devolucion_inventario_atomica): bloquea ítems de préstamo (N35),
--    valida precios <= precio del despacho + 0.02, valida totales de intercambio y registra origen_tipo='devolucion' en Kardex (A6).
-- 4) Edición profunda atómica y recálculo neto de devoluciones/intercambios en reaperturas (N28/N31).
-- NOTA: NO expone facturar_prestamo_atomico (pausado hasta consulta con el cliente).
-- Rollback: 315_prod_prestamos_devoluciones_y_reapertura_rollback.sql
BEGIN;

CREATE OR REPLACE FUNCTION public.verificar_prestamos_despacho_reaperturable(
  p_despacho_id uuid
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.cliente_prestamos cp
    WHERE cp.despacho_id = p_despacho_id
      AND (
        COALESCE(cp.cantidad_devuelta, 0) > 0
        OR COALESCE(cp.cantidad_facturada, 0) > 0
      )
  ) THEN
    RAISE EXCEPTION 'PRESTAMO_YA_TIENE_DEVOLUCIONES_O_FACTURAS: El despacho tiene préstamos asociados con devoluciones o facturaciones ya registradas';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.obtener_items_netos_despacho(
  p_despacho_id uuid
)
RETURNS TABLE (
  producto_id uuid,
  nombre_snap text,
  cantidad numeric(12,4)
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    neto.producto_id,
    MAX(neto.nombre_snap) AS nombre_snap,
    ROUND(SUM(neto.cantidad), 4)::NUMERIC(12,4) AS cantidad
  FROM (
    SELECT
      ndi.producto_id,
      ndi.nombre_snap,
      GREATEST(0, COALESCE(ndi.cantidad, 0) - COALESCE(dev.cantidad_devuelta, 0)) AS cantidad
    FROM public.notas_despacho_items ndi
    LEFT JOIN (
      SELECT dd.despacho_item_id, SUM(dd.cantidad_devuelta) AS cantidad_devuelta
      FROM public.despacho_devoluciones dd
      WHERE dd.despacho_id = p_despacho_id
        AND dd.despacho_item_id IS NOT NULL
      GROUP BY dd.despacho_item_id
    ) dev ON dev.despacho_item_id = ndi.id
    WHERE ndi.despacho_id = p_despacho_id
      AND ndi.producto_id IS NOT NULL
      AND COALESCE(ndi.origen, 'inventario') = 'inventario'

    UNION ALL

    SELECT
      interc.producto_id,
      interc.nombre_snap,
      GREATEST(0, COALESCE(interc.cantidad, 0) - COALESCE(dev_int.cantidad_devuelta, 0)) AS cantidad
    FROM (
      SELECT
        ddi.producto_id,
        MAX(ddi.nombre_snap) AS nombre_snap,
        SUM(ddi.cantidad) AS cantidad
      FROM public.despacho_devolucion_intercambios ddi
      WHERE ddi.despacho_id = p_despacho_id
        AND ddi.producto_id IS NOT NULL
      GROUP BY ddi.producto_id
    ) interc
    LEFT JOIN (
      SELECT dd.producto_id, SUM(dd.cantidad_devuelta) AS cantidad_devuelta
      FROM public.despacho_devoluciones dd
      WHERE dd.despacho_id = p_despacho_id
        AND dd.despacho_item_id IS NULL
        AND dd.producto_id IS NOT NULL
      GROUP BY dd.producto_id
    ) dev_int ON dev_int.producto_id = interc.producto_id
  ) neto
  WHERE neto.cantidad > 0
  GROUP BY neto.producto_id
  ORDER BY neto.producto_id;
$function$;

CREATE OR REPLACE FUNCTION public.aprobar_despacho_inventario_atomico(
  p_despacho_id uuid,
  p_usuario_id uuid,
  p_usuario_nombre text,
  p_usuario_color text DEFAULT NULL::text,
  p_solo_validar boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_despacho     RECORD;
  v_cfg          RECORD;
  v_item         RECORD;
  v_producto     RECORD;
  v_lote_id      UUID := gen_random_uuid();
  v_productos    JSONB := '[]'::JSONB;
  v_alertas      JSONB := '[]'::JSONB;
  v_nuevo_stock  NUMERIC(12,4);
  v_nivel        TEXT;
  v_movimientos  INTEGER := 0;
  v_con_alertas  BOOLEAN := FALSE;
  v_solo_validar BOOLEAN := COALESCE(p_solo_validar, FALSE);
  v_usuario_fk   UUID;
BEGIN
  IF p_despacho_id IS NULL THEN
    RAISE EXCEPTION 'DESPACHO_ID_OBLIGATORIO';
  END IF;
  IF p_usuario_id IS NULL OR p_usuario_nombre IS NULL OR char_length(trim(p_usuario_nombre)) = 0 THEN
    RAISE EXCEPTION 'USUARIO_AUDITORIA_OBLIGATORIO';
  END IF;

  SELECT id, cuenta_id, estado, numero
  INTO v_despacho
  FROM public.notas_despacho
  WHERE id = p_despacho_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DESPACHO_NO_ENCONTRADO';
  END IF;
  IF v_despacho.estado <> 'pendiente' THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO: solo pendiente→despachada (estado actual: %)', v_despacho.estado;
  END IF;

  SELECT u.id INTO v_usuario_fk
  FROM public.usuarios u
  WHERE u.id = p_usuario_id AND u.activo = TRUE
    AND (v_despacho.cuenta_id IS NULL OR u.cuenta_id = v_despacho.cuenta_id)
  LIMIT 1;
  IF v_usuario_fk IS NULL THEN
    SELECT u.id INTO v_usuario_fk
    FROM public.usuarios u
    WHERE u.activo = TRUE
      AND (v_despacho.cuenta_id IS NULL OR u.cuenta_id = v_despacho.cuenta_id)
      AND u.rol IN ('supervisor', 'administracion', 'jefe', 'desarrollador')
    ORDER BY u.nombre LIMIT 1;
  END IF;
  IF v_usuario_fk IS NULL THEN
    RAISE EXCEPTION 'USUARIO_KARDEX_NO_ENCONTRADO';
  END IF;

  SELECT COALESCE(cn.permitir_stock_negativo, FALSE) AS permitir_negativo
  INTO v_cfg
  FROM public.configuracion_negocio cn
  WHERE cn.cuenta_id = v_despacho.cuenta_id
  LIMIT 1;

  -- N27/N28/N31: incluye préstamos e ítems netos (tras eventuales reaperturas).
  FOR v_item IN
    SELECT producto_id, nombre_snap, cantidad
    FROM public.obtener_items_netos_despacho(p_despacho_id)
  LOOP
    SELECT id, nombre, stock_actual, stock_minimo, activo, cuenta_id
    INTO v_producto
    FROM public.productos
    WHERE id = v_item.producto_id
      AND (v_despacho.cuenta_id IS NULL OR cuenta_id = v_despacho.cuenta_id)
    FOR UPDATE;

    IF NOT FOUND OR v_producto.activo IS NOT TRUE THEN
      RAISE EXCEPTION 'PRODUCTO_NO_DISPONIBLE: %', v_item.nombre_snap;
    END IF;
    IF v_item.cantidad <= 0 THEN
      RAISE EXCEPTION 'CANTIDAD_INVALIDA: %', v_item.nombre_snap;
    END IF;

    v_nuevo_stock := ROUND((COALESCE(v_producto.stock_actual, 0) - v_item.cantidad)::NUMERIC, 4);

    v_nivel := CASE
      WHEN v_nuevo_stock < 0 THEN 'NEGATIVO'
      WHEN v_nuevo_stock < COALESCE(v_producto.stock_minimo, 0) THEN 'BAJO'
      ELSE NULL
    END;

    v_productos := v_productos || jsonb_build_object(
      'producto_id',   v_producto.id,
      'nombre',        v_producto.nombre,
      'stock_antes',   COALESCE(v_producto.stock_actual, 0),
      'requerido',     v_item.cantidad,
      'stock_despues', v_nuevo_stock,
      'nivel_alerta',  v_nivel
    );

    IF v_nivel IS NOT NULL THEN
      v_con_alertas := TRUE;
      v_alertas := v_alertas || jsonb_build_object(
        'producto_id',   v_producto.id,
        'nombre',        v_producto.nombre,
        'cantidad',      v_item.cantidad,
        'stock_antes',   COALESCE(v_producto.stock_actual, 0),
        'stock_despues', v_nuevo_stock,
        'nivel',         v_nivel
      );
    END IF;

    IF NOT v_solo_validar THEN
      UPDATE public.productos
      SET stock_actual = v_nuevo_stock,
          actualizado_en = now()
      WHERE id = v_producto.id;

      INSERT INTO public.inventario_movimientos (
        lote_id, tipo, motivo, motivo_tipo,
        producto_id, producto_nombre, cantidad,
        stock_anterior, stock_nuevo,
        usuario_id, usuario_nombre, usuario_color, cuenta_id
      ) VALUES (
        v_lote_id,
        'egreso',
        CASE
          WHEN v_nuevo_stock < 0 THEN 'Despacho #' || v_despacho.numero || ' aprobado [STOCK NEGATIVO]'
          ELSE 'Despacho #' || v_despacho.numero || ' aprobado'
        END,
        'venta',
        v_producto.id,
        COALESCE(v_item.nombre_snap, v_producto.nombre),
        v_item.cantidad,
        COALESCE(v_producto.stock_actual, 0),
        v_nuevo_stock,
        v_usuario_fk,
        trim(p_usuario_nombre),
        p_usuario_color,
        v_producto.cuenta_id
      );

      v_movimientos := v_movimientos + 1;
    END IF;
  END LOOP;

  IF v_solo_validar THEN
    RETURN jsonb_build_object(
      'ok', TRUE,
      'solo_validar', TRUE,
      'despacho_id', p_despacho_id,
      'venta_anticipada', COALESCE(v_cfg.permitir_negativo, FALSE),
      'productos', v_productos,
      'alertas_stock', v_alertas,
      'con_alertas', v_con_alertas
    );
  END IF;

  UPDATE public.notas_despacho
  SET estado = 'despachada',
      despachada_en = COALESCE(despachada_en, now()),
      aprobado_por_nombre = trim(p_usuario_nombre),
      alerta_stock = v_con_alertas,
      alerta_stock_items = CASE WHEN v_con_alertas THEN v_alertas ELSE NULL END,
      egreso_lote_id = v_lote_id
  WHERE id = p_despacho_id;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'despacho_id', p_despacho_id,
    'lote_id', v_lote_id,
    'movimientos', v_movimientos,
    'venta_anticipada', COALESCE(v_cfg.permitir_negativo, FALSE),
    'productos', v_productos,
    'alertas_stock', v_alertas,
    'con_alertas', v_con_alertas,
    'alerta_stock', v_con_alertas,
    'bloqueo_aplicado', TRUE,
    'faltantes', '[]'::JSONB,
    'con_faltantes', FALSE
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.confirmar_entrega_inventario_atomica(
  p_despacho_id uuid,
  p_usuario_id uuid,
  p_usuario_nombre text,
  p_usuario_color text DEFAULT NULL::text,
  p_tasa_snapshot numeric DEFAULT NULL::numeric,
  p_permitir_negativo boolean DEFAULT NULL::boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_despacho    RECORD;
  v_producto    RECORD;
  v_item        RECORD;
  v_lote_id     UUID := gen_random_uuid();
  v_egreso      BOOLEAN := FALSE;
  v_nuevo_stock NUMERIC(12,4);
  v_nivel       TEXT;
  v_alertas     JSONB := '[]'::JSONB;
  v_con_alertas BOOLEAN := FALSE;
  v_movimientos INTEGER := 0;
  v_usuario_fk  UUID;
BEGIN
  IF p_despacho_id IS NULL THEN
    RAISE EXCEPTION 'DESPACHO_ID_OBLIGATORIO';
  END IF;

  SELECT *
  INTO v_despacho
  FROM public.notas_despacho
  WHERE id = p_despacho_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DESPACHO_NO_ENCONTRADO';
  END IF;

  IF v_despacho.estado NOT IN ('pendiente', 'despachada') THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO: El despacho debe estar pendiente o aprobado';
  END IF;

  v_egreso := (v_despacho.estado = 'pendiente');

  IF p_usuario_id IS NULL OR p_usuario_nombre IS NULL OR char_length(trim(p_usuario_nombre)) = 0 THEN
    RAISE EXCEPTION 'USUARIO_AUDITORIA_OBLIGATORIO';
  END IF;

  SELECT u.id INTO v_usuario_fk
  FROM public.usuarios u
  WHERE u.id = p_usuario_id AND u.activo = TRUE
    AND (v_despacho.cuenta_id IS NULL OR u.cuenta_id = v_despacho.cuenta_id)
  LIMIT 1;
  IF v_usuario_fk IS NULL THEN
    SELECT u.id INTO v_usuario_fk
    FROM public.usuarios u
    WHERE u.activo = TRUE
      AND (v_despacho.cuenta_id IS NULL OR u.cuenta_id = v_despacho.cuenta_id)
      AND u.rol IN ('supervisor', 'administracion', 'jefe', 'desarrollador')
    ORDER BY u.nombre LIMIT 1;
  END IF;
  IF v_usuario_fk IS NULL THEN
    RAISE EXCEPTION 'USUARIO_KARDEX_NO_ENCONTRADO';
  END IF;

  -- N27/N28: en entrega directa (pendiente -> entregada) egresa todo incluyendo préstamos.
  FOR v_item IN
    SELECT producto_id, nombre_snap, cantidad
    FROM public.obtener_items_netos_despacho(p_despacho_id)
  LOOP
    SELECT id, nombre, stock_actual, stock_minimo, activo, cuenta_id
    INTO v_producto
    FROM public.productos
    WHERE id = v_item.producto_id
      AND (v_despacho.cuenta_id IS NULL OR cuenta_id = v_despacho.cuenta_id)
    FOR UPDATE;

    IF NOT FOUND OR v_producto.activo IS NOT TRUE THEN
      RAISE EXCEPTION 'PRODUCTO_NO_DISPONIBLE: %', v_item.nombre_snap;
    END IF;

    IF v_item.cantidad <= 0 THEN
      RAISE EXCEPTION 'CANTIDAD_INVALIDA: %', v_item.nombre_snap;
    END IF;

    IF v_egreso THEN
      v_nuevo_stock := ROUND((COALESCE(v_producto.stock_actual, 0) - v_item.cantidad)::NUMERIC, 4);

      UPDATE public.productos
      SET stock_actual = v_nuevo_stock,
          actualizado_en = now()
      WHERE id = v_producto.id;

      INSERT INTO public.inventario_movimientos (
        lote_id, tipo, motivo, motivo_tipo,
        producto_id, producto_nombre, cantidad,
        stock_anterior, stock_nuevo,
        usuario_id, usuario_nombre, usuario_color, cuenta_id
      ) VALUES (
        v_lote_id,
        'egreso',
        CASE
          WHEN v_nuevo_stock < 0 THEN 'Despacho #' || v_despacho.numero || ' entregado directo [STOCK NEGATIVO]'
          ELSE 'Despacho #' || v_despacho.numero || ' entregado directo'
        END,
        'venta',
        v_producto.id,
        COALESCE(v_item.nombre_snap, v_producto.nombre),
        v_item.cantidad,
        COALESCE(v_producto.stock_actual, 0),
        v_nuevo_stock,
        v_usuario_fk,
        trim(p_usuario_nombre),
        p_usuario_color,
        v_producto.cuenta_id
      );

      v_movimientos := v_movimientos + 1;

      v_nivel := CASE
        WHEN v_nuevo_stock < 0 THEN 'NEGATIVO'
        WHEN v_nuevo_stock < COALESCE(v_producto.stock_minimo, 0) THEN 'BAJO'
        ELSE NULL
      END;
      IF v_nivel IS NOT NULL THEN
        v_con_alertas := TRUE;
        v_alertas := v_alertas || jsonb_build_object(
          'producto_id',   v_producto.id,
          'nombre',        v_producto.nombre,
          'cantidad',      v_item.cantidad,
          'stock_antes',   COALESCE(v_producto.stock_actual, 0),
          'stock_despues', v_nuevo_stock,
          'nivel',         v_nivel
        );
      END IF;
    END IF;
  END LOOP;

  UPDATE public.notas_despacho
  SET estado = 'entregada',
      despachada_en = COALESCE(despachada_en, now()),
      entregada_en = now(),
      tasa_snapshot = COALESCE(p_tasa_snapshot, tasa_snapshot),
      egreso_lote_id = CASE WHEN v_egreso THEN v_lote_id ELSE egreso_lote_id END,
      alerta_stock = CASE WHEN v_egreso THEN v_con_alertas ELSE alerta_stock END,
      alerta_stock_items = CASE
        WHEN v_egreso THEN (CASE WHEN v_con_alertas THEN v_alertas ELSE NULL END)
        ELSE alerta_stock_items
      END
  WHERE id = p_despacho_id;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'despacho_id', p_despacho_id,
    'lote_id', v_lote_id,
    'movimientos', v_movimientos,
    'inventario', CASE WHEN v_egreso THEN 'egreso_directo' ELSE 'sin_movimiento' END,
    'stock_descontado_al_aprobar', NOT v_egreso,
    'alertas_stock', v_alertas,
    'alerta_stock', v_con_alertas
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.sincronizar_prestamos_despacho(
  p_despacho_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_despacho        RECORD;
  v_item            RECORD;
  v_existing        RECORD;
  v_tiene_prestamos BOOLEAN := FALSE;
BEGIN
  SELECT * INTO v_despacho FROM public.notas_despacho WHERE id = p_despacho_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_despacho.estado IN ('despachada', 'entregada') THEN
    IF EXISTS (
      SELECT 1
      FROM public.cliente_prestamos cp
      WHERE cp.despacho_id = p_despacho_id
        AND (COALESCE(cp.cantidad_devuelta, 0) > 0 OR COALESCE(cp.cantidad_facturada, 0) > 0)
        AND cp.despacho_item_id NOT IN (
          SELECT id FROM public.notas_despacho_items
          WHERE despacho_id = p_despacho_id AND es_prestamo = TRUE
        )
    ) THEN
      RAISE EXCEPTION 'PRESTAMO_YA_TIENE_DEVOLUCIONES_O_FACTURAS: No se puede eliminar un préstamo con devoluciones o facturaciones registradas';
    END IF;

    DELETE FROM public.cliente_prestamos cp
    WHERE cp.despacho_id = p_despacho_id
      AND cp.despacho_item_id NOT IN (
        SELECT id FROM public.notas_despacho_items
        WHERE despacho_id = p_despacho_id AND es_prestamo = TRUE
      );

    FOR v_item IN
      SELECT * FROM public.notas_despacho_items
      WHERE despacho_id = p_despacho_id AND es_prestamo = TRUE
    LOOP
      SELECT id, cantidad_devuelta, cantidad_facturada
      INTO v_existing
      FROM public.cliente_prestamos
      WHERE despacho_item_id = v_item.id;

      IF FOUND AND v_item.cantidad < COALESCE(v_existing.cantidad_devuelta, 0) + COALESCE(v_existing.cantidad_facturada, 0) THEN
        RAISE EXCEPTION 'PRESTAMO_CANTIDAD_MENOR_A_MOVIMIENTOS: No se puede reducir el préstamo por debajo de lo ya devuelto o facturado';
      END IF;

      INSERT INTO public.cliente_prestamos (
        cliente_id, despacho_item_id, despacho_id, producto_id, cantidad_prestada, estado
      ) VALUES (
        COALESCE(v_despacho.cliente_factura_id, v_despacho.cliente_id),
        v_item.id,
        p_despacho_id,
        v_item.producto_id,
        v_item.cantidad,
        'pendiente'
      )
      ON CONFLICT (despacho_item_id) DO UPDATE SET
        cantidad_prestada = v_item.cantidad,
        cliente_id = COALESCE(v_despacho.cliente_factura_id, v_despacho.cliente_id),
        estado = CASE
          WHEN COALESCE(public.cliente_prestamos.cantidad_devuelta, 0) + COALESCE(public.cliente_prestamos.cantidad_facturada, 0) >= v_item.cantidad - 0.0001
            THEN CASE WHEN COALESCE(public.cliente_prestamos.cantidad_facturada, 0) > 0 THEN 'facturado' ELSE 'devuelto' END
          WHEN COALESCE(public.cliente_prestamos.cantidad_devuelta, 0) > 0
            THEN 'devuelto_parcial'
          ELSE 'pendiente'
        END;
    END LOOP;

  ELSE
    PERFORM public.verificar_prestamos_despacho_reaperturable(p_despacho_id);
    DELETE FROM public.cliente_prestamos WHERE despacho_id = p_despacho_id;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.notas_despacho_items
    WHERE despacho_id = p_despacho_id AND es_prestamo = TRUE
  ) INTO v_tiene_prestamos;

  UPDATE public.notas_despacho
  SET tiene_prestamos = v_tiene_prestamos
  WHERE id = p_despacho_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.devolver_prestamo_inventario_atomico(
  p_cuenta_id uuid,
  p_prestamo_id uuid,
  p_cantidad numeric,
  p_usuario_id uuid,
  p_usuario_nombre text DEFAULT NULL::text,
  p_usuario_color text DEFAULT NULL::text,
  p_idempotency_key uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_prestamo        RECORD;
  v_producto        RECORD;
  v_actor_id        UUID;
  v_actor_nombre    TEXT;
  v_actor_color     TEXT;
  v_restante        NUMERIC(12,4);
  v_nueva_devuelta  NUMERIC(12,4);
  v_nuevo_estado    TEXT := 'pendiente';
  v_nuevo_stock     NUMERIC(12,4);
  v_lote_id         UUID := gen_random_uuid();
  v_movimiento_num  INTEGER;
  v_guard           JSONB;
  v_resultado       JSONB;
BEGIN
  IF p_cuenta_id IS NULL OR p_prestamo_id IS NULL
     OR p_cantidad IS NULL OR p_cantidad <= 0 OR p_usuario_id IS NULL THEN
    RAISE EXCEPTION 'PARAMETROS_DEVOLUCION_PRESTAMO_INVALIDOS';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_OBLIGATORIA';
  END IF;

  v_guard := public.reservar_operacion_inventario(
    p_cuenta_id, p_idempotency_key, 'loan_return'
  );
  IF COALESCE((v_guard->>'existente')::BOOLEAN, FALSE) THEN
    IF v_guard->'resultado' IS NULL OR v_guard->'resultado' = 'null'::JSONB THEN
      RAISE EXCEPTION 'OPERACION_IDEMPOTENTE_SIN_RESULTADO';
    END IF;
    RETURN (v_guard->'resultado') || jsonb_build_object('idempotent', TRUE);
  END IF;

  SELECT u.id, u.nombre, u.color
  INTO v_actor_id, v_actor_nombre, v_actor_color
  FROM public.usuarios u
  WHERE u.id = p_usuario_id AND u.activo = TRUE AND u.cuenta_id = p_cuenta_id
  LIMIT 1;
  IF v_actor_id IS NULL THEN
    SELECT u.id, u.nombre, u.color
    INTO v_actor_id, v_actor_nombre, v_actor_color
    FROM public.usuarios u
    WHERE u.activo = TRUE AND u.cuenta_id = p_cuenta_id
      AND u.rol IN ('supervisor', 'administracion', 'jefe', 'desarrollador')
    ORDER BY u.nombre, u.id LIMIT 1;
  END IF;
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'USUARIO_KARDEX_NO_ENCONTRADO'; END IF;

  SELECT cp.*, nd.numero AS despacho_numero,
         nd.cuenta_id AS despacho_cuenta_id,
         c.cuenta_id AS cliente_cuenta_id
  INTO v_prestamo
  FROM public.cliente_prestamos cp
  LEFT JOIN public.notas_despacho nd ON nd.id = cp.despacho_id
  LEFT JOIN public.clientes c ON c.id = cp.cliente_id
  WHERE cp.id = p_prestamo_id
    AND (nd.cuenta_id = p_cuenta_id OR c.cuenta_id = p_cuenta_id)
  FOR UPDATE OF cp;

  IF NOT FOUND THEN RAISE EXCEPTION 'PRESTAMO_NO_ENCONTRADO'; END IF;

  v_restante := GREATEST(0,
    COALESCE(v_prestamo.cantidad_prestada, 0)
    - COALESCE(v_prestamo.cantidad_devuelta, 0)
    - COALESCE(v_prestamo.cantidad_facturada, 0));
  IF p_cantidad > v_restante + 0.0001 THEN
    RAISE EXCEPTION 'SALDO_PRESTAMO_INVALIDO: disponible %, solicitado %', v_restante, p_cantidad;
  END IF;

  v_nueva_devuelta := COALESCE(v_prestamo.cantidad_devuelta, 0) + p_cantidad;
  IF v_nueva_devuelta + COALESCE(v_prestamo.cantidad_facturada, 0)
      >= COALESCE(v_prestamo.cantidad_prestada, 0) - 0.0001 THEN
    v_nuevo_estado := 'devuelto';
  ELSIF v_nueva_devuelta > 0 THEN
    v_nuevo_estado := 'devuelto_parcial';
  END IF;

  IF v_prestamo.producto_id IS NOT NULL THEN
    SELECT p.id, p.nombre, p.stock_actual, p.activo, p.cuenta_id
    INTO v_producto
    FROM public.productos p
    WHERE p.id = v_prestamo.producto_id AND p.cuenta_id = p_cuenta_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'PRODUCTO_PRESTAMO_NO_DISPONIBLE';
    END IF;

    v_nuevo_stock := ROUND((COALESCE(v_producto.stock_actual, 0) + p_cantidad)::NUMERIC, 4);
    UPDATE public.productos SET stock_actual = v_nuevo_stock, actualizado_en = now()
    WHERE id = v_producto.id;

    INSERT INTO public.inventario_movimientos (
      lote_id, tipo, motivo, motivo_tipo, producto_id, producto_nombre,
      cantidad, stock_anterior, stock_nuevo, usuario_id, usuario_nombre,
      usuario_color, cuenta_id, origen_tipo, origen_id, origen_referencia,
      idempotency_key
    ) VALUES (
      v_lote_id, 'ingreso',
      'Devolución de préstamo — Despacho #' || COALESCE(v_prestamo.despacho_numero::TEXT, 'N/A'),
      'devolucion', v_producto.id, v_producto.nombre, ROUND(p_cantidad::NUMERIC, 4),
      v_producto.stock_actual, v_nuevo_stock, v_actor_id,
      COALESCE(NULLIF(btrim(p_usuario_nombre), ''), v_actor_nombre),
      COALESCE(p_usuario_color, v_actor_color), p_cuenta_id,
      'loan_return', p_prestamo_id,
      'idempotency:' || COALESCE(p_idempotency_key::TEXT, v_lote_id::TEXT),
      p_idempotency_key
    ) RETURNING numero INTO v_movimiento_num;
  END IF;

  UPDATE public.cliente_prestamos
  SET cantidad_devuelta = v_nueva_devuelta, estado = v_nuevo_estado
  WHERE id = p_prestamo_id;

  v_resultado := jsonb_build_object(
    'ok', TRUE, 'prestamo_id', p_prestamo_id,
    'nuevo_estado', v_nuevo_estado, 'cantidad_devuelta', v_nueva_devuelta,
    'lote_id', CASE WHEN v_prestamo.producto_id IS NOT NULL THEN v_lote_id ELSE NULL END,
    'numero', v_movimiento_num, 'idempotency_key', p_idempotency_key
  );
  PERFORM public.guardar_operacion_inventario(p_cuenta_id, p_idempotency_key, v_resultado);
  RETURN v_resultado;
END
$function$;

CREATE OR REPLACE FUNCTION public.revertir_despacho_inventario_atomica(
  p_despacho_id uuid,
  p_nuevo_estado text,
  p_usuario_id uuid,
  p_usuario_nombre text,
  p_usuario_color text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_despacho    RECORD;
  v_producto    RECORD;
  v_item        RECORD;
  v_lote_id     UUID := gen_random_uuid();
  v_movimientos INTEGER := 0;
  v_nuevo_stock NUMERIC(12,4);
  v_usuario_fk  UUID;
BEGIN
  IF p_despacho_id IS NULL OR p_nuevo_estado NOT IN ('pendiente', 'anulada') THEN
    RAISE EXCEPTION 'PARAMETROS_REVERSA_DESPACHO_INVALIDOS';
  END IF;

  IF p_usuario_id IS NULL OR p_usuario_nombre IS NULL OR char_length(trim(p_usuario_nombre)) = 0 THEN
    RAISE EXCEPTION 'USUARIO_AUDITORIA_OBLIGATORIO';
  END IF;

  SELECT *
  INTO v_despacho
  FROM public.notas_despacho
  WHERE id = p_despacho_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DESPACHO_NO_ENCONTRADO';
  END IF;

  IF v_despacho.estado <> 'despachada' THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO: Solo se puede revertir un despacho aprobado (estado actual: %)', v_despacho.estado;
  END IF;

  PERFORM public.verificar_prestamos_despacho_reaperturable(p_despacho_id);

  SELECT u.id INTO v_usuario_fk
  FROM public.usuarios u
  WHERE u.id = p_usuario_id AND u.activo = TRUE
    AND (v_despacho.cuenta_id IS NULL OR u.cuenta_id = v_despacho.cuenta_id)
  LIMIT 1;
  IF v_usuario_fk IS NULL THEN
    SELECT u.id INTO v_usuario_fk
    FROM public.usuarios u
    WHERE u.activo = TRUE
      AND (v_despacho.cuenta_id IS NULL OR u.cuenta_id = v_despacho.cuenta_id)
      AND u.rol IN ('supervisor', 'administracion', 'jefe', 'desarrollador')
    ORDER BY u.nombre LIMIT 1;
  END IF;
  IF v_usuario_fk IS NULL THEN
    RAISE EXCEPTION 'USUARIO_KARDEX_NO_ENCONTRADO';
  END IF;

  FOR v_item IN
    SELECT producto_id, nombre_snap, cantidad
    FROM public.obtener_items_netos_despacho(p_despacho_id)
  LOOP
    SELECT id, nombre, stock_actual, activo, cuenta_id
    INTO v_producto
    FROM public.productos
    WHERE id = v_item.producto_id
      AND (v_despacho.cuenta_id IS NULL OR cuenta_id = v_despacho.cuenta_id)
    FOR UPDATE;

    -- N33: Permitir reingreso aunque el producto esté archivado (activo = FALSE).
    IF NOT FOUND THEN
      RAISE EXCEPTION 'PRODUCTO_NO_DISPONIBLE: %', v_item.nombre_snap;
    END IF;

    v_nuevo_stock := ROUND((COALESCE(v_producto.stock_actual, 0) + v_item.cantidad)::NUMERIC, 4);

    UPDATE public.productos
    SET stock_actual = v_nuevo_stock,
        actualizado_en = now()
    WHERE id = v_producto.id;

    INSERT INTO public.inventario_movimientos (
      lote_id, tipo, motivo, motivo_tipo,
      producto_id, producto_nombre, cantidad,
      stock_anterior, stock_nuevo,
      usuario_id, usuario_nombre, usuario_color, cuenta_id
    ) VALUES (
      v_lote_id,
      'ingreso',
      CASE
        WHEN p_nuevo_estado = 'anulada' THEN 'Anulación de despacho #' || v_despacho.numero
        ELSE 'Despacho #' || v_despacho.numero || ' devuelto a pendiente'
      END,
      'venta',
      v_producto.id,
      COALESCE(v_item.nombre_snap, v_producto.nombre),
      v_item.cantidad,
      COALESCE(v_producto.stock_actual, 0),
      v_nuevo_stock,
      v_usuario_fk,
      trim(p_usuario_nombre),
      p_usuario_color,
      v_producto.cuenta_id
    );

    v_movimientos := v_movimientos + 1;
  END LOOP;

  UPDATE public.notas_despacho
  SET estado = p_nuevo_estado,
      entregada_en = NULL,
      alerta_stock = FALSE,
      alerta_stock_items = NULL,
      egreso_lote_id = NULL
  WHERE id = p_despacho_id;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'despacho_id', p_despacho_id,
    'nuevo_estado', p_nuevo_estado,
    'lote_id', v_lote_id,
    'movimientos', v_movimientos,
    'reingreso_aplicado', TRUE
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.revertir_entrega_inventario_atomica(
  p_despacho_id uuid,
  p_nuevo_estado text,
  p_usuario_id uuid,
  p_usuario_nombre text,
  p_usuario_color text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_despacho    RECORD;
  v_producto    RECORD;
  v_item        RECORD;
  v_lote_id     UUID := gen_random_uuid();
  v_movimientos INTEGER := 0;
  v_nuevo_stock NUMERIC(12,4);
  v_reingreso   BOOLEAN := p_nuevo_estado IN ('pendiente', 'anulada');
  v_usuario_fk  UUID;
BEGIN
  IF p_despacho_id IS NULL OR p_nuevo_estado NOT IN ('pendiente', 'despachada', 'anulada') THEN
    RAISE EXCEPTION 'PARAMETROS_REVERSA_INVALIDOS';
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

  IF p_usuario_id IS NULL OR p_usuario_nombre IS NULL OR char_length(trim(p_usuario_nombre)) = 0 THEN
    RAISE EXCEPTION 'USUARIO_AUDITORIA_OBLIGATORIO';
  END IF;

  IF v_reingreso THEN
    PERFORM public.verificar_prestamos_despacho_reaperturable(p_despacho_id);

    SELECT u.id INTO v_usuario_fk
    FROM public.usuarios u
    WHERE u.id = p_usuario_id AND u.activo = TRUE
      AND (v_despacho.cuenta_id IS NULL OR u.cuenta_id = v_despacho.cuenta_id)
    LIMIT 1;
    IF v_usuario_fk IS NULL THEN
      SELECT u.id INTO v_usuario_fk
      FROM public.usuarios u
      WHERE u.activo = TRUE
        AND (v_despacho.cuenta_id IS NULL OR u.cuenta_id = v_despacho.cuenta_id)
        AND u.rol IN ('supervisor', 'administracion', 'jefe', 'desarrollador')
      ORDER BY u.nombre LIMIT 1;
    END IF;
    IF v_usuario_fk IS NULL THEN
      RAISE EXCEPTION 'USUARIO_KARDEX_NO_ENCONTRADO';
    END IF;

    FOR v_item IN
      SELECT producto_id, nombre_snap, cantidad
      FROM public.obtener_items_netos_despacho(p_despacho_id)
    LOOP
      SELECT id, nombre, stock_actual, activo, cuenta_id
      INTO v_producto
      FROM public.productos
      WHERE id = v_item.producto_id
        AND (v_despacho.cuenta_id IS NULL OR cuenta_id = v_despacho.cuenta_id)
      FOR UPDATE;

      -- N33: Permitir reingreso aunque el producto esté archivado (activo = FALSE).
      IF NOT FOUND THEN
        RAISE EXCEPTION 'PRODUCTO_NO_DISPONIBLE: %', v_item.nombre_snap;
      END IF;

      v_nuevo_stock := ROUND((COALESCE(v_producto.stock_actual, 0) + v_item.cantidad)::NUMERIC, 4);

      UPDATE public.productos
      SET stock_actual = v_nuevo_stock,
          actualizado_en = now()
      WHERE id = v_producto.id;

      INSERT INTO public.inventario_movimientos (
        lote_id, tipo, motivo, motivo_tipo,
        producto_id, producto_nombre, cantidad,
        stock_anterior, stock_nuevo,
        usuario_id, usuario_nombre, usuario_color, cuenta_id
      ) VALUES (
        v_lote_id,
        'ingreso',
        CASE
          WHEN p_nuevo_estado = 'anulada' THEN 'Anulación de despacho #' || v_despacho.numero
          ELSE 'Devolución a pendiente #' || v_despacho.numero
        END,
        'venta',
        v_producto.id,
        COALESCE(v_item.nombre_snap, v_producto.nombre),
        v_item.cantidad,
        COALESCE(v_producto.stock_actual, 0),
        v_nuevo_stock,
        v_usuario_fk,
        trim(p_usuario_nombre),
        p_usuario_color,
        v_producto.cuenta_id
      );

      v_movimientos := v_movimientos + 1;
    END LOOP;
  END IF;

  UPDATE public.notas_despacho
  SET estado = p_nuevo_estado,
      entregada_en = NULL,
      alerta_stock = CASE WHEN v_reingreso THEN FALSE ELSE alerta_stock END,
      alerta_stock_items = CASE WHEN v_reingreso THEN NULL ELSE alerta_stock_items END,
      egreso_lote_id = CASE WHEN v_reingreso THEN NULL ELSE egreso_lote_id END
  WHERE id = p_despacho_id;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'despacho_id', p_despacho_id,
    'nuevo_estado', p_nuevo_estado,
    'lote_id', v_lote_id,
    'movimientos', v_movimientos,
    'reingreso_aplicado', v_reingreso
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.editar_despacho_profundidad(
  p_despacho_id uuid,
  p_nuevos_items jsonb,
  p_usuario_id uuid DEFAULT NULL::uuid,
  p_usuario_nombre text DEFAULT 'Sistema'::text,
  p_usuario_rol text DEFAULT 'sistema'::text,
  p_forma_pago text DEFAULT NULL::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_despacho     record;
  v_operador     record;
  v_item_json    record;
  v_producto     record;
  v_delta        record;
  v_origen       text;
  v_total_items  numeric(12,4) := 0;
  v_total_nuevo  numeric(12,4);
  v_estado       text;
  v_lote_id      uuid;
  v_nuevo_stock  numeric(12,4);
  v_mapa_viejo   jsonb := '{}'::jsonb;
  v_mapa_nuevo   jsonb := '{}'::jsonb;
  v_nivel        text;
  v_alertas      jsonb := '[]'::jsonb;
  v_con_alertas  boolean := false;
BEGIN
  IF p_despacho_id IS NULL THEN
    RAISE EXCEPTION 'DESPACHO_ID_OBLIGATORIO';
  END IF;

  IF p_nuevos_items IS NULL
     OR jsonb_typeof(p_nuevos_items) <> 'array'
     OR jsonb_array_length(p_nuevos_items) = 0 THEN
    RAISE EXCEPTION 'ITEMS_INVALIDOS: Debe proporcionar al menos un item';
  END IF;

  SELECT id, cuenta_id, rol, activo, nombre
    INTO v_operador
  FROM public.usuarios
  WHERE id = p_usuario_id;

  IF NOT FOUND OR COALESCE(v_operador.activo, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'ACCESO_DENEGADO: Operador invalido o inactivo';
  END IF;

  IF v_operador.rol NOT IN (
    'administracion',
    'jefe',
    'desarrollador',
    'vendedor',
    'vendedor_sin_comision'
  ) THEN
    RAISE EXCEPTION
      'ACCESO_DENEGADO: Rol no autorizado para editar despachos a profundidad';
  END IF;

  IF p_usuario_rol IS DISTINCT FROM v_operador.rol THEN
    RAISE EXCEPTION
      'ACCESO_DENEGADO: El rol informado no coincide con el operador';
  END IF;

  SELECT *
    INTO v_despacho
  FROM public.notas_despacho
  WHERE id = p_despacho_id
    AND cuenta_id = v_operador.cuenta_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DESPACHO_NO_ENCONTRADO';
  END IF;

  v_estado := v_despacho.estado;
  IF v_estado NOT IN ('pendiente', 'despachada') THEN
    RAISE EXCEPTION
      'ESTADO_INVALIDO: Solo se puede editar un despacho pendiente o aprobado';
  END IF;

  IF v_operador.rol IN ('vendedor', 'vendedor_sin_comision') THEN
    IF v_despacho.vendedor_id IS DISTINCT FROM v_operador.id THEN
      RAISE EXCEPTION 'ACCESO_DENEGADO: El vendedor solo puede editar sus propios despachos';
    END IF;
    IF v_estado <> 'pendiente' THEN
      RAISE EXCEPTION 'ESTADO_INVALIDO: El vendedor solo puede editar despachos que esperan aprobacion';
    END IF;
  END IF;

  IF v_estado = 'despachada' THEN
    PERFORM public.verificar_prestamos_despacho_reaperturable(p_despacho_id);
  END IF;

  PERFORM public.validar_items_despacho_sin_duplicados(p_nuevos_items);

  FOR v_item_json IN
    SELECT *
    FROM jsonb_to_recordset(p_nuevos_items) AS x(
      producto_id uuid,
      codigo_snap text,
      nombre_snap text,
      unidad_snap text,
      cantidad numeric,
      precio_unit_usd numeric,
      descuento_pct numeric,
      orden integer,
      origen text,
      es_prestamo boolean
    )
  LOOP
    IF v_item_json.nombre_snap IS NULL
       OR trim(v_item_json.nombre_snap) = '' THEN
      RAISE EXCEPTION 'ITEM_INVALIDO: El nombre del producto es obligatorio';
    END IF;

    IF v_item_json.cantidad IS NULL
       OR v_item_json.cantidad <= 0 THEN
      RAISE EXCEPTION 'ITEM_INVALIDO: La cantidad debe ser mayor que cero';
    END IF;

    IF v_item_json.precio_unit_usd IS NULL
       OR v_item_json.precio_unit_usd < 0 THEN
      RAISE EXCEPTION 'ITEM_INVALIDO: El precio no puede ser negativo';
    END IF;

    IF COALESCE(v_item_json.descuento_pct, 0) < 0
       OR COALESCE(v_item_json.descuento_pct, 0) > 100 THEN
      RAISE EXCEPTION 'ITEM_INVALIDO: Descuento fuera de rango';
    END IF;

    v_origen := COALESCE(
      NULLIF(trim(v_item_json.origen), ''),
      CASE WHEN v_item_json.producto_id IS NULL THEN 'externo' ELSE 'inventario' END
    );

    IF v_origen NOT IN ('inventario', 'externo') THEN
      RAISE EXCEPTION 'ITEM_INVALIDO: Origen no permitido';
    END IF;

    IF v_item_json.producto_id IS NULL
       AND v_origen <> 'externo' THEN
      RAISE EXCEPTION
        'ITEM_INVALIDO: Una linea sin producto_id debe ser externa';
    END IF;

    IF v_item_json.producto_id IS NOT NULL THEN
      SELECT id, cuenta_id, activo
        INTO v_producto
      FROM public.productos
      WHERE id = v_item_json.producto_id;

      IF NOT FOUND
         OR v_producto.cuenta_id IS DISTINCT FROM v_despacho.cuenta_id
         OR v_producto.activo IS NOT TRUE THEN
        RAISE EXCEPTION
          'PRODUCTO_INVALIDO: Producto no disponible en la cuenta del despacho';
      END IF;
    END IF;
  END LOOP;

  SELECT COALESCE(jsonb_object_agg(t.producto_id::text, t.cantidad), '{}'::jsonb)
    INTO v_mapa_viejo
  FROM public.obtener_items_netos_despacho(p_despacho_id) t;

  DELETE FROM public.notas_despacho_items
  WHERE despacho_id = p_despacho_id;

  FOR v_item_json IN
    SELECT *
    FROM jsonb_to_recordset(p_nuevos_items) AS x(
      producto_id uuid,
      codigo_snap text,
      nombre_snap text,
      unidad_snap text,
      cantidad numeric,
      precio_unit_usd numeric,
      descuento_pct numeric,
      orden integer,
      origen text,
      es_prestamo boolean
    )
  LOOP
    v_origen := COALESCE(
      NULLIF(trim(v_item_json.origen), ''),
      CASE WHEN v_item_json.producto_id IS NULL THEN 'externo' ELSE 'inventario' END
    );

    INSERT INTO public.notas_despacho_items (
      despacho_id,
      producto_id,
      codigo_snap,
      nombre_snap,
      unidad_snap,
      cantidad_original,
      precio_original,
      cantidad,
      precio_unit_usd,
      descuento_pct,
      total_linea_usd,
      orden,
      origen,
      es_prestamo,
      cuenta_id,
      editado_en,
      editado_por
    ) VALUES (
      p_despacho_id,
      v_item_json.producto_id,
      v_item_json.codigo_snap,
      v_item_json.nombre_snap,
      COALESCE(v_item_json.unidad_snap, 'und'),
      v_item_json.cantidad,
      v_item_json.precio_unit_usd,
      v_item_json.cantidad,
      v_item_json.precio_unit_usd,
      COALESCE(v_item_json.descuento_pct, 0),
      CASE
        WHEN COALESCE(v_item_json.es_prestamo, false) THEN 0.0000
        ELSE v_item_json.cantidad * v_item_json.precio_unit_usd
          * (1 - COALESCE(v_item_json.descuento_pct, 0) / 100)
      END,
      COALESCE(v_item_json.orden, 0),
      v_origen,
      COALESCE(v_item_json.es_prestamo, false),
      v_despacho.cuenta_id,
      now(),
      p_usuario_id
    );

    IF NOT COALESCE(v_item_json.es_prestamo, false) THEN
      v_total_items := v_total_items
        + v_item_json.cantidad * v_item_json.precio_unit_usd
        * (1 - COALESCE(v_item_json.descuento_pct, 0) / 100);
    END IF;
  END LOOP;

  -- N27: el nuevo consolidado incluye líneas con es_prestamo = TRUE.
  SELECT COALESCE(jsonb_object_agg(t.producto_id, t.cantidad), '{}'::jsonb)
    INTO v_mapa_nuevo
  FROM (
    SELECT ndi.producto_id::text AS producto_id,
           ROUND(SUM(ndi.cantidad), 4)::NUMERIC(12,4) AS cantidad
    FROM public.notas_despacho_items ndi
    WHERE ndi.despacho_id = p_despacho_id
      AND ndi.producto_id IS NOT NULL
      AND COALESCE(ndi.origen, 'inventario') = 'inventario'
    GROUP BY ndi.producto_id
  ) t;

  IF v_estado = 'despachada' THEN
    v_lote_id := gen_random_uuid();

    FOR v_delta IN
      SELECT
        clave AS producto_id,
        COALESCE((v_mapa_nuevo ->> clave)::NUMERIC, 0)
          - COALESCE((v_mapa_viejo ->> clave)::NUMERIC, 0) AS delta
      FROM jsonb_object_keys(v_mapa_viejo || v_mapa_nuevo) AS clave
    LOOP
      IF COALESCE(v_delta.delta, 0) = 0 THEN
        CONTINUE;
      END IF;

      SELECT id, nombre, stock_actual, stock_minimo, activo, cuenta_id
        INTO v_producto
      FROM public.productos
      WHERE id = v_delta.producto_id::uuid
        AND (v_despacho.cuenta_id IS NULL OR cuenta_id = v_despacho.cuenta_id)
      FOR UPDATE;

      -- N33: Permitir reingreso (delta < 0) de productos archivados si se retiran del despacho.
      IF NOT FOUND OR (v_delta.delta > 0 AND v_producto.activo IS NOT TRUE) THEN
        RAISE EXCEPTION 'PRODUCTO_NO_DISPONIBLE: %', v_delta.producto_id;
      END IF;

      v_nuevo_stock := ROUND((COALESCE(v_producto.stock_actual, 0) - v_delta.delta)::NUMERIC, 4);

      UPDATE public.productos
      SET stock_actual = v_nuevo_stock,
          actualizado_en = now()
      WHERE id = v_producto.id;

      INSERT INTO public.inventario_movimientos (
        lote_id,
        tipo,
        motivo,
        motivo_tipo,
        producto_id,
        producto_nombre,
        cantidad,
        stock_anterior,
        stock_nuevo,
        usuario_id,
        usuario_nombre,
        usuario_color,
        cuenta_id
      ) VALUES (
        v_lote_id,
        (CASE WHEN v_delta.delta > 0 THEN 'egreso' ELSE 'ingreso' END)::tipo_movimiento,
        'Edición de ítems Despacho #' || v_despacho.numero || ' (ajuste)',
        'venta',
        v_producto.id,
        v_producto.nombre,
        ABS(v_delta.delta),
        COALESCE(v_producto.stock_actual, 0),
        v_nuevo_stock,
        p_usuario_id,
        COALESCE(trim(p_usuario_nombre), v_operador.nombre),
        NULL,
        v_producto.cuenta_id
      );
    END LOOP;

    FOR v_delta IN
      SELECT clave AS producto_id, (v_mapa_nuevo ->> clave)::NUMERIC AS cantidad
      FROM jsonb_object_keys(v_mapa_nuevo) AS clave
    LOOP
      SELECT id, nombre, stock_actual, stock_minimo
        INTO v_producto
      FROM public.productos
      WHERE id = v_delta.producto_id::uuid;

      IF FOUND THEN
        v_nivel := CASE
          WHEN COALESCE(v_producto.stock_actual, 0) < 0 THEN 'NEGATIVO'
          WHEN COALESCE(v_producto.stock_actual, 0) < COALESCE(v_producto.stock_minimo, 0) THEN 'BAJO'
          ELSE NULL
        END;
        IF v_nivel IS NOT NULL THEN
          v_con_alertas := TRUE;
          v_alertas := v_alertas || jsonb_build_object(
            'producto_id',   v_producto.id,
            'nombre',        v_producto.nombre,
            'cantidad',      v_delta.cantidad,
            'stock_despues', COALESCE(v_producto.stock_actual, 0),
            'nivel',         v_nivel
          );
        END IF;
      END IF;
    END LOOP;
  END IF;

  v_total_nuevo := round(
    v_total_items
      + COALESCE(v_despacho.flete_usd, 0)
      + COALESCE(v_despacho.corte_usd, 0)
      - COALESCE(v_despacho.descuento_total_usd, 0),
    4
  );

  UPDATE public.notas_despacho
  SET total_usd = v_total_nuevo,
      forma_pago_cliente = COALESCE(p_forma_pago, forma_pago_cliente),
      forma_pago = COALESCE(p_forma_pago, forma_pago),
      items_editado_en = now(),
      items_editado_por = COALESCE(p_usuario_nombre, v_operador.nombre),
      alerta_stock = CASE WHEN v_estado = 'despachada' THEN v_con_alertas ELSE alerta_stock END,
      alerta_stock_items = CASE
        WHEN v_estado = 'despachada' THEN (CASE WHEN v_con_alertas THEN v_alertas ELSE NULL END)
        ELSE alerta_stock_items
      END,
      actualizado_en = now()
  WHERE id = p_despacho_id
    AND cuenta_id = v_despacho.cuenta_id;

  PERFORM public.registrar_auditoria(
    p_usuario_id     := p_usuario_id,
    p_usuario_nombre := COALESCE(p_usuario_nombre, v_operador.nombre),
    p_usuario_rol    := p_usuario_rol,
    p_categoria      := 'COTIZACION',
    p_accion         := 'EDITAR_DESPACHO_PROFUNDIDAD',
    p_entidad_tipo   := 'nota_despacho',
    p_entidad_id     := p_despacho_id,
    p_meta           := jsonb_build_object(
      'total_anterior', v_despacho.total_usd,
      'total_nuevo',    v_total_nuevo,
      'estado',         v_estado
    )
  );
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

CREATE OR REPLACE FUNCTION public.registrar_devolucion_inventario_atomica(
  p_despacho_id uuid,
  p_devoluciones jsonb,
  p_intercambios jsonb DEFAULT '[]'::jsonb,
  p_motivo text DEFAULT NULL::text,
  p_usuario_id uuid DEFAULT NULL::uuid,
  p_usuario_nombre text DEFAULT NULL::text,
  p_usuario_color text DEFAULT NULL::text,
  p_cotizacion_reemplazo_id uuid DEFAULT NULL::uuid,
  p_total_devuelto_usd numeric DEFAULT 0,
  p_total_intercambio_usd numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_despacho       RECORD;
  v_ndi            RECORD;
  v_producto       RECORD;
  v_usuario_fk     UUID;
  v_item           RECORD;
  v_delta          RECORD;
  v_lote_id        UUID := gen_random_uuid();
  v_allow_negative BOOLEAN := FALSE;
  v_nuevo_stock    NUMERIC(12,4);
  v_nuevo_total    NUMERIC(12,4);
  v_movimientos    INTEGER := 0;
  v_desp_ref       TEXT;
BEGIN
  IF p_despacho_id IS NULL
     OR p_devoluciones IS NULL
     OR jsonb_typeof(p_devoluciones) <> 'array'
     OR jsonb_array_length(p_devoluciones) = 0
     OR p_motivo IS NULL
     OR char_length(trim(p_motivo)) = 0
     OR p_usuario_id IS NULL
     OR p_usuario_nombre IS NULL
     OR char_length(trim(p_usuario_nombre)) = 0 THEN
    RAISE EXCEPTION 'PARAMETROS_DEVOLUCION_INVALIDOS';
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
    RAISE EXCEPTION 'ESTADO_INVALIDO: El despacho debe estar entregado';
  END IF;

  v_desp_ref := CASE
    WHEN v_despacho.numero IS NOT NULL THEN 'DES-' || lpad(v_despacho.numero::TEXT, 5, '0')
    ELSE p_despacho_id::TEXT
  END;

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
      AND u.rol IN ('supervisor', 'administracion', 'jefe', 'desarrollador')
    ORDER BY u.nombre
    LIMIT 1;
  END IF;

  IF v_usuario_fk IS NULL THEN
    RAISE EXCEPTION 'USUARIO_KARDEX_NO_ENCONTRADO';
  END IF;

  SELECT COALESCE(cn.permitir_stock_negativo, FALSE)
  INTO v_allow_negative
  FROM public.configuracion_negocio cn
  WHERE cn.cuenta_id = v_despacho.cuenta_id
  LIMIT 1;

  CREATE TEMP TABLE tmp_devolucion_deltas (
    producto_id UUID NOT NULL,
    nombre_snap TEXT NOT NULL,
    tipo_operacion TEXT NOT NULL CHECK (tipo_operacion IN ('ingreso', 'egreso')),
    delta NUMERIC(12,4) NOT NULL DEFAULT 0,
    PRIMARY KEY (producto_id, tipo_operacion)
  ) ON COMMIT DROP;

  CREATE TEMP TABLE tmp_devolucion_solicitudes (
    despacho_item_id UUID PRIMARY KEY,
    cantidad NUMERIC(12,4) NOT NULL
  ) ON COMMIT DROP;

  CREATE TEMP TABLE tmp_intercambio_solicitudes (
    producto_id UUID PRIMARY KEY,
    cantidad NUMERIC(12,4) NOT NULL
  ) ON COMMIT DROP;

  FOR v_item IN
    SELECT *
    FROM jsonb_to_recordset(p_devoluciones) AS x(
      despacho_item_id UUID,
      producto_id UUID,
      nombre_snap TEXT,
      codigo_snap TEXT,
      unidad_snap TEXT,
      cantidad_devuelta NUMERIC,
      precio_unit_usd NUMERIC,
      total_devuelto_usd NUMERIC,
      origen TEXT
    )
  LOOP
    IF v_item.cantidad_devuelta IS NULL OR v_item.cantidad_devuelta <= 0 THEN
      RAISE EXCEPTION 'CANTIDAD_DEVOLUCION_INVALIDA: %', v_item.nombre_snap;
    END IF;

    IF v_item.despacho_item_id IS NOT NULL THEN
      SELECT id, producto_id, origen, es_prestamo, cantidad, nombre_snap
      INTO v_ndi
      FROM public.notas_despacho_items
      WHERE id = v_item.despacho_item_id
        AND despacho_id = p_despacho_id;
      IF FOUND AND COALESCE(v_ndi.es_prestamo, FALSE) = TRUE THEN
        RAISE EXCEPTION 'ITEM_PRESTAMO_NO_DEVOLVIBLE_PARCIAL: %', COALESCE(v_ndi.nombre_snap, v_item.nombre_snap);
      END IF;
    END IF;

    IF v_item.producto_id IS NULL THEN
      CONTINUE;
    END IF;

    IF COALESCE(v_item.origen, 'inventario') = 'inventario' THEN
      IF v_item.despacho_item_id IS NULL THEN
        RAISE EXCEPTION 'ITEM_DESPACHO_OBLIGATORIO: %', v_item.nombre_snap;
      END IF;

      INSERT INTO tmp_devolucion_solicitudes (despacho_item_id, cantidad)
      VALUES (v_item.despacho_item_id, v_item.cantidad_devuelta)
      ON CONFLICT (despacho_item_id) DO UPDATE
        SET cantidad = tmp_devolucion_solicitudes.cantidad + EXCLUDED.cantidad;

      IF NOT EXISTS (
        SELECT 1
        FROM public.notas_despacho_items ndi
        WHERE ndi.id = v_item.despacho_item_id
          AND ndi.despacho_id = p_despacho_id
          AND ndi.producto_id = v_item.producto_id
          AND COALESCE(ndi.origen, 'inventario') = 'inventario'
          AND COALESCE(ndi.es_prestamo, FALSE) = FALSE
          AND v_item.cantidad_devuelta <= ndi.cantidad - COALESCE((
            SELECT SUM(dd.cantidad_devuelta)
            FROM public.despacho_devoluciones dd
            WHERE dd.despacho_id = p_despacho_id
              AND dd.despacho_item_id = ndi.id
          ), 0)
      ) THEN
        RAISE EXCEPTION 'SALDO_DEVOLUCION_INVALIDO: %', v_item.nombre_snap;
      END IF;
    ELSIF COALESCE(v_item.origen, '') = 'intercambio' THEN
      INSERT INTO tmp_intercambio_solicitudes (producto_id, cantidad)
      VALUES (v_item.producto_id, v_item.cantidad_devuelta)
      ON CONFLICT (producto_id) DO UPDATE
        SET cantidad = tmp_intercambio_solicitudes.cantidad + EXCLUDED.cantidad;

      IF v_item.cantidad_devuelta > (
        SELECT COALESCE(SUM(di.cantidad), 0)
        FROM public.despacho_devolucion_intercambios di
        WHERE di.despacho_id = p_despacho_id
          AND di.producto_id = v_item.producto_id
      ) - (
        SELECT COALESCE(SUM(dd.cantidad_devuelta), 0)
        FROM public.despacho_devoluciones dd
        WHERE dd.despacho_id = p_despacho_id
          AND dd.despacho_item_id IS NULL
          AND dd.producto_id = v_item.producto_id
      ) THEN
        RAISE EXCEPTION 'SALDO_INTERCAMBIO_INVALIDO: %', v_item.nombre_snap;
      END IF;
    END IF;

    IF COALESCE(v_item.origen, 'inventario') IN ('inventario', 'intercambio') THEN
      INSERT INTO tmp_devolucion_deltas (producto_id, nombre_snap, tipo_operacion, delta)
      VALUES (v_item.producto_id, COALESCE(v_item.nombre_snap, 'Producto'), 'ingreso', v_item.cantidad_devuelta)
      ON CONFLICT (producto_id, tipo_operacion) DO UPDATE
        SET delta = tmp_devolucion_deltas.delta + EXCLUDED.delta;
    END IF;
  END LOOP;

  -- Validaciones de integridad (M4 + OP-2026-095 A6): producto, origen, precio y totales.
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_devoluciones) AS x(despacho_item_id UUID, producto_id UUID, origen TEXT,
         cantidad_devuelta NUMERIC, precio_unit_usd NUMERIC, total_devuelto_usd NUMERIC)
    JOIN public.notas_despacho_items ndi ON ndi.id = x.despacho_item_id AND ndi.despacho_id = p_despacho_id
    WHERE x.producto_id IS DISTINCT FROM ndi.producto_id
       OR COALESCE(x.origen, 'inventario') IS DISTINCT FROM COALESCE(ndi.origen, 'inventario')
  ) THEN
    RAISE EXCEPTION 'DEVOLUCION_NO_COINCIDE_CON_LINEA_DEL_DESPACHO';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_devoluciones) AS x(despacho_item_id UUID, precio_unit_usd NUMERIC)
    JOIN public.notas_despacho_items ndi ON ndi.id = x.despacho_item_id AND ndi.despacho_id = p_despacho_id
    WHERE COALESCE(x.precio_unit_usd, 0) > COALESCE(ndi.precio_unit_usd, 0) + 0.02
  ) THEN
    RAISE EXCEPTION 'PRECIO_DEVOLUCION_SUPERA_DESPACHO';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_devoluciones) AS x(despacho_item_id UUID, cantidad_devuelta NUMERIC,
         precio_unit_usd NUMERIC, total_devuelto_usd NUMERIC)
    WHERE x.despacho_item_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.notas_despacho_items ndi
                      WHERE ndi.id = x.despacho_item_id AND ndi.despacho_id = p_despacho_id)
  ) THEN
    RAISE EXCEPTION 'ITEM_NO_PERTENECE_AL_DESPACHO';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_devoluciones) AS x(cantidad_devuelta NUMERIC, precio_unit_usd NUMERIC, total_devuelto_usd NUMERIC)
    WHERE COALESCE(x.precio_unit_usd, 0) < 0
       OR abs(COALESCE(x.total_devuelto_usd, 0) - ROUND(COALESCE(x.cantidad_devuelta, 0) * COALESCE(x.precio_unit_usd, 0), 4)) > 0.01
  ) THEN
    RAISE EXCEPTION 'TOTAL_DE_FILA_DEVOLUCION_INCONSISTENTE';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(COALESCE(p_intercambios, '[]'::JSONB)) AS x(cantidad NUMERIC, precio_unit_usd NUMERIC, total_usd NUMERIC)
    WHERE COALESCE(x.precio_unit_usd, 0) < 0
       OR abs(COALESCE(x.total_usd, 0) - ROUND(COALESCE(x.cantidad, 0) * COALESCE(x.precio_unit_usd, 0), 4)) > 0.01
  ) THEN
    RAISE EXCEPTION 'TOTAL_DE_FILA_INTERCAMBIO_INCONSISTENTE';
  END IF;

  IF COALESCE(p_total_devuelto_usd, 0) < 0
     OR COALESCE(p_total_devuelto_usd, 0) > (
       SELECT COALESCE(SUM(x.total_devuelto_usd), 0)
       FROM jsonb_to_recordset(p_devoluciones) AS x(total_devuelto_usd NUMERIC)
     ) + 0.01 THEN
    RAISE EXCEPTION 'TOTAL_DEVUELTO_SUPERA_LAS_FILAS';
  END IF;

  IF abs(COALESCE(p_total_intercambio_usd, 0) - (
       SELECT COALESCE(SUM(COALESCE(x.total_usd, 0)), 0)
       FROM jsonb_to_recordset(COALESCE(p_intercambios, '[]'::JSONB)) AS x(total_usd NUMERIC)
     )) > 0.01 THEN
    RAISE EXCEPTION 'TOTAL_INTERCAMBIO_INCONSISTENTE';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM tmp_devolucion_solicitudes s
    JOIN public.notas_despacho_items ndi ON ndi.id = s.despacho_item_id
    WHERE ndi.despacho_id = p_despacho_id
      AND s.cantidad > ndi.cantidad - COALESCE((
        SELECT SUM(dd.cantidad_devuelta)
        FROM public.despacho_devoluciones dd
        WHERE dd.despacho_id = p_despacho_id
          AND dd.despacho_item_id = ndi.id
      ), 0)
  ) THEN
    RAISE EXCEPTION 'SALDO_DEVOLUCION_INVALIDO: la cantidad solicitada supera el saldo disponible';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM tmp_intercambio_solicitudes s
    WHERE s.cantidad > (
      SELECT COALESCE(SUM(di.cantidad), 0)
      FROM public.despacho_devolucion_intercambios di
      WHERE di.despacho_id = p_despacho_id
        AND di.producto_id = s.producto_id
    ) - (
      SELECT COALESCE(SUM(dd.cantidad_devuelta), 0)
      FROM public.despacho_devoluciones dd
      WHERE dd.despacho_id = p_despacho_id
        AND dd.despacho_item_id IS NULL
        AND dd.producto_id = s.producto_id
    )
  ) THEN
    RAISE EXCEPTION 'SALDO_INTERCAMBIO_INVALIDO: la cantidad solicitada supera el saldo disponible';
  END IF;

  FOR v_item IN
    SELECT *
    FROM jsonb_to_recordset(COALESCE(p_intercambios, '[]'::JSONB)) AS x(
      producto_id UUID,
      nombre_snap TEXT,
      codigo_snap TEXT,
      unidad_snap TEXT,
      cantidad NUMERIC,
      precio_unit_usd NUMERIC,
      total_usd NUMERIC,
      stock_actual NUMERIC,
      nuevo_stock NUMERIC
    )
  LOOP
    IF v_item.producto_id IS NULL OR v_item.cantidad IS NULL OR v_item.cantidad <= 0 THEN
      RAISE EXCEPTION 'INTERCAMBIO_INVALIDO: %', v_item.nombre_snap;
    END IF;

    INSERT INTO tmp_devolucion_deltas (producto_id, nombre_snap, tipo_operacion, delta)
    VALUES (v_item.producto_id, COALESCE(v_item.nombre_snap, 'Producto'), 'egreso', -v_item.cantidad)
    ON CONFLICT (producto_id, tipo_operacion) DO UPDATE
      SET delta = tmp_devolucion_deltas.delta + EXCLUDED.delta;
  END LOOP;

  FOR v_delta IN
    SELECT producto_id, nombre_snap, tipo_operacion, delta
    FROM tmp_devolucion_deltas
    WHERE delta <> 0
    ORDER BY producto_id, tipo_operacion DESC
  LOOP
    SELECT id, nombre, stock_actual, activo, cuenta_id
    INTO v_producto
    FROM public.productos
    WHERE id = v_delta.producto_id
      AND (v_despacho.cuenta_id IS NULL OR cuenta_id = v_despacho.cuenta_id)
    FOR UPDATE;

    IF NOT FOUND OR (v_delta.tipo_operacion = 'egreso' AND v_producto.activo IS NOT TRUE) THEN
      RAISE EXCEPTION 'PRODUCTO_NO_DISPONIBLE: %', v_delta.nombre_snap;
    END IF;

    v_nuevo_stock := ROUND((COALESCE(v_producto.stock_actual, 0) + v_delta.delta)::NUMERIC, 4);
    IF v_nuevo_stock < 0 AND NOT v_allow_negative THEN
      RAISE EXCEPTION 'STOCK_INSUFICIENTE_PARA_INTERCAMBIO: "%" tiene % y requiere %',
        v_producto.nombre, v_producto.stock_actual, abs(v_delta.delta);
    END IF;

    UPDATE public.productos
    SET stock_actual = v_nuevo_stock,
        actualizado_en = now()
    WHERE id = v_producto.id;

    -- OP-2026-095 (A6): registrar origen_tipo/origen_id/origen_referencia en Kardex.
    INSERT INTO public.inventario_movimientos (
      lote_id, tipo, motivo, motivo_tipo,
      producto_id, producto_nombre, cantidad,
      stock_anterior, stock_nuevo,
      usuario_id, usuario_nombre, usuario_color, cuenta_id,
      origen_tipo, origen_id, origen_referencia
    ) VALUES (
      v_lote_id,
      v_delta.tipo_operacion::tipo_movimiento,
      'Devolución parcial de despacho #' || v_despacho.numero,
      'devolucion',
      v_producto.id,
      COALESCE(v_delta.nombre_snap, v_producto.nombre),
      abs(v_delta.delta),
      COALESCE(v_producto.stock_actual, 0),
      v_nuevo_stock,
      v_usuario_fk,
      trim(p_usuario_nombre),
      p_usuario_color,
      v_producto.cuenta_id,
      'devolucion',
      p_despacho_id,
      v_desp_ref
    );

    v_movimientos := v_movimientos + 1;
  END LOOP;

  INSERT INTO public.despacho_devoluciones (
    despacho_id, despacho_item_id, producto_id,
    nombre_snap, codigo_snap, unidad_snap,
    cantidad_devuelta, precio_unit_usd, total_devuelto_usd,
    motivo, registrado_por, registrado_por_nombre,
    cotizacion_reemplazo_id
  )
  SELECT
    p_despacho_id,
    x.despacho_item_id,
    x.producto_id,
    COALESCE(x.nombre_snap, 'Producto'),
    x.codigo_snap,
    COALESCE(x.unidad_snap, 'und'),
    x.cantidad_devuelta,
    COALESCE(x.precio_unit_usd, 0),
    COALESCE(x.total_devuelto_usd, 0),
    trim(p_motivo),
    v_usuario_fk,
    trim(p_usuario_nombre),
    p_cotizacion_reemplazo_id
  FROM jsonb_to_recordset(p_devoluciones) AS x(
    despacho_item_id UUID,
    producto_id UUID,
    nombre_snap TEXT,
    codigo_snap TEXT,
    unidad_snap TEXT,
    cantidad_devuelta NUMERIC,
    precio_unit_usd NUMERIC,
    total_devuelto_usd NUMERIC
  );

  INSERT INTO public.despacho_devolucion_intercambios (
    despacho_id, producto_id, nombre_snap, codigo_snap,
    unidad_snap, cantidad, precio_unit_usd, total_usd, registrado_por
  )
  SELECT
    p_despacho_id,
    x.producto_id,
    COALESCE(x.nombre_snap, 'Producto'),
    x.codigo_snap,
    COALESCE(x.unidad_snap, 'und'),
    x.cantidad,
    COALESCE(x.precio_unit_usd, 0),
    COALESCE(x.total_usd, 0),
    v_usuario_fk
  FROM jsonb_to_recordset(COALESCE(p_intercambios, '[]'::JSONB)) AS x(
    producto_id UUID,
    nombre_snap TEXT,
    codigo_snap TEXT,
    unidad_snap TEXT,
    cantidad NUMERIC,
    precio_unit_usd NUMERIC,
    total_usd NUMERIC
  );

  v_nuevo_total := ROUND((COALESCE(v_despacho.total_usd, 0)
    - COALESCE(p_total_devuelto_usd, 0)
    + COALESCE(p_total_intercambio_usd, 0))::NUMERIC, 4);

  UPDATE public.notas_despacho
  SET tiene_devoluciones = TRUE,
      total_usd = v_nuevo_total
  WHERE id = p_despacho_id;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'despacho_id', p_despacho_id,
    'lote_id', v_lote_id,
    'movimientos', v_movimientos,
    'total_usd', v_nuevo_total
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.verificar_prestamos_despacho_reaperturable(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verificar_prestamos_despacho_reaperturable(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.obtener_items_netos_despacho(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.obtener_items_netos_despacho(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.aprobar_despacho_inventario_atomico(uuid, uuid, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aprobar_despacho_inventario_atomico(uuid, uuid, text, text, boolean) TO service_role;
REVOKE ALL ON FUNCTION public.confirmar_entrega_inventario_atomica(uuid, uuid, text, text, numeric, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirmar_entrega_inventario_atomica(uuid, uuid, text, text, numeric, boolean) TO service_role;
REVOKE ALL ON FUNCTION public.sincronizar_prestamos_despacho(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sincronizar_prestamos_despacho(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.devolver_prestamo_inventario_atomico(uuid, uuid, numeric, uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.devolver_prestamo_inventario_atomico(uuid, uuid, numeric, uuid, text, text, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.revertir_despacho_inventario_atomica(uuid, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revertir_despacho_inventario_atomica(uuid, text, uuid, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.revertir_entrega_inventario_atomica(uuid, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revertir_entrega_inventario_atomica(uuid, text, uuid, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.editar_despacho_profundidad(uuid, jsonb, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.editar_despacho_profundidad(uuid, jsonb, uuid, text, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.revertir_entrega_finanzas_atomica(uuid, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revertir_entrega_finanzas_atomica(uuid, text, uuid, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.registrar_devolucion_inventario_atomica(uuid, jsonb, jsonb, text, uuid, text, text, uuid, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_devolucion_inventario_atomica(uuid, jsonb, jsonb, text, uuid, text, text, uuid, numeric, numeric) TO service_role;

COMMIT;
