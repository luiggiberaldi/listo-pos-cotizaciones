-- 311 staging (deshacer): definición original.

CREATE OR REPLACE FUNCTION public.editar_despacho_profundidad(p_despacho_id uuid, p_nuevos_items jsonb, p_usuario_id uuid DEFAULT NULL::uuid, p_usuario_nombre text DEFAULT 'Sistema'::text, p_usuario_rol text DEFAULT 'sistema'::text, p_forma_pago text DEFAULT NULL::text)
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
  v_nuevo_stock  numeric(12,2);
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
    'desarrollador'
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

  -- Toda validacion ocurre antes del DELETE. Un payload invalido conserva
  -- intacto el snapshot actual.
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

  -- Los despachos pendientes aun no han egresado stock: el reemplazo de líneas
  -- no toca inventario. En 'despachada' el egreso ya ocurrió al aprobar y el
  -- reemplazo aplica el delta (nuevo − viejo) por producto.
  -- Se captura el mapa viejo ANTES del DELETE para poder comparar después.
  SELECT COALESCE(jsonb_object_agg(t.producto_id, t.cantidad), '{}'::jsonb)
    INTO v_mapa_viejo
  FROM (
    SELECT ndi.producto_id::text AS producto_id,
           SUM(ndi.cantidad)::NUMERIC(12,2) AS cantidad
    FROM public.notas_despacho_items ndi
    WHERE ndi.despacho_id = p_despacho_id
      AND ndi.producto_id IS NOT NULL
      AND COALESCE(ndi.origen, 'inventario') = 'inventario'
      AND COALESCE(ndi.es_prestamo, FALSE) = FALSE
    GROUP BY ndi.producto_id
  ) t;

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

  -- Mapa nuevo (tras el reemplazo de líneas) para el delta de inventario.
  SELECT COALESCE(jsonb_object_agg(t.producto_id, t.cantidad), '{}'::jsonb)
    INTO v_mapa_nuevo
  FROM (
    SELECT ndi.producto_id::text AS producto_id,
           SUM(ndi.cantidad)::NUMERIC(12,2) AS cantidad
    FROM public.notas_despacho_items ndi
    WHERE ndi.despacho_id = p_despacho_id
      AND ndi.producto_id IS NOT NULL
      AND COALESCE(ndi.origen, 'inventario') = 'inventario'
      AND COALESCE(ndi.es_prestamo, FALSE) = FALSE
    GROUP BY ndi.producto_id
  ) t;

  -- ── Delta de inventario (solo estado 'despachada': ya egresado) ──────────
  -- delta > 0 → sale más mercancía (egreso); delta < 0 → regresa (ingreso).
  -- Nunca se bloquea por stock (decisión de producto 2026-10-19).
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

      IF NOT FOUND OR v_producto.activo IS NOT TRUE THEN
        RAISE EXCEPTION 'PRODUCTO_NO_DISPONIBLE: %', v_delta.producto_id;
      END IF;

      v_nuevo_stock := COALESCE(v_producto.stock_actual, 0) - v_delta.delta;

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

    -- Alerta de stock post-edición sobre los ítems nuevos del despacho.
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
