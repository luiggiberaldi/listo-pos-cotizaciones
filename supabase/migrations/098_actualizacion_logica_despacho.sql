-- 098_actualizacion_logica_despacho.sql
-- Actualización de RPCs para soportar el desacoplamiento de ítems y edición profunda

-- ============================================================
-- 1. ACTUALIZAR: crear_nota_despacho
-- Ahora clona los ítems a la nueva tabla notas_despacho_items
-- ============================================================
CREATE OR REPLACE FUNCTION public.crear_nota_despacho(
  p_cotizacion_id  UUID,
  p_notas          TEXT DEFAULT NULL
)
RETURNS UUID
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_usuario_id     UUID := auth.uid();
  v_usuario_nombre TEXT;
  v_usuario_rol    TEXT;
  v_cotizacion     RECORD;
  v_item           RECORD;
  v_stock_actual   NUMERIC;
  v_despacho_id    UUID;
BEGIN
  -- 1. Validar caller: supervisores, admin o jefes activos
  SELECT nombre, rol INTO v_usuario_nombre, v_usuario_rol
  FROM public.usuarios
  WHERE id = v_usuario_id AND activo = true;

  IF v_usuario_rol NOT IN ('supervisor', 'administracion', 'jefe', 'desarrollador') THEN
    RAISE EXCEPTION 'ACCESO_DENEGADO: No tienes permisos para crear notas de despacho';
  END IF;

  -- 2. Obtener y bloquear la cotización
  SELECT * INTO v_cotizacion
  FROM public.cotizaciones
  WHERE id = p_cotizacion_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COTIZACION_NO_ENCONTRADA';
  END IF;

  -- 3. Validar estado
  IF v_cotizacion.estado NOT IN ('enviada', 'aceptada') THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO: La cotización debe estar enviada o aceptada';
  END IF;

  -- Pasar a aceptada si estaba enviada
  IF v_cotizacion.estado = 'enviada' THEN
    UPDATE public.cotizaciones SET estado = 'aceptada' WHERE id = p_cotizacion_id;
  END IF;

  -- 4. Verificar duplicados
  IF EXISTS (SELECT 1 FROM public.notas_despacho WHERE cotizacion_id = p_cotizacion_id) THEN
    RAISE EXCEPTION 'DESPACHO_EXISTENTE';
  END IF;

  -- 5. Verificar stock
  FOR v_item IN
    SELECT ci.producto_id, ci.cantidad, ci.nombre_snap
    FROM public.cotizacion_items ci
    WHERE ci.cotizacion_id = p_cotizacion_id AND ci.producto_id IS NOT NULL
  LOOP
    SELECT stock_actual INTO v_stock_actual FROM public.productos WHERE id = v_item.producto_id FOR UPDATE;
    IF v_stock_actual < v_item.cantidad THEN
      RAISE EXCEPTION 'STOCK_INSUFICIENTE: "%"', v_item.nombre_snap;
    END IF;
  END LOOP;

  -- 6. Crear cabecera de despacho
  INSERT INTO public.notas_despacho (
    cotizacion_id, cliente_id, vendedor_id, transportista_id,
    estado, total_usd, notas, creado_por
  ) VALUES (
    p_cotizacion_id, v_cotizacion.cliente_id, v_cotizacion.vendedor_id,
    v_cotizacion.transportista_id,
    'pendiente', v_cotizacion.total_usd, p_notas, v_usuario_id
  )
  RETURNING id INTO v_despacho_id;

  -- 7. Clonar ítems y descontar stock
  INSERT INTO public.notas_despacho_items (
    despacho_id, producto_id, codigo_snap, nombre_snap,
    unidad_snap, cantidad, precio_unit_usd, descuento_pct,
    total_linea_usd, orden
  )
  SELECT
    v_despacho_id, ci.producto_id, ci.codigo_snap, ci.nombre_snap,
    ci.unidad_snap, ci.cantidad, ci.precio_unit_usd, ci.descuento_pct,
    ci.total_linea_usd, ci.orden
  FROM public.cotizacion_items ci
  WHERE ci.cotizacion_id = p_cotizacion_id;

  -- Descontar stock real
  UPDATE public.productos p
  SET stock_actual = p.stock_actual - items.cantidad
  FROM public.cotizacion_items items
  WHERE p.id = items.producto_id AND items.cotizacion_id = p_cotizacion_id;

  -- 8. Auditoría
  PERFORM public.registrar_auditoria(
    p_usuario_id := v_usuario_id, p_usuario_nombre := v_usuario_nombre, p_usuario_rol := v_usuario_rol,
    p_categoria := 'COTIZACION', p_accion := 'CREAR_DESPACHO',
    p_entidad_tipo := 'nota_despacho', p_entidad_id := v_despacho_id,
    p_meta := jsonb_build_object('cotizacion_id', p_cotizacion_id)
  );

  RETURN v_despacho_id;
END;
$$;

-- ============================================================
-- 2. ACTUALIZAR: actualizar_estado_despacho
-- Ahora restaura stock desde notas_despacho_items
-- ============================================================
CREATE OR REPLACE FUNCTION public.actualizar_estado_despacho(
  p_despacho_id   UUID,
  p_nuevo_estado  TEXT
)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_usuario_id     UUID := auth.uid();
  v_usuario_nombre TEXT;
  v_usuario_rol    TEXT;
  v_despacho       RECORD;
BEGIN
  SELECT nombre, rol INTO v_usuario_nombre, v_usuario_rol
  FROM public.usuarios WHERE id = v_usuario_id AND activo = true;

  SELECT * INTO v_despacho FROM public.notas_despacho WHERE id = p_despacho_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DESPACHO_NO_ENCONTRADO'; END IF;

  -- Restaurar stock si se anula
  IF p_nuevo_estado = 'anulada' AND v_despacho.estado IN ('pendiente', 'despachada') THEN
    UPDATE public.productos p
    SET stock_actual = p.stock_actual + di.cantidad
    FROM public.notas_despacho_items di
    WHERE p.id = di.producto_id AND di.despacho_id = p_despacho_id;
  END IF;

  UPDATE public.notas_despacho
  SET
    estado = p_nuevo_estado,
    despachada_en = CASE WHEN p_nuevo_estado = 'despachada' THEN now() ELSE despachada_en END,
    entregada_en  = CASE WHEN p_nuevo_estado = 'entregada'  THEN now() ELSE entregada_en END
  WHERE id = p_despacho_id;

  PERFORM public.registrar_auditoria(
    p_usuario_id := v_usuario_id, p_usuario_nombre := v_usuario_nombre, p_usuario_rol := v_usuario_rol,
    p_categoria := 'COTIZACION', p_accion := 'ACTUALIZAR_ESTADO_DESPACHO',
    p_entidad_tipo := 'nota_despacho', p_entidad_id := p_despacho_id,
    p_meta := jsonb_build_object('nuevo_estado', p_nuevo_estado)
  );
END;
$$;

-- ============================================================
-- 3. NUEVO: editar_despacho_profundidad
-- Permite a administración cambiar ítems y cantidades con ajuste de inventario
-- ============================================================
CREATE OR REPLACE FUNCTION public.editar_despacho_profundidad(
  p_despacho_id  UUID,
  p_nuevos_items JSONB  -- Array de objetos: {producto_id, cantidad, precio_unit_usd, descuento_pct, ...}
)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_usuario_id     UUID := auth.uid();
  v_usuario_nombre TEXT;
  v_usuario_rol    TEXT;
  v_despacho       RECORD;
  v_item_json      RECORD;
  v_total_nuevo    NUMERIC(12,4) := 0;
BEGIN
  -- 1. Validar permisos: solo administración o jefes
  SELECT nombre, rol INTO v_usuario_nombre, v_usuario_rol
  FROM public.usuarios WHERE id = v_usuario_id AND activo = true;

  IF v_usuario_rol NOT IN ('administracion', 'jefe', 'desarrollador') THEN
    RAISE EXCEPTION 'ACCESO_DENEGADO: Solo administración puede editar despachos a profundidad';
  END IF;

  -- 2. Bloquear despacho y productos
  SELECT * INTO v_despacho FROM public.notas_despacho WHERE id = p_despacho_id FOR UPDATE;
  IF v_despacho.estado IN ('entregada', 'anulada') THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO: No se puede editar un despacho %', v_despacho.estado;
  END IF;

  -- 3. PASO CRÍTICO: Devolver TODO el stock actual del despacho al inventario temporalmente
  UPDATE public.productos p
  SET stock_actual = p.stock_actual + di.cantidad
  FROM public.notas_despacho_items di
  WHERE p.id = di.producto_id AND di.despacho_id = p_despacho_id;

  -- 4. Limpiar ítems viejos
  DELETE FROM public.notas_despacho_items WHERE despacho_id = p_despacho_id;

  -- 5. Insertar nuevos ítems y volver a descontar stock
  FOR v_item_json IN SELECT * FROM jsonb_to_recordset(p_nuevos_items) AS x(
    producto_id UUID, codigo_snap TEXT, nombre_snap TEXT, unidad_snap TEXT,
    cantidad NUMERIC, precio_unit_usd NUMERIC, descuento_pct NUMERIC, orden INTEGER
  ) LOOP
    
    -- Validar stock disponible (después de haber devuelto lo anterior)
    IF NOT EXISTS (SELECT 1 FROM public.productos WHERE id = v_item_json.producto_id AND stock_actual >= v_item_json.cantidad) THEN
      RAISE EXCEPTION 'STOCK_INSUFICIENTE: El producto "%" no tiene stock suficiente para este cambio', v_item_json.nombre_snap;
    END IF;

    -- Descontar nuevo stock
    UPDATE public.productos SET stock_actual = stock_actual - v_item_json.cantidad WHERE id = v_item_json.producto_id;

    -- Insertar ítem
    INSERT INTO public.notas_despacho_items (
      despacho_id, producto_id, codigo_snap, nombre_snap, unidad_snap,
      cantidad, precio_unit_usd, descuento_pct, total_linea_usd, orden
    ) VALUES (
      p_despacho_id, v_item_json.producto_id, v_item_json.codigo_snap, v_item_json.nombre_snap, v_item_json.unidad_snap,
      v_item_json.cantidad, v_item_json.precio_unit_usd, v_item_json.descuento_pct,
      (v_item_json.cantidad * v_item_json.precio_unit_usd * (1 - v_item_json.descuento_pct/100)),
      v_item_json.orden
    );

    v_total_nuevo := v_total_nuevo + (v_item_json.cantidad * v_item_json.precio_unit_usd * (1 - v_item_json.descuento_pct/100));
  END LOOP;

  -- 6. Actualizar total de la cabecera
  UPDATE public.notas_despacho SET total_usd = v_total_nuevo WHERE id = p_despacho_id;

  -- 7. Auditoría
  PERFORM public.registrar_auditoria(
    p_usuario_id := v_usuario_id, p_usuario_nombre := v_usuario_nombre, p_usuario_rol := v_usuario_rol,
    p_categoria := 'COTIZACION', p_accion := 'EDITAR_DESPACHO_PROFUNDIDAD',
    p_entidad_tipo := 'nota_despacho', p_entidad_id := p_despacho_id,
    p_meta := jsonb_build_object('total_anterior', v_despacho.total_usd, 'total_nuevo', v_total_nuevo)
  );

END;
$$;
