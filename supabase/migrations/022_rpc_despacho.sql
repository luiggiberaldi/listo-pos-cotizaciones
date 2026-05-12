-- 022_rpc_despacho.sql
-- RPCs para el sistema de notas de despacho
-- Stock se descuenta atómicamente al crear la nota


-- ============================================================
-- RPC 1: crear_nota_despacho
-- Crea nota de despacho desde cotización aceptada y descuenta stock
-- ============================================================
CREATE OR REPLACE FUNCTION public.crear_nota_despacho(
  p_cotizacion_id  UUID,
  p_notas          TEXT DEFAULT NULL
)
RETURNS UUID  -- Retorna el ID de la nota de despacho
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_usuario_id     UUID := auth.uid();
  v_usuario_nombre TEXT;
  v_cotizacion     RECORD;
  v_item           RECORD;
  v_stock_actual   NUMERIC;
  v_despacho_id    UUID;
BEGIN
  -- 1. Validar caller: solo supervisores activos
  SELECT nombre INTO v_usuario_nombre
  FROM public.usuarios
  WHERE id = v_usuario_id AND rol = 'supervisor' AND activo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACCESO_DENEGADO: Solo supervisores pueden crear notas de despacho';
  END IF;

  -- 2. Obtener y bloquear la cotización (previene race conditions)
  SELECT * INTO v_cotizacion
  FROM public.cotizaciones
  WHERE id = p_cotizacion_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COTIZACION_NO_ENCONTRADA';
  END IF;

  -- 3. Solo se puede despachar cotizaciones enviadas o aceptadas
  IF v_cotizacion.estado NOT IN ('enviada', 'aceptada') THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO: La cotización debe estar enviada o aceptada para despachar';
  END IF;

  -- Si está enviada, pasarla a aceptada primero
  IF v_cotizacion.estado = 'enviada' THEN
    UPDATE public.cotizaciones SET estado = 'aceptada' WHERE id = p_cotizacion_id;
  END IF;

  -- 4. Verificar que no exista despacho previo
  IF EXISTS (SELECT 1 FROM public.notas_despacho WHERE cotizacion_id = p_cotizacion_id) THEN
    RAISE EXCEPTION 'DESPACHO_EXISTENTE: Ya existe una nota de despacho para esta cotización';
  END IF;

  -- 5. Verificar stock de TODOS los items antes de descontar
  FOR v_item IN
    SELECT ci.producto_id, ci.cantidad, ci.nombre_snap
    FROM public.cotizacion_items ci
    WHERE ci.cotizacion_id = p_cotizacion_id
      AND ci.producto_id IS NOT NULL
  LOOP
    SELECT stock_actual INTO v_stock_actual
    FROM public.productos
    WHERE id = v_item.producto_id AND activo = true
    FOR UPDATE;  -- bloquear fila del producto

    IF NOT FOUND THEN
      RAISE EXCEPTION 'PRODUCTO_NO_ENCONTRADO: El producto "%" ya no existe o está inactivo', v_item.nombre_snap;
    END IF;

    IF v_stock_actual < v_item.cantidad THEN
      RAISE EXCEPTION 'STOCK_INSUFICIENTE: "%" requiere % pero solo hay % disponible',
        v_item.nombre_snap, v_item.cantidad, v_stock_actual;
    END IF;
  END LOOP;

  -- 6. Descontar stock (todas las validaciones pasaron)
  FOR v_item IN
    SELECT ci.producto_id, ci.cantidad
    FROM public.cotizacion_items ci
    WHERE ci.cotizacion_id = p_cotizacion_id
      AND ci.producto_id IS NOT NULL
  LOOP
    UPDATE public.productos
    SET stock_actual = stock_actual - v_item.cantidad
    WHERE id = v_item.producto_id;
  END LOOP;

  -- 7. Crear la nota de despacho
  INSERT INTO public.notas_despacho (
    cotizacion_id, cliente_id, vendedor_id, transportista_id,
    estado, total_usd, notas, creado_por
  ) VALUES (
    p_cotizacion_id, v_cotizacion.cliente_id, v_cotizacion.vendedor_id,
    v_cotizacion.transportista_id,
    'pendiente', v_cotizacion.total_usd, p_notas, v_usuario_id
  )
  RETURNING id INTO v_despacho_id;

  -- 8. Auditoría
  PERFORM public.registrar_auditoria(
    p_usuario_id     := v_usuario_id,
    p_usuario_nombre := v_usuario_nombre,
    p_usuario_rol    := 'supervisor',
    p_categoria      := 'COTIZACION',
    p_accion         := 'CREAR_DESPACHO',
    p_entidad_tipo   := 'nota_despacho',
    p_entidad_id     := v_despacho_id,
    p_meta           := jsonb_build_object(
      'cotizacion_id', p_cotizacion_id,
      'total_usd', v_cotizacion.total_usd
    )
  );

  RETURN v_despacho_id;
END;
$$;


-- ============================================================
-- RPC 2: actualizar_estado_despacho
-- Transiciona el estado de una nota de despacho
-- Transiciones válidas:
--   pendiente  → despachada, anulada (restaura stock)
--   despachada → entregada, anulada (restaura stock)
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
  v_despacho       RECORD;
  v_item           RECORD;
BEGIN
  -- 1. Validar caller: solo supervisores activos
  SELECT nombre INTO v_usuario_nombre
  FROM public.usuarios
  WHERE id = v_usuario_id AND rol = 'supervisor' AND activo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACCESO_DENEGADO: Solo supervisores pueden actualizar despachos';
  END IF;

  -- 2. Obtener y bloquear el despacho
  SELECT * INTO v_despacho
  FROM public.notas_despacho
  WHERE id = p_despacho_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DESPACHO_NO_ENCONTRADO';
  END IF;

  -- 3. Validar transición de estado
  IF NOT (
    (v_despacho.estado = 'pendiente'  AND p_nuevo_estado IN ('despachada', 'anulada'))
    OR
    (v_despacho.estado = 'despachada' AND p_nuevo_estado IN ('entregada', 'anulada'))
  ) THEN
    RAISE EXCEPTION 'TRANSICION_INVALIDA: No se puede pasar de "%" a "%"',
      v_despacho.estado, p_nuevo_estado;
  END IF;

  -- 4. Si se anula desde pendiente o despachada, restaurar stock
  IF p_nuevo_estado = 'anulada' AND v_despacho.estado IN ('pendiente', 'despachada') THEN
    FOR v_item IN
      SELECT ci.producto_id, ci.cantidad
      FROM public.cotizacion_items ci
      WHERE ci.cotizacion_id = v_despacho.cotizacion_id
        AND ci.producto_id IS NOT NULL
    LOOP
      UPDATE public.productos
      SET stock_actual = stock_actual + v_item.cantidad
      WHERE id = v_item.producto_id;
    END LOOP;
  END IF;

  -- 5. Actualizar estado
  UPDATE public.notas_despacho
  SET
    estado = p_nuevo_estado,
    despachada_en = CASE WHEN p_nuevo_estado = 'despachada' THEN now() ELSE despachada_en END,
    entregada_en  = CASE WHEN p_nuevo_estado = 'entregada'  THEN now() ELSE entregada_en END
  WHERE id = p_despacho_id;

  -- 6. Auditoría
  PERFORM public.registrar_auditoria(
    p_usuario_id     := v_usuario_id,
    p_usuario_nombre := v_usuario_nombre,
    p_usuario_rol    := 'supervisor',
    p_categoria      := 'COTIZACION',
    p_accion         := 'ACTUALIZAR_DESPACHO',
    p_entidad_tipo   := 'nota_despacho',
    p_entidad_id     := p_despacho_id,
    p_meta           := jsonb_build_object(
      'estado_anterior', v_despacho.estado,
      'estado_nuevo', p_nuevo_estado,
      'cotizacion_id', v_despacho.cotizacion_id
    )
  );
END;
$$;


-- ============================================================
-- RPC 3: reciclar_despacho
-- Convierte un despacho anulado en una cotización borrador nueva
-- Copia los items de la cotización original con nuevo correlativo
-- ============================================================
CREATE OR REPLACE FUNCTION public.reciclar_despacho(
  p_despacho_id  UUID
)
RETURNS UUID  -- Retorna el ID de la nueva cotización borrador
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_usuario_id      UUID := auth.uid();
  v_usuario_nombre  TEXT;
  v_despacho        RECORD;
  v_cotizacion_orig RECORD;
  v_nueva_id        UUID;
BEGIN
  -- 1. Validar caller: solo supervisores activos
  SELECT nombre INTO v_usuario_nombre
  FROM public.usuarios
  WHERE id = v_usuario_id AND rol = 'supervisor' AND activo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACCESO_DENEGADO: Solo supervisores pueden reciclar despachos';
  END IF;

  -- 2. Obtener el despacho
  SELECT * INTO v_despacho
  FROM public.notas_despacho
  WHERE id = p_despacho_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DESPACHO_NO_ENCONTRADO';
  END IF;

  -- 3. Solo se puede reciclar despachos anulados
  IF v_despacho.estado <> 'anulada' THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO: Solo se pueden reciclar despachos anulados';
  END IF;

  -- 4. Obtener la cotización original para copiar datos
  SELECT * INTO v_cotizacion_orig
  FROM public.cotizaciones
  WHERE id = v_despacho.cotizacion_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COTIZACION_NO_ENCONTRADA';
  END IF;

  -- 5. Crear nueva cotización borrador (nuevo correlativo automático)
  INSERT INTO public.cotizaciones (
    version, cliente_id, vendedor_id, transportista_id,
    estado, subtotal_usd, descuento_global_pct, descuento_usd,
    costo_envio_usd, total_usd,
    notas_cliente, notas_internas
  ) VALUES (
    1, v_cotizacion_orig.cliente_id, v_cotizacion_orig.vendedor_id,
    v_cotizacion_orig.transportista_id,
    'borrador', v_cotizacion_orig.subtotal_usd, v_cotizacion_orig.descuento_global_pct,
    v_cotizacion_orig.descuento_usd, v_cotizacion_orig.costo_envio_usd,
    v_cotizacion_orig.total_usd,
    v_cotizacion_orig.notas_cliente, v_cotizacion_orig.notas_internas
  )
  RETURNING id INTO v_nueva_id;

  -- 6. Copiar items de la cotización original
  INSERT INTO public.cotizacion_items (
    cotizacion_id, producto_id, codigo_snap, nombre_snap,
    unidad_snap, cantidad, precio_unit_usd, descuento_pct,
    total_linea_usd, orden
  )
  SELECT
    v_nueva_id, ci.producto_id, ci.codigo_snap, ci.nombre_snap,
    ci.unidad_snap, ci.cantidad, ci.precio_unit_usd, ci.descuento_pct,
    ci.total_linea_usd, ci.orden
  FROM public.cotizacion_items ci
  WHERE ci.cotizacion_id = v_despacho.cotizacion_id;

  -- 7. Auditoría
  PERFORM public.registrar_auditoria(
    p_usuario_id     := v_usuario_id,
    p_usuario_nombre := v_usuario_nombre,
    p_usuario_rol    := 'supervisor',
    p_categoria      := 'COTIZACION',
    p_accion         := 'RECICLAR_DESPACHO',
    p_entidad_tipo   := 'cotizacion',
    p_entidad_id     := v_nueva_id,
    p_meta           := jsonb_build_object(
      'despacho_id', p_despacho_id,
      'cotizacion_original_id', v_despacho.cotizacion_id,
      'total_usd', v_cotizacion_orig.total_usd
    )
  );

  RETURN v_nueva_id;
END;
$$;
