-- OP-2026-071 Fase 4 (N33, N34): Higiene de catálogo, 4 decimales y consolidación de lotes en staging.
BEGIN;

-- 1. N33: Impedir borrado físico de productos con historial y corregir signo en cierre con stock negativo.
CREATE OR REPLACE FUNCTION public.borrar_producto_con_kardex_tenant_safe(
  p_cuenta_id uuid,
  p_producto_id uuid,
  p_usuario_id uuid,
  p_usuario_nombre text DEFAULT NULL::text,
  p_usuario_color text DEFAULT NULL::text,
  p_confirmacion text DEFAULT NULL::text,
  p_idempotency_key uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor      RECORD;
  v_producto   RECORD;
  v_lote_id    UUID;
  v_guard      JSONB;
  v_resultado  JSONB;
BEGIN
  IF p_cuenta_id IS NULL OR p_producto_id IS NULL OR p_usuario_id IS NULL
     OR COALESCE(p_confirmacion, '') <> 'BORRAR_PRODUCTO' THEN
    RAISE EXCEPTION 'CONFIRMACION_BORRADO_PRODUCTO_INVALIDA';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_OBLIGATORIA';
  END IF;

  v_guard := public.reservar_operacion_inventario(
    p_cuenta_id, p_idempotency_key, 'product_delete'
  );
  IF COALESCE((v_guard->>'existente')::BOOLEAN, FALSE) THEN
    IF v_guard->'resultado' IS NULL OR v_guard->'resultado' = 'null'::JSONB THEN
      RAISE EXCEPTION 'OPERACION_IDEMPOTENTE_SIN_RESULTADO';
    END IF;
    RETURN (v_guard->'resultado') || jsonb_build_object('idempotent', TRUE);
  END IF;

  SELECT u.id, u.nombre, u.color, u.rol INTO v_actor
  FROM public.usuarios u
  WHERE u.id = p_usuario_id AND u.cuenta_id = p_cuenta_id
    AND u.activo = TRUE AND u.rol IN ('administracion', 'jefe', 'desarrollador')
  LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'USUARIO_BORRADO_NO_AUTORIZADO'; END IF;

  SELECT * INTO v_producto
  FROM public.productos
  WHERE id = p_producto_id AND cuenta_id = p_cuenta_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCTO_NO_DISPONIBLE'; END IF;

  -- N33: Si el producto participó en ventas, cotizaciones, préstamos, devoluciones o ajustes,
  -- debe archivarse (activo = FALSE) para conservar trazabilidad; no se elimina físicamente.
  IF EXISTS (SELECT 1 FROM public.cotizacion_items ci WHERE ci.producto_id = p_producto_id LIMIT 1)
     OR EXISTS (SELECT 1 FROM public.notas_despacho_items ndi WHERE ndi.producto_id = p_producto_id LIMIT 1)
     OR EXISTS (SELECT 1 FROM public.cliente_prestamos cp WHERE cp.producto_id = p_producto_id LIMIT 1)
     OR EXISTS (SELECT 1 FROM public.despacho_devoluciones dd WHERE dd.producto_id = p_producto_id LIMIT 1)
     OR EXISTS (SELECT 1 FROM public.despacho_devolucion_intercambios di WHERE di.producto_id = p_producto_id LIMIT 1)
     OR EXISTS (
       SELECT 1 FROM public.inventario_movimientos im
       WHERE im.producto_id = p_producto_id
         AND im.cuenta_id = p_cuenta_id
         AND COALESCE(im.origen_tipo, '') <> 'product_create'
       LIMIT 1
     )
  THEN
    RAISE EXCEPTION 'PRODUCTO_CON_HISTORIAL_USAR_ARCHIVADO: "%"', v_producto.nombre;
  END IF;

  IF COALESCE(v_producto.stock_actual, 0) <> 0 THEN
    v_lote_id := gen_random_uuid();
    INSERT INTO public.inventario_movimientos (
      lote_id, tipo, motivo, motivo_tipo, producto_id, producto_nombre,
      cantidad, stock_anterior, stock_nuevo, usuario_id, usuario_nombre,
      usuario_color, cuenta_id, origen_tipo, origen_id, origen_referencia,
      idempotency_key
    ) VALUES (
      v_lote_id,
      CASE
        WHEN v_producto.stock_actual < 0 THEN 'ingreso'::tipo_movimiento
        ELSE 'egreso'::tipo_movimiento
      END,
      'Producto eliminado del sistema', 'ajuste_inventario',
      p_producto_id, v_producto.nombre, abs(v_producto.stock_actual),
      v_producto.stock_actual, 0, v_actor.id,
      COALESCE(NULLIF(btrim(p_usuario_nombre), ''), v_actor.nombre),
      COALESCE(p_usuario_color, v_actor.color), p_cuenta_id,
      'product_delete', p_producto_id,
      'idempotency:' || COALESCE(p_idempotency_key::TEXT, v_lote_id::TEXT),
      p_idempotency_key
    );
  END IF;

  DELETE FROM public.productos WHERE id = p_producto_id AND cuenta_id = p_cuenta_id;
  v_resultado := jsonb_build_object(
    'ok', TRUE, 'producto_id', p_producto_id,
    'movimiento_lote_id', v_lote_id, 'idempotency_key', p_idempotency_key
  );
  PERFORM public.guardar_operacion_inventario(p_cuenta_id, p_idempotency_key, v_resultado);
  RETURN v_resultado;
END
$function$;

-- 2. N33: Permitir reingreso físico de productos archivados (activo = FALSE) en devoluciones, préstamos y reaperturas.
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

    -- N33: Permitir devolución entrante de artículos archivados; exigir activo = TRUE en egresos/intercambios.
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

    INSERT INTO public.inventario_movimientos (
      lote_id, tipo, motivo, motivo_tipo,
      producto_id, producto_nombre, cantidad,
      stock_anterior, stock_nuevo,
      usuario_id, usuario_nombre, usuario_color, cuenta_id
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
      v_producto.cuenta_id
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

-- 3. N34: Ampliar columnas de stock y cantidades de NUMERIC(10,2) a NUMERIC(12,4)
--        preservando vistas dependientes y sus permisos exactos.
DROP VIEW IF EXISTS public.despacho_pesos;
DROP VIEW IF EXISTS public.despacho_items_peso;
DROP VIEW IF EXISTS public.v_catalogo_publico;
DROP VIEW IF EXISTS public.v_productos_vendedor;

ALTER TABLE public.productos
  ALTER COLUMN stock_actual TYPE NUMERIC(12,4),
  ALTER COLUMN stock_minimo TYPE NUMERIC(12,4);

ALTER TABLE public.inventario_movimientos
  ALTER COLUMN cantidad TYPE NUMERIC(12,4),
  ALTER COLUMN stock_anterior TYPE NUMERIC(12,4),
  ALTER COLUMN stock_nuevo TYPE NUMERIC(12,4);

ALTER TABLE public.cotizacion_items
  ALTER COLUMN cantidad TYPE NUMERIC(12,4);

ALTER TABLE public.notas_despacho_items
  ALTER COLUMN cantidad TYPE NUMERIC(12,4),
  ALTER COLUMN cantidad_original TYPE NUMERIC(12,4);

CREATE VIEW public.despacho_items_peso WITH (security_invoker = true) AS
SELECT i.id AS item_id,
       i.despacho_id,
       i.producto_id,
       i.cantidad,
       w.peso_unit_kg,
       (i.cantidad * w.peso_unit_kg)::numeric(14,3) AS peso_linea_kg
FROM public.notas_despacho_items i
JOIN public.notas_despacho d ON d.id = i.despacho_id
CROSS JOIN LATERAL (
  SELECT COALESCE(
    i.peso_unit_kg_snap,
    CASE
      WHEN d.estado = ANY (ARRAY['pendiente'::text, 'despachada'::text])
        THEN public.peso_producto_visible(i.producto_id)
      ELSE NULL::numeric
    END
  ) AS peso_unit_kg
) w;
REVOKE ALL ON public.despacho_items_peso FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.despacho_items_peso TO authenticated, service_role;

CREATE VIEW public.despacho_pesos WITH (security_invoker = true) AS
SELECT despacho_id,
       COALESCE(sum(peso_linea_kg), 0::numeric)::numeric(14,3) AS peso_total_kg,
       count(*) FILTER (WHERE peso_unit_kg IS NULL)::integer AS items_sin_peso,
       count(*)::integer AS items_total
FROM public.despacho_items_peso
GROUP BY despacho_id;
REVOKE ALL ON public.despacho_pesos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.despacho_pesos TO authenticated, service_role;

CREATE VIEW public.v_catalogo_publico WITH (security_invoker = off) AS
SELECT id, codigo, nombre, categoria, descripcion, unidad, precio_usd, stock_actual, imagen_url, activo
FROM public.productos
WHERE activo = true AND stock_actual > 0::numeric;
REVOKE ALL ON public.v_catalogo_publico FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_catalogo_publico TO anon, authenticated, service_role;

CREATE VIEW public.v_productos_vendedor AS
SELECT id, codigo, nombre, descripcion, categoria, unidad, precio_usd, stock_actual, stock_minimo, imagen_url, activo, creado_en, actualizado_en
FROM public.productos
WHERE activo = true;
REVOKE ALL ON public.v_productos_vendedor FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_productos_vendedor TO authenticated, service_role;

-- 4. N34: Permitir 4 decimales y consolidar filas duplicadas en ingresar_lote_inventario_atomico
--        preservando íntegramente el contrato ARREGLO 278.
CREATE OR REPLACE FUNCTION public.ingresar_lote_inventario_atomico(
  p_cuenta_id uuid,
  p_motivo text,
  p_productos jsonb,
  p_usuario_id uuid DEFAULT NULL::uuid,
  p_usuario_nombre text DEFAULT NULL::text,
  p_usuario_color text DEFAULT NULL::text,
  p_idempotency_key uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_item           RECORD;
  v_producto       RECORD;
  v_actor_id       UUID;
  v_allow_negative BOOLEAN := FALSE;
  v_lote_id        UUID := gen_random_uuid();
  v_result         JSONB;
  v_existing       JSONB;
  v_nuevo_stock    NUMERIC(12,4);
  v_diff           NUMERIC(12,4);
  v_movimientos    INTEGER := 0;
  v_procesados     INTEGER := 0;
  v_nuevos         INTEGER := 0;
BEGIN
  IF p_cuenta_id IS NULL
     OR p_motivo IS NULL
     OR char_length(trim(p_motivo)) = 0
     OR p_productos IS NULL
     OR jsonb_typeof(p_productos) <> 'array'
     OR jsonb_array_length(p_productos) = 0 THEN
    RAISE EXCEPTION 'PARAMETROS_INGESTA_INVALIDOS';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT resultado
    INTO v_existing
    FROM public.inventario_operaciones_staging
    WHERE cuenta_id = p_cuenta_id
      AND idempotency_key = p_idempotency_key
    FOR UPDATE;
    IF FOUND AND v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;
    IF NOT FOUND THEN
      INSERT INTO public.inventario_operaciones_staging
        (idempotency_key, cuenta_id, operacion_tipo)
      VALUES (p_idempotency_key, p_cuenta_id, 'batch_ingest');
    END IF;
  END IF;

  SELECT u.id
  INTO v_actor_id
  FROM public.usuarios u
  WHERE u.id = p_usuario_id
    AND u.activo = TRUE
    AND u.cuenta_id = p_cuenta_id
  LIMIT 1;

  IF v_actor_id IS NULL THEN
    SELECT u.id
    INTO v_actor_id
    FROM public.usuarios u
    WHERE u.activo = TRUE
      AND u.cuenta_id = p_cuenta_id
      AND u.rol IN ('supervisor', 'administracion', 'jefe', 'desarrollador')
    ORDER BY u.nombre, u.id
    LIMIT 1;
  END IF;
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'USUARIO_KARDEX_NO_ENCONTRADO';
  END IF;

  SELECT COALESCE(cn.permitir_stock_negativo, FALSE)
  INTO v_allow_negative
  FROM public.configuracion_negocio cn
  WHERE cn.cuenta_id = p_cuenta_id
  LIMIT 1;

  DROP TABLE IF EXISTS pg_temp.tmp_ingesta_staging;
  CREATE TEMP TABLE tmp_ingesta_staging (
    fila                 INTEGER NOT NULL,
    producto_id          UUID,
    is_nuevo             BOOLEAN NOT NULL,
    codigo               TEXT,
    nombre               TEXT,
    descripcion          TEXT,
    categoria            TEXT,
    unidad               TEXT,
    cantidad             NUMERIC(12,4),
    costo_usd            NUMERIC(12,4),
    precio_usd           NUMERIC(12,4),
    precio_2             NUMERIC(12,4),
    precio_3             NUMERIC(12,4),
    precio1_porcentaje   NUMERIC(12,4),
    precio2_porcentaje   NUMERIC(12,4),
    precio3_porcentaje   NUMERIC(12,4),
    modo_existente       TEXT,
    actualizar_costo     BOOLEAN
  ) ON COMMIT DROP;

  INSERT INTO tmp_ingesta_staging (
    fila, producto_id, is_nuevo, codigo, nombre, descripcion, categoria,
    unidad, cantidad, costo_usd, precio_usd, precio_2, precio_3,
    precio1_porcentaje, precio2_porcentaje, precio3_porcentaje,
    modo_existente, actualizar_costo
  )
  SELECT row_number() OVER ()::INTEGER,
         r.producto_id,
         COALESCE(r.is_nuevo, r.producto_id IS NULL),
         NULLIF(trim(r.codigo), ''),
         NULLIF(trim(r.nombre), ''),
         NULLIF(trim(r.descripcion), ''),
         NULLIF(trim(r.categoria), ''),
         COALESCE(NULLIF(trim(r.unidad), ''), 'und'),
         r.cantidad,
         r.costo_usd,
         r.precio_usd,
         r.precio_2,
         r.precio_3,
         r.precio1_porcentaje,
         r.precio2_porcentaje,
         r.precio3_porcentaje,
         COALESCE(NULLIF(trim(r.modo_existente), ''), 'sumar'),
         COALESCE(r.actualizar_costo, FALSE)
  FROM jsonb_to_recordset(p_productos) AS r(
    producto_id UUID,
    is_nuevo BOOLEAN,
    codigo TEXT,
    nombre TEXT,
    descripcion TEXT,
    categoria TEXT,
    unidad TEXT,
    cantidad NUMERIC,
    costo_usd NUMERIC,
    precio_usd NUMERIC,
    precio_2 NUMERIC,
    precio_3 NUMERIC,
    precio1_porcentaje NUMERIC,
    precio2_porcentaje NUMERIC,
    precio3_porcentaje NUMERIC,
    modo_existente TEXT,
    actualizar_costo BOOLEAN
  );

  IF EXISTS (SELECT 1 FROM tmp_ingesta_staging WHERE nombre IS NULL OR cantidad IS NULL OR cantidad <= 0) THEN
    RAISE EXCEPTION 'ITEM_INGESTA_INVALIDO';
  END IF;
  IF EXISTS (SELECT 1 FROM tmp_ingesta_staging WHERE is_nuevo AND producto_id IS NOT NULL) THEN
    RAISE EXCEPTION 'PRODUCTO_NUEVO_CON_ID';
  END IF;
  IF EXISTS (SELECT 1 FROM tmp_ingesta_staging WHERE NOT is_nuevo AND producto_id IS NULL) THEN
    RAISE EXCEPTION 'PRODUCTO_EXISTENTE_SIN_ID';
  END IF;
  IF EXISTS (SELECT 1 FROM tmp_ingesta_staging WHERE NOT is_nuevo AND modo_existente NOT IN ('sumar', 'sobrescribir')) THEN
    RAISE EXCEPTION 'MODO_INGESTA_INVALIDO';
  END IF;

  -- N34: Permitir filas repetidas cuando todas usan modo 'sumar'; rechazar mezcla con 'sobrescribir'.
  IF EXISTS (
    SELECT 1
    FROM tmp_ingesta_staging
    WHERE NOT is_nuevo
    GROUP BY producto_id
    HAVING count(*) > 1 AND bool_or(modo_existente = 'sobrescribir')
  ) THEN
    RAISE EXCEPTION 'MODO_INGESTA_CONFLICTIVO';
  END IF;

  -- N34: Permitir códigos repetidos en nuevos solo si coinciden nombre y unidad (se suman sus cantidades).
  IF EXISTS (
    SELECT 1
    FROM tmp_ingesta_staging
    WHERE is_nuevo AND codigo IS NOT NULL
    GROUP BY upper(codigo)
    HAVING count(DISTINCT (upper(nombre) || '|' || upper(unidad))) > 1
  ) THEN
    RAISE EXCEPTION 'CODIGO_REPETIDO_EN_INGESTA';
  END IF;

  DROP TABLE IF EXISTS pg_temp.tmp_ingesta_staging_cons;
  CREATE TEMP TABLE tmp_ingesta_staging_cons (LIKE pg_temp.tmp_ingesta_staging) ON COMMIT DROP;

  INSERT INTO tmp_ingesta_staging_cons
  SELECT
    MIN(fila)::INTEGER,
    producto_id,
    FALSE,
    MAX(codigo),
    (array_agg(nombre ORDER BY fila DESC))[1],
    (array_agg(descripcion ORDER BY fila DESC))[1],
    (array_agg(categoria ORDER BY fila DESC))[1],
    (array_agg(unidad ORDER BY fila DESC))[1],
    ROUND(SUM(cantidad)::NUMERIC, 4),
    COALESCE(
      (array_agg(costo_usd ORDER BY fila DESC) FILTER (WHERE actualizar_costo AND costo_usd IS NOT NULL))[1],
      (array_agg(costo_usd ORDER BY fila DESC))[1]
    ),
    (array_agg(precio_usd ORDER BY fila DESC))[1],
    (array_agg(precio_2 ORDER BY fila DESC))[1],
    (array_agg(precio_3 ORDER BY fila DESC))[1],
    (array_agg(precio1_porcentaje ORDER BY fila DESC))[1],
    (array_agg(precio2_porcentaje ORDER BY fila DESC))[1],
    (array_agg(precio3_porcentaje ORDER BY fila DESC))[1],
    MIN(modo_existente),
    bool_or(actualizar_costo)
  FROM pg_temp.tmp_ingesta_staging
  WHERE NOT is_nuevo
  GROUP BY producto_id;

  INSERT INTO tmp_ingesta_staging_cons
  SELECT
    MIN(fila)::INTEGER,
    NULL::UUID,
    TRUE,
    (array_agg(codigo ORDER BY fila))[1],
    (array_agg(nombre ORDER BY fila))[1],
    (array_agg(descripcion ORDER BY fila DESC))[1],
    (array_agg(categoria ORDER BY fila DESC))[1],
    (array_agg(unidad ORDER BY fila))[1],
    ROUND(SUM(cantidad)::NUMERIC, 4),
    COALESCE(
      (array_agg(costo_usd ORDER BY fila DESC) FILTER (WHERE costo_usd IS NOT NULL))[1],
      0
    ),
    (array_agg(precio_usd ORDER BY fila DESC) FILTER (WHERE precio_usd IS NOT NULL))[1],
    (array_agg(precio_2 ORDER BY fila DESC))[1],
    (array_agg(precio_3 ORDER BY fila DESC))[1],
    (array_agg(precio1_porcentaje ORDER BY fila DESC))[1],
    (array_agg(precio2_porcentaje ORDER BY fila DESC))[1],
    (array_agg(precio3_porcentaje ORDER BY fila DESC))[1],
    'sumar',
    FALSE
  FROM pg_temp.tmp_ingesta_staging
  WHERE is_nuevo
  GROUP BY COALESCE(NULLIF(upper(codigo), ''), '__FILA__' || fila::text);

  TRUNCATE pg_temp.tmp_ingesta_staging;
  INSERT INTO pg_temp.tmp_ingesta_staging SELECT * FROM pg_temp.tmp_ingesta_staging_cons;

  UPDATE tmp_ingesta_staging
  SET producto_id = gen_random_uuid()
  WHERE is_nuevo;

  -- Bloquear y actualizar existentes en orden determinista.
  FOR v_item IN
    SELECT * FROM tmp_ingesta_staging
    WHERE NOT is_nuevo
    ORDER BY producto_id
  LOOP
    SELECT p.id, p.nombre, p.stock_actual, p.activo, p.cuenta_id
    INTO v_producto
    FROM public.productos p
    WHERE p.id = v_item.producto_id
      AND p.cuenta_id = p_cuenta_id
    FOR UPDATE;

    IF NOT FOUND OR v_producto.activo IS NOT TRUE THEN
      RAISE EXCEPTION 'PRODUCTO_NO_DISPONIBLE: %', v_item.producto_id;
    END IF;

    v_nuevo_stock := CASE
      WHEN v_item.modo_existente = 'sobrescribir' THEN ROUND(v_item.cantidad::NUMERIC, 4)
      ELSE ROUND((COALESCE(v_producto.stock_actual, 0) + v_item.cantidad)::NUMERIC, 4)
    END;
    v_diff := ROUND((v_nuevo_stock - COALESCE(v_producto.stock_actual, 0))::NUMERIC, 4);

    IF v_nuevo_stock < 0 AND NOT v_allow_negative THEN
      RAISE EXCEPTION 'STOCK_INSUFICIENTE: "%" quedaría en %', v_producto.nombre, v_nuevo_stock;
    END IF;

    -- ARREGLO 278: los precios de venta NO se tocan en productos existentes.
    -- Antes se pisaba precio_usd con el valor de la lista (pre-cargado al abrir
    -- la pantalla) y el precio nuevo que el usuario acababa de guardar "volvía"
    -- al antiguo. Los precios solo se fijan en el INSERT de productos nuevos.
    UPDATE public.productos
    SET stock_actual = v_nuevo_stock,
        costo_usd = CASE WHEN v_item.actualizar_costo THEN COALESCE(v_item.costo_usd, 0) ELSE costo_usd END,
        actualizado_en = now()
    WHERE id = v_producto.id;

    IF v_diff <> 0 THEN
      INSERT INTO public.inventario_movimientos (
        lote_id, tipo, motivo, motivo_tipo, producto_id, producto_nombre,
        cantidad, stock_anterior, stock_nuevo, usuario_id, usuario_nombre,
        usuario_color, cuenta_id, origen_tipo, origen_id, origen_referencia,
        idempotency_key
      ) VALUES (
        v_lote_id,
        CASE WHEN v_diff > 0 THEN 'ingreso'::tipo_movimiento ELSE 'egreso'::tipo_movimiento END,
        trim(p_motivo),
        CASE WHEN v_item.modo_existente = 'sumar' AND v_diff > 0
          THEN 'compra_proveedor'::motivo_movimiento
          ELSE 'ajuste_inventario'::motivo_movimiento END,
        v_producto.id, v_producto.nombre, abs(v_diff),
        COALESCE(v_producto.stock_actual, 0), v_nuevo_stock,
        v_actor_id, COALESCE(NULLIF(trim(p_usuario_nombre), ''), 'Operador staging'),
        p_usuario_color, p_cuenta_id, 'batch_ingest', v_lote_id,
        'batch_ingest:' || v_item.fila, p_idempotency_key
      );
      v_movimientos := v_movimientos + 1;
    END IF;
    v_procesados := v_procesados + 1;
  END LOOP;

  -- Crear nuevos productos y su ingreso inicial en la misma transacción.
  FOR v_item IN
    SELECT * FROM tmp_ingesta_staging
    WHERE is_nuevo
    ORDER BY fila
  LOOP
    INSERT INTO public.productos (
      id, codigo, nombre, descripcion, categoria, unidad,
      precio_usd, costo_usd, stock_actual, stock_minimo,
      activo, cuenta_id, precio_2, precio_3,
      precio1_porcentaje, precio2_porcentaje, precio3_porcentaje,
      creado_en, actualizado_en
    ) VALUES (
      v_item.producto_id, v_item.codigo, v_item.nombre, v_item.descripcion,
      v_item.categoria, v_item.unidad, COALESCE(v_item.precio_usd, 0),
      COALESCE(v_item.costo_usd, 0), ROUND(v_item.cantidad::NUMERIC, 4), 0, TRUE, p_cuenta_id,
      v_item.precio_2, v_item.precio_3, v_item.precio1_porcentaje,
      v_item.precio2_porcentaje, v_item.precio3_porcentaje, now(), now()
    );

    INSERT INTO public.inventario_movimientos (
      lote_id, tipo, motivo, motivo_tipo, producto_id, producto_nombre,
      cantidad, stock_anterior, stock_nuevo, usuario_id, usuario_nombre,
      usuario_color, cuenta_id, origen_tipo, origen_id, origen_referencia,
      idempotency_key
    ) VALUES (
      v_lote_id, 'ingreso', trim(p_motivo), 'compra_proveedor',
      v_item.producto_id, v_item.nombre, ROUND(v_item.cantidad::NUMERIC, 4), 0, ROUND(v_item.cantidad::NUMERIC, 4),
      v_actor_id, COALESCE(NULLIF(trim(p_usuario_nombre), ''), 'Operador staging'),
      p_usuario_color, p_cuenta_id, 'batch_ingest', v_lote_id,
      'batch_ingest:' || v_item.fila, p_idempotency_key
    );
    v_movimientos := v_movimientos + 1;
    v_procesados := v_procesados + 1;
    v_nuevos := v_nuevos + 1;
  END LOOP;

  v_result := jsonb_build_object(
    'ok', TRUE,
    'lote_id', v_lote_id,
    'procesados', v_procesados,
    'nuevos', v_nuevos,
    'movimientos', v_movimientos,
    'idempotency_key', p_idempotency_key
  );

  IF p_idempotency_key IS NOT NULL THEN
    UPDATE public.inventario_operaciones_staging
    SET resultado = v_result, actualizado_en = now()
    WHERE cuenta_id = p_cuenta_id
      AND idempotency_key = p_idempotency_key;
  END IF;

  RETURN v_result;
END;
$function$;

-- 5. Preservar cierre de privilegios de ejecución (N30) sobre RPCs recreadas.
DO $$
DECLARE
  r RECORD;
  v_rpcs TEXT[] := ARRAY[
    'borrar_producto_con_kardex_tenant_safe',
    'devolver_prestamo_inventario_atomico',
    'revertir_despacho_inventario_atomica',
    'revertir_entrega_inventario_atomica',
    'editar_despacho_profundidad',
    'registrar_devolucion_inventario_atomica',
    'ingresar_lote_inventario_atomico'
  ];
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ANY(v_rpcs)
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated;', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role;', r.sig);
  END LOOP;
END $$;

COMMIT;
