-- ============================================================
-- RPC: reciclar_cotizacion
-- Crea nueva cotización borrador a partir de una rechazada/anulada/vencida
-- Permite reasignar a otro vendedor
-- Registra auditoría completa
-- ============================================================
CREATE OR REPLACE FUNCTION public.reciclar_cotizacion(
  p_cotizacion_id       UUID,
  p_vendedor_destino_id UUID
)
RETURNS UUID  -- Retorna el ID de la nueva cotización borrador
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_usuario_id         UUID := auth.uid();
  v_usuario_nombre     TEXT;
  v_cotizacion_orig    RECORD;
  v_vendedor_orig_name TEXT;
  v_vendedor_dest_name TEXT;
  v_nueva_id           UUID;
  v_nuevo_numero       BIGINT;
BEGIN
  -- 1. Validar caller: solo supervisores activos
  SELECT nombre INTO v_usuario_nombre
  FROM public.usuarios
  WHERE id = v_usuario_id AND rol = 'supervisor' AND activo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACCESO_DENEGADO: Solo supervisores pueden reciclar cotizaciones';
  END IF;

  -- 2. Obtener la cotización original
  SELECT * INTO v_cotizacion_orig
  FROM public.cotizaciones
  WHERE id = p_cotizacion_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COTIZACION_NO_ENCONTRADA';
  END IF;

  -- 3. Solo se puede reciclar cotizaciones rechazadas, anuladas o vencidas
  IF v_cotizacion_orig.estado NOT IN ('rechazada', 'anulada', 'vencida') THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO: Solo se pueden reciclar cotizaciones rechazadas, anuladas o vencidas';
  END IF;

  -- 4. Validar vendedor destino: debe ser usuario activo
  SELECT nombre INTO v_vendedor_dest_name
  FROM public.usuarios
  WHERE id = p_vendedor_destino_id AND activo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'VENDEDOR_INVALIDO: El vendedor destino no existe o está inactivo';
  END IF;

  -- 5. Obtener nombre del vendedor original
  SELECT nombre INTO v_vendedor_orig_name
  FROM public.usuarios
  WHERE id = v_cotizacion_orig.vendedor_id;

  -- 6. Crear nueva cotización borrador (nuevo correlativo automático)
  INSERT INTO public.cotizaciones (
    version, cliente_id, vendedor_id, transportista_id,
    estado, subtotal_usd, descuento_global_pct, descuento_usd,
    costo_envio_usd, total_usd,
    notas_cliente, notas_internas
  ) VALUES (
    1, v_cotizacion_orig.cliente_id, p_vendedor_destino_id,
    v_cotizacion_orig.transportista_id,
    'borrador', v_cotizacion_orig.subtotal_usd, v_cotizacion_orig.descuento_global_pct,
    v_cotizacion_orig.descuento_usd, v_cotizacion_orig.costo_envio_usd,
    v_cotizacion_orig.total_usd,
    v_cotizacion_orig.notas_cliente, v_cotizacion_orig.notas_internas
  )
  RETURNING id, numero INTO v_nueva_id, v_nuevo_numero;

  -- 7. Copiar items de la cotización original
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
  WHERE ci.cotizacion_id = p_cotizacion_id;

  -- 8. Auditoría
  PERFORM public.registrar_auditoria(
    p_usuario_id     := v_usuario_id,
    p_usuario_nombre := v_usuario_nombre,
    p_usuario_rol    := 'supervisor',
    p_categoria      := 'COTIZACION',
    p_accion         := 'RECICLAR_COTIZACION',
    p_descripcion    := format(
      'Cotización COT-%s reciclada → COT-%s. Vendedor: %s → %s',
      lpad(v_cotizacion_orig.numero::text, 5, '0'),
      lpad(v_nuevo_numero::text, 5, '0'),
      coalesce(v_vendedor_orig_name, '—'),
      v_vendedor_dest_name
    ),
    p_entidad_tipo   := 'cotizacion',
    p_entidad_id     := v_nueva_id,
    p_meta           := jsonb_build_object(
      'cotizacion_original_id', p_cotizacion_id,
      'cotizacion_original_numero', v_cotizacion_orig.numero,
      'estado_original', v_cotizacion_orig.estado,
      'vendedor_origen_id', v_cotizacion_orig.vendedor_id,
      'vendedor_origen_nombre', coalesce(v_vendedor_orig_name, '—'),
      'vendedor_destino_id', p_vendedor_destino_id,
      'vendedor_destino_nombre', v_vendedor_dest_name,
      'total_usd', v_cotizacion_orig.total_usd,
      'nuevo_numero', v_nuevo_numero
    )
  );

  RETURN v_nueva_id;
END;
$$;
