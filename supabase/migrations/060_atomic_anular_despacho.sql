-- ═══════════════════════════════════════════════════════════════════════════
-- 060: RPC atómico para anular despacho (stock + kardex + comisión)
-- Resuelve race condition: stock se leía y actualizaba en requests separados
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.anular_despacho_atomico(
  p_despacho_id     UUID,
  p_usuario_id      UUID,
  p_usuario_nombre  TEXT,
  p_usuario_color   TEXT DEFAULT NULL
)
RETURNS VOID
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_despacho       RECORD;
  v_item           RECORD;
  v_stock_antes    NUMERIC(10,2);
  v_stock_nuevo    NUMERIC(10,2);
  v_lote_id        UUID := gen_random_uuid();
BEGIN
  -- 1. Obtener y bloquear despacho
  SELECT * INTO v_despacho
  FROM public.notas_despacho
  WHERE id = p_despacho_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DESPACHO_NO_ENCONTRADO';
  END IF;

  IF v_despacho.estado NOT IN ('pendiente', 'despachada') THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO: Solo se puede anular pendiente o despachada, actual: %', v_despacho.estado;
  END IF;

  -- 2. Devolver stock y registrar kardex (atómico con FOR UPDATE)
  FOR v_item IN
    SELECT ci.producto_id, ci.cantidad, ci.nombre_snap
    FROM public.cotizacion_items ci
    WHERE ci.cotizacion_id = v_despacho.cotizacion_id
      AND ci.producto_id IS NOT NULL
  LOOP
    SELECT stock_actual INTO v_stock_antes
    FROM public.productos
    WHERE id = v_item.producto_id
    FOR UPDATE;

    IF FOUND THEN
      v_stock_nuevo := v_stock_antes + v_item.cantidad;

      UPDATE public.productos
      SET stock_actual = v_stock_nuevo, actualizado_en = now()
      WHERE id = v_item.producto_id;

      INSERT INTO public.inventario_movimientos (
        lote_id, tipo, motivo, motivo_tipo,
        producto_id, producto_nombre,
        cantidad, stock_anterior, stock_nuevo,
        usuario_id, usuario_nombre, usuario_color
      ) VALUES (
        v_lote_id, 'ingreso',
        'Anulación de despacho #' || v_despacho.numero,
        'venta',
        v_item.producto_id, v_item.nombre_snap,
        v_item.cantidad, v_stock_antes, v_stock_nuevo,
        p_usuario_id, p_usuario_nombre, p_usuario_color
      );
    END IF;
  END LOOP;

  -- 3. Eliminar comisión pendiente (si existe)
  DELETE FROM public.comisiones
  WHERE despacho_id = p_despacho_id AND estado = 'pendiente';

  -- 4. Actualizar estado del despacho
  UPDATE public.notas_despacho
  SET estado = 'anulada'
  WHERE id = p_despacho_id;
END;
$$;
