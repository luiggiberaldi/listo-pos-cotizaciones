-- 239: Supervisor con edición profunda global, solo en despachos pendientes
--
-- La autorización se aplica en API y en esta función SECURITY DEFINER.
-- La edición profunda no altera stock: el descuento físico ocurre al entregar.

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
  v_operador    RECORD;
  v_item_json   RECORD;
  v_producto    RECORD;
  v_total_items NUMERIC(12,4) := 0;
  v_total_nuevo NUMERIC(12,4);
BEGIN
  IF p_despacho_id IS NULL THEN
    RAISE EXCEPTION 'DESPACHO_ID_OBLIGATORIO';
  END IF;

  IF p_nuevos_items IS NULL OR jsonb_typeof(p_nuevos_items) <> 'array'
     OR jsonb_array_length(p_nuevos_items) = 0 THEN
    RAISE EXCEPTION 'ITEMS_INVALIDOS: Debe proporcionar al menos un ítem';
  END IF;

  SELECT id, cuenta_id, rol, activo
    INTO v_operador
  FROM public.usuarios
  WHERE id = p_usuario_id;

  IF NOT FOUND OR COALESCE(v_operador.activo, FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'ACCESO_DENEGADO: Operador inválido o inactivo';
  END IF;

  IF v_operador.rol NOT IN ('supervisor', 'administracion', 'jefe', 'desarrollador') THEN
    RAISE EXCEPTION 'ACCESO_DENEGADO: Rol no autorizado para editar despachos a profundidad';
  END IF;

  IF p_usuario_rol IS DISTINCT FROM v_operador.rol THEN
    RAISE EXCEPTION 'ACCESO_DENEGADO: El rol informado no coincide con el operador';
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

  IF v_despacho.estado <> 'pendiente' THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO: Solo se puede editar un despacho pendiente';
  END IF;

  -- Reemplazar el snapshot completo dentro de la misma transacción.
  DELETE FROM public.notas_despacho_items
  WHERE despacho_id = p_despacho_id;

  FOR v_item_json IN
    SELECT * FROM jsonb_to_recordset(p_nuevos_items) AS x(
      producto_id UUID,
      codigo_snap TEXT,
      nombre_snap TEXT,
      unidad_snap TEXT,
      cantidad NUMERIC,
      precio_unit_usd NUMERIC,
      descuento_pct NUMERIC,
      orden INTEGER,
      origen TEXT,
      es_prestamo BOOLEAN
    )
  LOOP
    IF v_item_json.cantidad IS NULL OR v_item_json.cantidad <= 0 THEN
      RAISE EXCEPTION 'ITEM_INVALIDO: La cantidad debe ser mayor que cero';
    END IF;
    IF v_item_json.precio_unit_usd IS NULL OR v_item_json.precio_unit_usd < 0 THEN
      RAISE EXCEPTION 'ITEM_INVALIDO: El precio no puede ser negativo';
    END IF;
    IF COALESCE(v_item_json.descuento_pct, 0) < 0
       OR COALESCE(v_item_json.descuento_pct, 0) > 100 THEN
      RAISE EXCEPTION 'ITEM_INVALIDO: Descuento fuera de rango';
    END IF;

    IF v_item_json.producto_id IS NOT NULL THEN
      SELECT id, cuenta_id, activo
        INTO v_producto
      FROM public.productos
      WHERE id = v_item_json.producto_id;

      IF NOT FOUND OR v_producto.cuenta_id IS DISTINCT FROM v_despacho.cuenta_id
         OR v_producto.activo IS NOT TRUE THEN
        RAISE EXCEPTION 'PRODUCTO_INVALIDO: Producto no disponible en la cuenta del despacho';
      END IF;
    END IF;

    INSERT INTO public.notas_despacho_items (
      despacho_id, producto_id, codigo_snap, nombre_snap, unidad_snap,
      cantidad_original, precio_original, cantidad, precio_unit_usd,
      descuento_pct, total_linea_usd, orden, origen, es_prestamo
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
      CASE WHEN COALESCE(v_item_json.es_prestamo, FALSE) THEN 0.0000
           ELSE v_item_json.cantidad * v_item_json.precio_unit_usd
              * (1 - COALESCE(v_item_json.descuento_pct, 0) / 100) END,
      v_item_json.orden,
      COALESCE(v_item_json.origen,
        CASE WHEN v_item_json.producto_id IS NULL THEN 'externo' ELSE 'inventario' END),
      COALESCE(v_item_json.es_prestamo, FALSE)
    );

    IF NOT COALESCE(v_item_json.es_prestamo, FALSE) THEN
      v_total_items := v_total_items
        + v_item_json.cantidad * v_item_json.precio_unit_usd
        * (1 - COALESCE(v_item_json.descuento_pct, 0) / 100);
    END IF;
  END LOOP;

  v_total_nuevo := v_total_items
    + COALESCE(v_despacho.flete_usd, 0)
    + COALESCE(v_despacho.corte_usd, 0)
    - COALESCE(v_despacho.descuento_total_usd, 0);

  UPDATE public.notas_despacho
  SET total_usd = v_total_nuevo,
      forma_pago_cliente = COALESCE(p_forma_pago, forma_pago_cliente),
      forma_pago = COALESCE(p_forma_pago, forma_pago)
  WHERE id = p_despacho_id
    AND cuenta_id = v_operador.cuenta_id;

  PERFORM public.registrar_auditoria(
    p_usuario_id     := p_usuario_id,
    p_usuario_nombre := p_usuario_nombre,
    p_usuario_rol    := v_operador.rol,
    p_categoria      := 'COTIZACION',
    p_accion         := 'EDITAR_DESPACHO_PROFUNDIDAD',
    p_entidad_tipo   := 'nota_despacho',
    p_entidad_id     := p_despacho_id,
    p_meta           := jsonb_build_object(
      'alcance', 'cuenta_completa',
      'estado_requerido', 'pendiente',
      'total_anterior', v_despacho.total_usd,
      'total_nuevo', v_total_nuevo,
      'items_nuevos', jsonb_array_length(p_nuevos_items),
      'pagos_actualizados', p_forma_pago IS NOT NULL
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.editar_despacho_profundidad(UUID, JSONB, UUID, TEXT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.editar_despacho_profundidad(UUID, JSONB, UUID, TEXT, TEXT, TEXT) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
