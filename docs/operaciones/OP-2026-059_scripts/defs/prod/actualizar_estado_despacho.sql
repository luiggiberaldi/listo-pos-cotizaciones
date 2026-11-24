CREATE OR REPLACE FUNCTION public.actualizar_estado_despacho(p_despacho_id uuid, p_nuevo_estado text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_usuario_id     UUID := public.get_operador_id();
  v_usuario_nombre TEXT;
  v_despacho       RECORD;
  v_item           RECORD;
BEGIN
  SELECT nombre INTO v_usuario_nombre
  FROM public.usuarios
  WHERE id = v_usuario_id AND rol = 'supervisor' AND activo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACCESO_DENEGADO: Solo supervisores pueden actualizar despachos';
  END IF;

  SELECT * INTO v_despacho
  FROM public.notas_despacho
  WHERE id = p_despacho_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DESPACHO_NO_ENCONTRADO';
  END IF;

  IF NOT (
    (v_despacho.estado = 'pendiente'  AND p_nuevo_estado IN ('despachada', 'anulada'))
    OR
    (v_despacho.estado = 'despachada' AND p_nuevo_estado IN ('entregada', 'anulada'))
  ) THEN
    RAISE EXCEPTION 'TRANSICION_INVALIDA: No se puede pasar de "%" a "%"',
      v_despacho.estado, p_nuevo_estado;
  END IF;

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

  UPDATE public.notas_despacho
  SET
    estado = p_nuevo_estado,
    despachada_en = CASE WHEN p_nuevo_estado = 'despachada' THEN now() ELSE despachada_en END,
    entregada_en  = CASE WHEN p_nuevo_estado = 'entregada'  THEN now() ELSE entregada_en END
  WHERE id = p_despacho_id;

  IF p_nuevo_estado = 'entregada' THEN
    PERFORM public.calcular_comision_despacho(p_despacho_id);
  END IF;

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
$function$
