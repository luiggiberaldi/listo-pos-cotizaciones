-- 223: Confirmación atómica de entrega
--
-- La aprobación (estado despachada) solo crea compromiso visual.
-- El stock físico y el Kardex se modifican únicamente al confirmar entrega.
-- Esta función bloquea el despacho y los productos para evitar doble entrega,
-- stock parcial o Kardex incompleto por concurrencia.

CREATE OR REPLACE FUNCTION public.confirmar_entrega_inventario_atomica(
  p_despacho_id      UUID,
  p_usuario_id       UUID,
  p_usuario_nombre   TEXT,
  p_usuario_color    TEXT DEFAULT NULL,
  p_tasa_snapshot    NUMERIC DEFAULT NULL,
  p_permitir_negativo BOOLEAN DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_despacho       RECORD;
  v_producto       RECORD;
  v_item           RECORD;
  v_lote_id        UUID := gen_random_uuid();
  v_allow_negative BOOLEAN := FALSE;
  v_movimientos    INTEGER := 0;
  v_nuevo_stock    NUMERIC(10,2);
BEGIN
  IF p_despacho_id IS NULL THEN
    RAISE EXCEPTION 'DESPACHO_ID_OBLIGATORIO';
  END IF;

  SELECT *
  INTO v_despacho
  FROM public.notas_despacho
  WHERE id = p_despacho_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DESPACHO_NO_ENCONTRADO';
  END IF;

  IF v_despacho.estado NOT IN ('pendiente', 'despachada') THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO: El despacho debe estar pendiente o aprobado';
  END IF;

  IF p_usuario_id IS NULL OR p_usuario_nombre IS NULL OR char_length(trim(p_usuario_nombre)) = 0 THEN
    RAISE EXCEPTION 'USUARIO_AUDITORIA_OBLIGATORIO';
  END IF;

  -- La configuración de la cuenta es la fuente de verdad para venta anticipada.
  -- El parámetro solo permite a una capa autorizada pasar explícitamente TRUE;
  -- nunca permite convertir TRUE en FALSE si la cuenta ya lo tiene habilitado.
  SELECT COALESCE(cn.permitir_stock_negativo, FALSE)
  INTO v_allow_negative
  FROM public.configuracion_negocio cn
  WHERE cn.cuenta_id = v_despacho.cuenta_id
  LIMIT 1;

  v_allow_negative := COALESCE(v_allow_negative, FALSE) OR COALESCE(p_permitir_negativo, FALSE);

  -- Agrupar por producto evita descontar dos veces si el despacho tiene líneas
  -- repetidas del mismo producto. El origen inventario excluye artículos externos.
  FOR v_item IN
    SELECT
      ndi.producto_id,
      MAX(ndi.nombre_snap) AS nombre_snap,
      SUM(ndi.cantidad)::NUMERIC(10,2) AS cantidad
    FROM public.notas_despacho_items ndi
    WHERE ndi.despacho_id = p_despacho_id
      AND ndi.producto_id IS NOT NULL
      AND COALESCE(ndi.origen, 'inventario') = 'inventario'
    GROUP BY ndi.producto_id
    ORDER BY ndi.producto_id
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

    IF v_item.cantidad <= 0 THEN
      RAISE EXCEPTION 'CANTIDAD_INVALIDA: %', v_item.nombre_snap;
    END IF;

    v_nuevo_stock := COALESCE(v_producto.stock_actual, 0) - v_item.cantidad;
    IF v_nuevo_stock < 0 AND NOT v_allow_negative THEN
      RAISE EXCEPTION 'STOCK_INSUFICIENTE: "%" tiene % y requiere %',
        v_producto.nombre, v_producto.stock_actual, v_item.cantidad;
    END IF;

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
      'egreso',
      CASE
        WHEN v_nuevo_stock < 0 THEN 'Entrega confirmada [VENTA ANTICIPADA] — Despacho #' || v_despacho.numero
        ELSE 'Entrega confirmada — Despacho #' || v_despacho.numero
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
  SET estado = 'entregada',
      despachada_en = COALESCE(despachada_en, now()),
      entregada_en = now(),
      tasa_snapshot = COALESCE(p_tasa_snapshot, tasa_snapshot)
  WHERE id = p_despacho_id;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'despacho_id', p_despacho_id,
    'lote_id', v_lote_id,
    'movimientos', v_movimientos,
    'stock_negativo_permitido', v_allow_negative
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirmar_entrega_inventario_atomica(UUID, UUID, TEXT, TEXT, NUMERIC, BOOLEAN)
  TO authenticated;
