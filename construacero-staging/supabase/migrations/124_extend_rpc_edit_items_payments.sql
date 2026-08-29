-- 124_extend_rpc_edit_items_payments.sql
-- Extiende el RPC editar_despacho_profundidad para permitir la actualización de pagos.

CREATE OR REPLACE FUNCTION public.editar_despacho_profundidad(
  p_despacho_id    UUID,
  p_nuevos_items   JSONB,
  p_usuario_id     UUID     DEFAULT NULL,
  p_usuario_nombre TEXT     DEFAULT 'Sistema',
  p_usuario_rol    TEXT     DEFAULT 'sistema',
  p_forma_pago     TEXT     DEFAULT NULL
)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_despacho    RECORD;
  v_item_json   RECORD;
  v_total_items NUMERIC(12,4) := 0;
BEGIN
  -- 1. Validar permisos
  IF p_usuario_rol NOT IN ('administracion', 'jefe', 'desarrollador') THEN
    RAISE EXCEPTION 'ACCESO_DENEGADO: Solo administración puede editar despachos a profundidad';
  END IF;

  -- 2. Bloquear despacho
  SELECT * INTO v_despacho FROM public.notas_despacho WHERE id = p_despacho_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DESPACHO_NO_ENCONTRADO'; END IF;

  IF v_despacho.estado IN ('entregada', 'anulada') THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO: No se puede editar un despacho %', v_despacho.estado;
  END IF;

  -- 3. Devolver stock anterior al inventario
  UPDATE public.productos p
  SET stock_actual = p.stock_actual + di.cantidad
  FROM public.notas_despacho_items di
  WHERE p.id = di.producto_id AND di.despacho_id = p_despacho_id;

  -- 4. Borrar ítems viejos
  DELETE FROM public.notas_despacho_items WHERE despacho_id = p_despacho_id;

  -- 5. Insertar nuevos ítems y descontar stock
  FOR v_item_json IN SELECT * FROM jsonb_to_recordset(p_nuevos_items) AS x(
    producto_id UUID, codigo_snap TEXT, nombre_snap TEXT, unidad_snap TEXT,
    cantidad NUMERIC, precio_unit_usd NUMERIC, descuento_pct NUMERIC, orden INTEGER
  ) LOOP

    -- Validar stock
    IF NOT EXISTS (
      SELECT 1 FROM public.productos
      WHERE id = v_item_json.producto_id AND stock_actual >= v_item_json.cantidad
    ) THEN
      RAISE EXCEPTION 'STOCK_INSUFICIENTE: El producto "%" no tiene stock suficiente', v_item_json.nombre_snap;
    END IF;

    -- Descontar stock
    UPDATE public.productos
    SET stock_actual = stock_actual - v_item_json.cantidad
    WHERE id = v_item_json.producto_id;

    -- Insertar ítem
    INSERT INTO public.notas_despacho_items (
      despacho_id, producto_id, codigo_snap, nombre_snap, unidad_snap,
      cantidad_original, precio_original,
      cantidad, precio_unit_usd, descuento_pct, total_linea_usd, orden
    ) VALUES (
      p_despacho_id,
      v_item_json.producto_id,
      v_item_json.codigo_snap,
      v_item_json.nombre_snap,
      v_item_json.unidad_snap,
      v_item_json.cantidad,
      v_item_json.precio_unit_usd,
      v_item_json.cantidad,
      v_item_json.precio_unit_usd,
      COALESCE(v_item_json.descuento_pct, 0),
      (v_item_json.cantidad * v_item_json.precio_unit_usd * (1 - COALESCE(v_item_json.descuento_pct, 0) / 100)),
      v_item_json.orden
    );

    v_total_items := v_total_items
      + (v_item_json.cantidad * v_item_json.precio_unit_usd * (1 - COALESCE(v_item_json.descuento_pct, 0) / 100));
  END LOOP;

  -- 6. Recalcular total de la cabecera Y actualizar pagos si se proporcionan
  UPDATE public.notas_despacho
  SET 
    total_usd = v_total_items + COALESCE(flete_usd, 0) + COALESCE(corte_usd, 0) - COALESCE(descuento_total_usd, 0),
    forma_pago_cliente = COALESCE(p_forma_pago, forma_pago_cliente),
    forma_pago = COALESCE(p_forma_pago, forma_pago) -- Sincronizar ambos campos por seguridad
  WHERE id = p_despacho_id;

  -- 7. Auditoría
  PERFORM public.registrar_auditoria(
    p_usuario_id     := p_usuario_id,
    p_usuario_nombre := p_usuario_nombre,
    p_usuario_rol    := p_usuario_rol,
    p_categoria      := 'COTIZACION',
    p_accion         := 'EDITAR_DESPACHO_PROFUNDIDAD',
    p_entidad_tipo   := 'nota_despacho',
    p_entidad_id     := p_despacho_id,
    p_meta           := jsonb_build_object(
      'total_anterior', v_despacho.total_usd,
      'total_nuevo',    (v_total_items + COALESCE(v_despacho.flete_usd, 0) + COALESCE(v_despacho.corte_usd, 0) - COALESCE(v_despacho.descuento_total_usd, 0)),
      'pagos_actualizados', (p_forma_pago IS NOT NULL)
    )
  );

END;
$$;
