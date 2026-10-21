-- 17_egreso_inventario_backfill.sql
-- Release 17 — Backfill de cutover: egreso por cambio de modelo (T6)
--
-- Ejecutar UNA sola vez, inmediatamente después de
-- `17_egreso_inventario_aprobacion_apply.sql` y ANTES del deploy del Worker +
-- frontend. Idempotente: puede re-ejecutarse sin doble efecto.
--
-- Qué hace (por cada despacho con egreso_lote_id IS NULL):
--   * estado 'despachada'  (comprometido sin descontar bajo el modelo viejo):
--     −stock + kardex 'egreso' con motivo
--     'MIGRACIÓN — egreso por cambio de modelo #N', lote_id determinista
--     md5('migra-egreso-17-' || id)::uuid, y sellos alerta_stock/egreso_lote_id.
--   * estado 'entregada'  (ya egresó en la entrega bajo el modelo viejo):
--     SIN movimientos (solo se sella egreso_lote_id con un marcador determinista
--     para que futuras reversas/re-ejecuciones no lo traten como egreso pendiente).
--
-- Idempotencia: solo procesa despachos con egreso_lote_id IS NULL (invariante
-- release 17: NOT NULL ⇔ egreso vigente) y, además, omite cada línea cuyo
-- movimiento de migración ya exista (guarda por producto × lote).
--
-- Evidencia: cada movimiento queda en inventario_movimientos con el lote
-- determinista del despacho; el resumen final lista lo aplicado.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠️  AJUSTE OBLIGATORIO antes de ejecutar: indique el usuario operador
--     (se usa como autor del kardex de migración).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $backfill$
DECLARE
  -- ── Usuario que ejecuta la migración (kardex de evidencia) ──────────────
  v_usuario_id     uuid := 'b40a90d3-e9a8-41f2-b631-edd4ea14ad78'::uuid;  -- operador cutover: luigi (supervisor)
  v_usuario_nombre text := 'MIGRACIÓN release 17';        -- autor visible del kardex de migración

  v_despacho    RECORD;
  v_producto    RECORD;
  v_item        RECORD;
  v_lote_id     uuid;
  v_nuevo_stock NUMERIC(12,2);
  v_nivel       text;
  v_alertas     jsonb;
  v_con_alertas boolean;
  v_egresados   integer := 0;
  v_sellados    integer := 0;
  v_movimientos integer := 0;
BEGIN
  IF v_usuario_id IS NULL OR v_usuario_nombre IS NULL OR char_length(trim(v_usuario_nombre)) = 0 THEN
    RAISE EXCEPTION 'BACKFILL_17: configure v_usuario_id y v_usuario_nombre antes de ejecutar';
  END IF;

  FOR v_despacho IN
    SELECT id, cuenta_id, numero, estado
    FROM public.notas_despacho
    WHERE egreso_lote_id IS NULL
      AND estado IN ('despachada', 'entregada')
    ORDER BY numero
  LOOP
    IF v_despacho.estado = 'entregada' THEN
      -- El modelo viejo ya egresó al entregar ('Entrega confirmada — Despacho
      -- #N' en kardex). Solo se sella para que el invariante de egreso_lote_id
      -- se mantenga tras reversas futuras y re-ejecuciones.
      UPDATE public.notas_despacho
      SET egreso_lote_id = md5('migra-egreso-17-legado-' || id)::uuid
      WHERE id = v_despacho.id;
      v_sellados := v_sellados + 1;
      CONTINUE;
    END IF;

    -- estado 'despachada': aplicar el egreso que el modelo viejo nunca hizo.
    v_lote_id := md5('migra-egreso-17-' || v_despacho.id)::uuid;
    v_alertas := '[]'::jsonb;
    v_con_alertas := FALSE;

    FOR v_item IN
      SELECT
        ndi.producto_id,
        MAX(ndi.nombre_snap) AS nombre_snap,
        SUM(ndi.cantidad)::NUMERIC(10,2) AS cantidad
      FROM public.notas_despacho_items ndi
      WHERE ndi.despacho_id = v_despacho.id
        AND ndi.producto_id IS NOT NULL
        AND COALESCE(ndi.origen, 'inventario') = 'inventario'
        AND COALESCE(ndi.es_prestamo, FALSE) = FALSE
      GROUP BY ndi.producto_id
      ORDER BY ndi.producto_id
    LOOP
      -- Guarda por producto × lote: re-ejecuciones no duplican el egreso.
      IF EXISTS (
        SELECT 1 FROM public.inventario_movimientos m
        WHERE m.lote_id = v_lote_id
          AND m.producto_id = v_item.producto_id
          AND m.tipo = 'egreso'
      ) THEN
        CONTINUE;
      END IF;

      SELECT id, nombre, stock_actual, stock_minimo, activo, cuenta_id
        INTO v_producto
      FROM public.productos
      WHERE id = v_item.producto_id
        AND (v_despacho.cuenta_id IS NULL OR cuenta_id = v_despacho.cuenta_id)
      FOR UPDATE;

      IF NOT FOUND OR v_producto.activo IS NOT TRUE THEN
        RAISE EXCEPTION 'PRODUCTO_NO_DISPONIBLE: %', v_item.nombre_snap;
      END IF;

      v_nuevo_stock := COALESCE(v_producto.stock_actual, 0) - v_item.cantidad;

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
        'MIGRACIÓN — egreso por cambio de modelo #' || v_despacho.numero,
        'venta',
        v_producto.id,
        COALESCE(v_item.nombre_snap, v_producto.nombre),
        v_item.cantidad,
        COALESCE(v_producto.stock_actual, 0),
        v_nuevo_stock,
        v_usuario_id,
        trim(v_usuario_nombre),
        NULL,
        v_producto.cuenta_id
      );

      v_movimientos := v_movimientos + 1;

      v_nivel := CASE
        WHEN v_nuevo_stock < 0 THEN 'NEGATIVO'
        WHEN v_nuevo_stock < COALESCE(v_producto.stock_minimo, 0) THEN 'BAJO'
        ELSE NULL
      END;
      IF v_nivel IS NOT NULL THEN
        v_con_alertas := TRUE;
        v_alertas := v_alertas || jsonb_build_object(
          'producto_id',   v_producto.id,
          'nombre',        v_producto.nombre,
          'cantidad',      v_item.cantidad,
          'stock_antes',   COALESCE(v_producto.stock_actual, 0),
          'stock_despues', v_nuevo_stock,
          'nivel',         v_nivel
        );
      END IF;
    END LOOP;

    UPDATE public.notas_despacho
    SET egreso_lote_id = v_lote_id,
        alerta_stock = v_con_alertas,
        alerta_stock_items = CASE WHEN v_con_alertas THEN v_alertas ELSE NULL END
    WHERE id = v_despacho.id;

    v_egresados := v_egresados + 1;
    RAISE NOTICE 'BACKFILL_17 despacho #% (id %): egreso aplicado, lote %',
      v_despacho.numero, v_despacho.id, v_lote_id;
  END LOOP;

  RAISE NOTICE 'BACKFILL_17 resumen: % despachos egresados (% movimientos), % sellados como legado',
    v_egresados, v_movimientos, v_sellados;
END;
$backfill$;

-- Resumen de evidencia por despacho (conservar la salida como evidencia del cutover).
SELECT
  nd.id,
  nd.numero,
  nd.estado,
  nd.egreso_lote_id,
  nd.alerta_stock,
  COUNT(m.*) FILTER (WHERE m.tipo = 'egreso') AS movimientos_egreso,
  COUNT(m.*) FILTER (WHERE m.tipo = 'ingreso') AS movimientos_ingreso
FROM public.notas_despacho nd
LEFT JOIN public.inventario_movimientos m ON m.lote_id = nd.egreso_lote_id
WHERE nd.egreso_lote_id IS NOT NULL
GROUP BY nd.id, nd.numero, nd.estado, nd.egreso_lote_id, nd.alerta_stock
ORDER BY nd.numero;

NOTIFY pgrst, 'reload schema';
COMMIT;
