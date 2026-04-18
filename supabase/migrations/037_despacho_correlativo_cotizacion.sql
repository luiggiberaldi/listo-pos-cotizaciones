-- 037_despacho_correlativo_cotizacion.sql
-- El número de la nota de despacho debe coincidir con el número de la cotización origen
-- Usamos OVERRIDING SYSTEM VALUE para insertar el número específico en la columna IDENTITY

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
    FOR UPDATE;

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

  -- 7. Crear la nota de despacho con el mismo número que la cotización
  INSERT INTO public.notas_despacho (
    numero, cotizacion_id, cliente_id, vendedor_id, transportista_id,
    estado, total_usd, notas, creado_por
  ) OVERRIDING SYSTEM VALUE VALUES (
    v_cotizacion.numero,
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
