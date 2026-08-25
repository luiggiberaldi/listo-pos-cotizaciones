-- STAGING ONLY — edición profunda de despachos
-- Proyecto autorizado: spupqgkdsgohxxfoxydl
-- Aplicar únicamente después de conservar el backup de la definición activa.

CREATE OR REPLACE FUNCTION public.validar_items_despacho_sin_duplicados(p_items jsonb)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT
        COALESCE(
          x.producto_id::text,
          'externo:'
            || lower(trim(COALESCE(x.codigo_snap, '')))
            || ':'
            || lower(trim(COALESCE(x.nombre_snap, '')))
        ) AS producto_key,
        COALESCE(x.precio_unit_usd, 0) AS precio_key,
        COALESCE(x.descuento_pct, 0) AS descuento_key,
        COALESCE(NULLIF(trim(x.origen), ''), CASE WHEN x.producto_id IS NULL THEN 'externo' ELSE 'inventario' END) AS origen_key,
        COALESCE(x.es_prestamo, false) AS prestamo_key,
        COUNT(*) AS line_count
      FROM jsonb_to_recordset(p_items) AS x(
        producto_id uuid,
        codigo_snap text,
        nombre_snap text,
        precio_unit_usd numeric,
        descuento_pct numeric,
        origen text,
        es_prestamo boolean
      )
      GROUP BY 1, 2, 3, 4, 5
      HAVING COUNT(*) > 1
    ) AS duplicados
  ) THEN
    RAISE EXCEPTION 'ITEMS_DUPLICADOS: existe más de una línea con la misma condición comercial';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.editar_despacho_profundidad(
  p_despacho_id    uuid,
  p_nuevos_items   jsonb,
  p_usuario_id     uuid DEFAULT NULL,
  p_usuario_nombre text DEFAULT 'Sistema',
  p_usuario_rol    text DEFAULT 'sistema',
  p_forma_pago     text DEFAULT NULL
)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_despacho    record;
  v_operador    record;
  v_item_json   record;
  v_producto    record;
  v_origen      text;
  v_total_items numeric(12,4) := 0;
  v_total_nuevo numeric(12,4);
BEGIN
  IF p_despacho_id IS NULL THEN
    RAISE EXCEPTION 'DESPACHO_ID_OBLIGATORIO';
  END IF;

  IF p_nuevos_items IS NULL
     OR jsonb_typeof(p_nuevos_items) <> 'array'
     OR jsonb_array_length(p_nuevos_items) = 0 THEN
    RAISE EXCEPTION 'ITEMS_INVALIDOS: Debe proporcionar al menos un ítem';
  END IF;

  -- Validar el operador real y su tenant; nunca confiar solo en el rol enviado.
  SELECT id, cuenta_id, rol, activo, nombre
    INTO v_operador
  FROM public.usuarios
  WHERE id = p_usuario_id;

  IF NOT FOUND OR COALESCE(v_operador.activo, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'ACCESO_DENEGADO: Operador inválido o inactivo';
  END IF;

  IF v_operador.rol NOT IN ('administracion', 'jefe', 'desarrollador') THEN
    RAISE EXCEPTION 'ACCESO_DENEGADO: Rol no autorizado para editar despachos a profundidad';
  END IF;

  IF p_usuario_rol IS DISTINCT FROM v_operador.rol THEN
    RAISE EXCEPTION 'ACCESO_DENEGADO: El rol informado no coincide con el operador';
  END IF;

  -- Bloquear el despacho dentro del tenant correcto y exigir estado pendiente.
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

  -- Esta validación ocurre antes del DELETE. Un payload inválido no puede
  -- borrar el snapshot actual.
  PERFORM public.validar_items_despacho_sin_duplicados(p_nuevos_items);

  -- Validar todo el payload antes de modificar líneas.
  FOR v_item_json IN
    SELECT * FROM jsonb_to_recordset(p_nuevos_items) AS x(
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
    IF v_item_json.nombre_snap IS NULL OR trim(v_item_json.nombre_snap) = '' THEN
      RAISE EXCEPTION 'ITEM_INVALIDO: El nombre del producto es obligatorio';
    END IF;
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

    v_origen := COALESCE(
      NULLIF(trim(v_item_json.origen), ''),
      CASE WHEN v_item_json.producto_id IS NULL THEN 'externo' ELSE 'inventario' END
    );

    IF v_origen NOT IN ('inventario', 'externo') THEN
      RAISE EXCEPTION 'ITEM_INVALIDO: Origen no permitido';
    END IF;

    IF v_item_json.producto_id IS NULL AND v_origen <> 'externo' THEN
      RAISE EXCEPTION 'ITEM_INVALIDO: Una línea sin producto_id debe ser externa';
    END IF;

    IF v_item_json.producto_id IS NOT NULL THEN
      SELECT id, cuenta_id, activo
        INTO v_producto
      FROM public.productos
      WHERE id = v_item_json.producto_id;

      IF NOT FOUND
         OR v_producto.cuenta_id IS DISTINCT FROM v_despacho.cuenta_id
         OR v_producto.activo IS NOT TRUE THEN
        RAISE EXCEPTION 'PRODUCTO_INVALIDO: Producto no disponible en la cuenta del despacho';
      END IF;
    END IF;
  END LOOP;

  RAISE NOTICE 'DEEP_EDIT_RPC_BEFORE_REPLACE despacho=% item_count=%', p_despacho_id, jsonb_array_length(p_nuevos_items);

  -- Reemplazo atómico del snapshot. No se toca stock: el despacho está pendiente.
  DELETE FROM public.notas_despacho_items
  WHERE despacho_id = p_despacho_id;

  FOR v_item_json IN
    SELECT * FROM jsonb_to_recordset(p_nuevos_items) AS x(
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
      despacho_id, producto_id, codigo_snap, nombre_snap, unidad_snap,
      cantidad_original, precio_original, cantidad, precio_unit_usd,
      descuento_pct, total_linea_usd, orden, origen, es_prestamo, cuenta_id,
      editado_en, editado_por
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
      CASE WHEN COALESCE(v_item_json.es_prestamo, false) THEN 0.0000
           ELSE v_item_json.cantidad * v_item_json.precio_unit_usd
              * (1 - COALESCE(v_item_json.descuento_pct, 0) / 100) END,
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

  v_total_nuevo := round(
    v_total_items
      + COALESCE(v_despacho.flete_usd, 0)
      + COALESCE(v_despacho.corte_usd, 0)
      - COALESCE(v_despacho.descuento_total_usd, 0),
    4
  );

  RAISE NOTICE 'DEEP_EDIT_RPC_AFTER_INSERT despacho=% item_count=% total=%', p_despacho_id, (SELECT COUNT(*) FROM public.notas_despacho_items WHERE despacho_id = p_despacho_id), v_total_nuevo;

  UPDATE public.notas_despacho
  SET total_usd = v_total_nuevo,
      forma_pago_cliente = COALESCE(p_forma_pago, forma_pago_cliente),
      forma_pago = COALESCE(p_forma_pago, forma_pago),
      items_editado_en = now(),
      items_editado_por = COALESCE(p_usuario_nombre, v_operador.nombre),
      actualizado_en = now()
  WHERE id = p_despacho_id
    AND cuenta_id = v_despacho.cuenta_id;

  PERFORM public.registrar_auditoria(
    p_usuario_id     := p_usuario_id,
    p_usuario_nombre := COALESCE(p_usuario_nombre, v_operador.nombre),
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

-- El Worker es el único consumidor del RPC. Los overloads antiguos no deben
-- quedar expuestos a llamadas directas que eviten la validación nueva.
REVOKE ALL ON FUNCTION public.editar_despacho_profundidad(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.editar_despacho_profundidad(uuid, jsonb, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.editar_despacho_profundidad(uuid, jsonb, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validar_items_despacho_sin_duplicados(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.editar_despacho_profundidad(uuid, jsonb, uuid, text, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';
