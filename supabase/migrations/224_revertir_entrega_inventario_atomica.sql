-- 224: Reversión/anulación atómica de una entrega
--
-- Restaura el stock que todavía estaba físicamente fuera del inventario.
-- Las devoluciones parciales ya registradas se descuentan del ajuste para no
-- devolver dos veces el mismo producto. Los intercambios también se calculan
-- de forma neta.

CREATE OR REPLACE FUNCTION public.revertir_entrega_inventario_atomica(
  p_despacho_id    UUID,
  p_nuevo_estado   TEXT,
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
  v_despacho    RECORD;
  v_producto    RECORD;
  v_item        RECORD;
  v_lote_id     UUID := gen_random_uuid();
  v_movimientos INTEGER := 0;
  v_nuevo_stock NUMERIC(10,2);
BEGIN
  IF p_despacho_id IS NULL OR p_nuevo_estado NOT IN ('pendiente', 'despachada', 'anulada') THEN
    RAISE EXCEPTION 'PARAMETROS_REVERSA_INVALIDOS';
  END IF;

  SELECT *
  INTO v_despacho
  FROM public.notas_despacho
  WHERE id = p_despacho_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DESPACHO_NO_ENCONTRADO';
  END IF;

  IF v_despacho.estado <> 'entregada' THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO: Solo se puede revertir un despacho entregado';
  END IF;

  IF p_usuario_id IS NULL OR p_usuario_nombre IS NULL OR char_length(trim(p_usuario_nombre)) = 0 THEN
    RAISE EXCEPTION 'USUARIO_AUDITORIA_OBLIGATORIO';
  END IF;

  -- Originales: cantidad entregada menos devoluciones parciales asociadas a
  -- la línea original. Intercambios: cantidad entregada menos devoluciones
  -- parciales registradas sin despacho_item_id.
  FOR v_item IN
    SELECT producto_id, MAX(nombre_snap) AS nombre_snap, SUM(cantidad)::NUMERIC(10,2) AS cantidad
    FROM (
      SELECT
        ndi.producto_id,
        ndi.nombre_snap,
        ndi.cantidad - COALESCE(dev.cantidad_devuelta, 0) AS cantidad
      FROM public.notas_despacho_items ndi
      LEFT JOIN (
        SELECT despacho_item_id, SUM(cantidad_devuelta) AS cantidad_devuelta
        FROM public.despacho_devoluciones
        WHERE despacho_id = p_despacho_id
          AND despacho_item_id IS NOT NULL
        GROUP BY despacho_item_id
      ) dev ON dev.despacho_item_id = ndi.id
      WHERE ndi.despacho_id = p_despacho_id
        AND ndi.producto_id IS NOT NULL
        AND COALESCE(ndi.origen, 'inventario') = 'inventario'

      UNION ALL

      SELECT
        intercambio.producto_id,
        intercambio.nombre_snap,
        intercambio.cantidad - COALESCE(dev.cantidad_devuelta, 0) AS cantidad
      FROM public.despacho_devolucion_intercambios intercambio
      LEFT JOIN (
        SELECT producto_id, SUM(cantidad_devuelta) AS cantidad_devuelta
        FROM public.despacho_devoluciones
        WHERE despacho_id = p_despacho_id
          AND despacho_item_id IS NULL
          AND producto_id IS NOT NULL
        GROUP BY producto_id
      ) dev ON dev.producto_id = intercambio.producto_id
      WHERE intercambio.despacho_id = p_despacho_id
        AND intercambio.producto_id IS NOT NULL
    ) neto
    WHERE cantidad > 0
    GROUP BY producto_id
    ORDER BY producto_id
  LOOP
    SELECT id, nombre, stock_actual, activo, cuenta_id
    INTO v_producto
    FROM public.productos
    WHERE id = v_item.producto_id
      AND (v_despacho.cuenta_id IS NULL OR cuenta_id = v_despacho.cuenta_id)
    FOR UPDATE;

    IF NOT FOUND OR v_producto.activo IS NOT TRUE THEN
      RAISE EXCEPTION 'PRODUCTO_NO_DISPONIBLE: %', v_item.nombre_snap;
    END IF;

    v_nuevo_stock := COALESCE(v_producto.stock_actual, 0) + v_item.cantidad;

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
      'ingreso',
      CASE
        WHEN p_nuevo_estado = 'anulada' THEN 'Anulación de despacho #' || v_despacho.numero
        ELSE 'Reversión de entrega #' || v_despacho.numero || ' a ' || p_nuevo_estado
      END,
      'venta',
      v_producto.id,
      COALESCE(v_item.nombre_snap, v_producto.nombre),
      v_item.cantidad,
      COALESCE(v_producto.stock_actual, 0),
      v_nuevo_stock,
      p_usuario_id,
      trim(p_usuario_nombre),
      p_usuario_color,
      v_producto.cuenta_id
    );

    v_movimientos := v_movimientos + 1;
  END LOOP;

  UPDATE public.notas_despacho
  SET estado = p_nuevo_estado,
      entregada_en = NULL
  WHERE id = p_despacho_id;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'despacho_id', p_despacho_id,
    'nuevo_estado', p_nuevo_estado,
    'lote_id', v_lote_id,
    'movimientos', v_movimientos
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.revertir_entrega_inventario_atomica(UUID, TEXT, UUID, TEXT, TEXT)
  TO authenticated;
