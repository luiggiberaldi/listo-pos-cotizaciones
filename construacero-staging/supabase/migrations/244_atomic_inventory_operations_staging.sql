-- 244_atomic_inventory_operations_staging.sql
--
-- Guardrails de staging para que toda mutación operativa de stock se ejecute
-- dentro de una única transacción PostgreSQL:
--   * ingreso/egreso manual por lote;
--   * transformación de un producto en otro;
--   * devolución física de un préstamo.
--
-- Estas RPCs son invocadas únicamente por el Worker con service_role. El
-- frontend no recibe permisos directos para mutar stock_actual.

CREATE OR REPLACE FUNCTION public.aplicar_movimiento_inventario_atomico(
  p_cuenta_id      UUID,
  p_tipo           tipo_movimiento,
  p_motivo         TEXT,
  p_motivo_tipo    motivo_movimiento DEFAULT 'otro',
  p_items          JSONB DEFAULT '[]'::JSONB,
  p_usuario_id     UUID DEFAULT NULL,
  p_usuario_nombre TEXT DEFAULT NULL,
  p_usuario_color  TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item           RECORD;
  v_producto       RECORD;
  v_actor_id       UUID;
  v_lote_id        UUID := gen_random_uuid();
  v_allow_negative BOOLEAN := FALSE;
  v_nuevo_stock    NUMERIC(10,2);
  v_movimientos    INTEGER := 0;
  v_primer_numero INTEGER;
BEGIN
  IF p_cuenta_id IS NULL
     OR p_tipo IS NULL
     OR p_motivo IS NULL
     OR char_length(trim(p_motivo)) = 0
     OR p_items IS NULL
     OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'PARAMETROS_MOVIMIENTO_INVALIDOS';
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

  -- Consolidar líneas repetidas antes de tocar cualquier producto. Así una
  -- solicitud duplicada no puede calcular dos veces el mismo stock snapshot.
  DROP TABLE IF EXISTS pg_temp.tmp_movimiento_inventario;
  CREATE TEMP TABLE tmp_movimiento_inventario (
    producto_id UUID PRIMARY KEY,
    cantidad NUMERIC(12,4) NOT NULL
  ) ON COMMIT DROP;

  FOR v_item IN
    SELECT *
    FROM jsonb_to_recordset(p_items) AS x(
      producto_id UUID,
      cantidad NUMERIC
    )
  LOOP
    IF v_item.producto_id IS NULL
       OR v_item.cantidad IS NULL
       OR v_item.cantidad <= 0 THEN
      RAISE EXCEPTION 'ITEM_MOVIMIENTO_INVALIDO';
    END IF;

    INSERT INTO tmp_movimiento_inventario (producto_id, cantidad)
    VALUES (v_item.producto_id, v_item.cantidad)
    ON CONFLICT (producto_id) DO UPDATE
      SET cantidad = tmp_movimiento_inventario.cantidad + EXCLUDED.cantidad;
  END LOOP;

  -- FOR UPDATE en orden determinista evita carreras y deadlocks entre lotes.
  FOR v_item IN
    SELECT producto_id, cantidad
    FROM tmp_movimiento_inventario
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

    v_nuevo_stock := ROUND((COALESCE(v_producto.stock_actual, 0)
      + CASE WHEN p_tipo = 'ingreso' THEN v_item.cantidad ELSE -v_item.cantidad END)::NUMERIC, 2);

    IF v_nuevo_stock < 0 AND NOT v_allow_negative THEN
      RAISE EXCEPTION 'STOCK_INSUFICIENTE: "%" tiene % y se intenta retirar %',
        v_producto.nombre, v_producto.stock_actual, v_item.cantidad;
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
      v_lote_id, p_tipo, trim(p_motivo), p_motivo_tipo,
      v_producto.id, v_producto.nombre, ROUND(v_item.cantidad::NUMERIC, 2),
      COALESCE(v_producto.stock_actual, 0), v_nuevo_stock,
      v_actor_id, COALESCE(NULLIF(trim(p_usuario_nombre), ''), 'Operador staging'),
      p_usuario_color, p_cuenta_id
    );

    v_movimientos := v_movimientos + 1;
  END LOOP;

  SELECT MIN(numero)
  INTO v_primer_numero
  FROM public.inventario_movimientos
  WHERE lote_id = v_lote_id;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'lote_id', v_lote_id,
    'numero', v_primer_numero,
    'movimientos', v_movimientos,
    'stock_negativo_permitido', v_allow_negative
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.transformar_inventario_atomico(
  p_cuenta_id             UUID,
  p_origen_producto_id    UUID,
  p_origen_cantidad       NUMERIC,
  p_destino_producto_id   UUID,
  p_destino_cantidad      NUMERIC,
  p_motivo                TEXT,
  p_usuario_id            UUID DEFAULT NULL,
  p_usuario_nombre        TEXT DEFAULT NULL,
  p_usuario_color         TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_locked          RECORD;
  v_origen          RECORD;
  v_destino         RECORD;
  v_actor_id        UUID;
  v_allow_negative  BOOLEAN := FALSE;
  v_stock_origen    NUMERIC(10,2);
  v_stock_destino   NUMERIC(10,2);
  v_lote_id         UUID := gen_random_uuid();
  v_primer_numero   INTEGER;
BEGIN
  IF p_cuenta_id IS NULL
     OR p_origen_producto_id IS NULL
     OR p_destino_producto_id IS NULL
     OR p_origen_producto_id = p_destino_producto_id
     OR p_origen_cantidad IS NULL
     OR p_origen_cantidad <= 0
     OR p_destino_cantidad IS NULL
     OR p_destino_cantidad <= 0
     OR p_motivo IS NULL
     OR char_length(trim(p_motivo)) = 0 THEN
    RAISE EXCEPTION 'PARAMETROS_TRANSFORMACION_INVALIDOS';
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

  -- Bloquear ambas filas por UUID para que dos transformaciones cruzadas no
  -- lean el mismo saldo anterior.
  FOR v_locked IN
    SELECT p.id, p.nombre, p.stock_actual, p.activo, p.cuenta_id
    FROM public.productos p
    WHERE p.id IN (p_origen_producto_id, p_destino_producto_id)
      AND p.cuenta_id = p_cuenta_id
    ORDER BY p.id
    FOR UPDATE
  LOOP
    IF v_locked.id = p_origen_producto_id THEN
      v_origen := v_locked;
    ELSE
      v_destino := v_locked;
    END IF;
  END LOOP;

  IF v_origen.id IS NULL OR v_origen.activo IS NOT TRUE THEN
    RAISE EXCEPTION 'PRODUCTO_ORIGEN_NO_DISPONIBLE';
  END IF;
  IF v_destino.id IS NULL OR v_destino.activo IS NOT TRUE THEN
    RAISE EXCEPTION 'PRODUCTO_DESTINO_NO_DISPONIBLE';
  END IF;

  v_stock_origen := ROUND((COALESCE(v_origen.stock_actual, 0) - p_origen_cantidad)::NUMERIC, 2);
  v_stock_destino := ROUND((COALESCE(v_destino.stock_actual, 0) + p_destino_cantidad)::NUMERIC, 2);

  IF v_stock_origen < 0 AND NOT v_allow_negative THEN
    RAISE EXCEPTION 'STOCK_INSUFICIENTE_ORIGEN: "%" tiene % y se intenta retirar %',
      v_origen.nombre, v_origen.stock_actual, p_origen_cantidad;
  END IF;

  UPDATE public.productos
  SET stock_actual = v_stock_origen,
      actualizado_en = now()
  WHERE id = v_origen.id;

  UPDATE public.productos
  SET stock_actual = v_stock_destino,
      actualizado_en = now()
  WHERE id = v_destino.id;

  INSERT INTO public.inventario_movimientos (
    lote_id, tipo, motivo, motivo_tipo,
    producto_id, producto_nombre, cantidad,
    stock_anterior, stock_nuevo,
    usuario_id, usuario_nombre, usuario_color, cuenta_id
  ) VALUES
    (
      v_lote_id, 'egreso', trim(p_motivo), 'transferencia',
      v_origen.id, v_origen.nombre, ROUND(p_origen_cantidad::NUMERIC, 2),
      v_origen.stock_actual, v_stock_origen,
      v_actor_id, COALESCE(NULLIF(trim(p_usuario_nombre), ''), 'Operador staging'),
      p_usuario_color, p_cuenta_id
    ),
    (
      v_lote_id, 'ingreso', trim(p_motivo), 'transferencia',
      v_destino.id, v_destino.nombre, ROUND(p_destino_cantidad::NUMERIC, 2),
      v_destino.stock_actual, v_stock_destino,
      v_actor_id, COALESCE(NULLIF(trim(p_usuario_nombre), ''), 'Operador staging'),
      p_usuario_color, p_cuenta_id
    );

  SELECT MIN(numero)
  INTO v_primer_numero
  FROM public.inventario_movimientos
  WHERE lote_id = v_lote_id;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'lote_id', v_lote_id,
    'numero', v_primer_numero,
    'origen', jsonb_build_object('id', v_origen.id, 'nombre', v_origen.nombre, 'stock_nuevo', v_stock_origen),
    'destino', jsonb_build_object('id', v_destino.id, 'nombre', v_destino.nombre, 'stock_nuevo', v_stock_destino)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.devolver_prestamo_inventario_atomico(
  p_cuenta_id      UUID,
  p_prestamo_id    UUID,
  p_cantidad       NUMERIC,
  p_usuario_id     UUID,
  p_usuario_nombre TEXT,
  p_usuario_color  TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prestamo        RECORD;
  v_producto        RECORD;
  v_actor_id        UUID;
  v_restante        NUMERIC(12,4);
  v_nueva_devuelta  NUMERIC(12,4);
  v_nuevo_estado    TEXT := 'pendiente';
  v_nuevo_stock     NUMERIC(10,2);
  v_lote_id         UUID := gen_random_uuid();
  v_movimiento_num  INTEGER;
BEGIN
  IF p_cuenta_id IS NULL
     OR p_prestamo_id IS NULL
     OR p_cantidad IS NULL
     OR p_cantidad <= 0
     OR p_usuario_id IS NULL
     OR p_usuario_nombre IS NULL
     OR char_length(trim(p_usuario_nombre)) = 0 THEN
    RAISE EXCEPTION 'PARAMETROS_DEVOLUCION_PRESTAMO_INVALIDOS';
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

  SELECT cp.*, nd.numero AS despacho_numero, nd.cuenta_id AS despacho_cuenta_id,
         c.cuenta_id AS cliente_cuenta_id
  INTO v_prestamo
  FROM public.cliente_prestamos cp
  LEFT JOIN public.notas_despacho nd ON nd.id = cp.despacho_id
  LEFT JOIN public.clientes c ON c.id = cp.cliente_id
  WHERE cp.id = p_prestamo_id
    AND (nd.cuenta_id = p_cuenta_id OR c.cuenta_id = p_cuenta_id)
  FOR UPDATE OF cp;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRESTAMO_NO_ENCONTRADO';
  END IF;

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
    SELECT p.id, p.nombre, p.unidad, p.stock_actual, p.activo, p.cuenta_id
    INTO v_producto
    FROM public.productos p
    WHERE p.id = v_prestamo.producto_id
      AND p.cuenta_id = p_cuenta_id
    FOR UPDATE;

    IF NOT FOUND OR v_producto.activo IS NOT TRUE THEN
      RAISE EXCEPTION 'PRODUCTO_PRESTAMO_NO_DISPONIBLE';
    END IF;

    v_nuevo_stock := ROUND((COALESCE(v_producto.stock_actual, 0) + p_cantidad)::NUMERIC, 2);

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
      v_lote_id, 'ingreso',
      'Devolución de préstamo — Despacho #' || COALESCE(v_prestamo.despacho_numero::TEXT, 'N/A'),
      'devolucion', v_producto.id, v_producto.nombre,
      ROUND(p_cantidad::NUMERIC, 2), COALESCE(v_producto.stock_actual, 0), v_nuevo_stock,
      v_actor_id, trim(p_usuario_nombre), p_usuario_color, p_cuenta_id
    )
    RETURNING numero INTO v_movimiento_num;
  END IF;

  UPDATE public.cliente_prestamos
  SET cantidad_devuelta = v_nueva_devuelta,
      estado = v_nuevo_estado
  WHERE id = p_prestamo_id;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'prestamo_id', p_prestamo_id,
    'nuevo_estado', v_nuevo_estado,
    'cantidad_devuelta', v_nueva_devuelta,
    'lote_id', CASE WHEN v_prestamo.producto_id IS NOT NULL THEN v_lote_id ELSE NULL END,
    'numero', v_movimiento_num
  );
END;
$$;

REVOKE ALL ON FUNCTION public.aplicar_movimiento_inventario_atomico(UUID, tipo_movimiento, TEXT, motivo_movimiento, JSONB, UUID, TEXT, TEXT)
  FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.aplicar_movimiento_inventario_atomico(UUID, tipo_movimiento, TEXT, motivo_movimiento, JSONB, UUID, TEXT, TEXT)
  TO service_role;

REVOKE ALL ON FUNCTION public.transformar_inventario_atomico(UUID, UUID, NUMERIC, UUID, NUMERIC, TEXT, UUID, TEXT, TEXT)
  FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.transformar_inventario_atomico(UUID, UUID, NUMERIC, UUID, NUMERIC, TEXT, UUID, TEXT, TEXT)
  TO service_role;

REVOKE ALL ON FUNCTION public.devolver_prestamo_inventario_atomico(UUID, UUID, NUMERIC, UUID, TEXT, TEXT)
  FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.devolver_prestamo_inventario_atomico(UUID, UUID, NUMERIC, UUID, TEXT, TEXT)
  TO service_role;

NOTIFY pgrst, 'reload schema';
