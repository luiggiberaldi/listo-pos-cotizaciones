-- 17_egreso_inventario_rollback_review.sql
-- REVIEW ONLY. Run only after a separately approved rollback decision.
--
-- Rollback del release 17 (plan §7, "sin tráfico nuevo"):
--   1. Reingreso espejo del BACKFILL: para cada despacho cuyo egreso_lote_id sea
--      el lote determinista de migración (md5('migra-egreso-17-' || id)::uuid)
--      con estado aún 'despachada'/'entregada', se devuelve el stock y se
--      registra el kardex 'ingreso' espejo. El kardex NO se borra jamás.
--   2. Se limpian los sellos egreso_lote_id/alerta_* de esos despachos.
--   3. Se restauran los cuerpos previos de funciones desde
--      supabase/release/main/17_backup_cuerpos/*.live.sql (ver su README;
--      ejecutar esos archivos DESPUÉS de este script).
--
-- NOTA: los egresos hechos por la v3 con tráfico nuevo (aprobaciones reales
-- posteriores al cutover) NO se revierten aquí: su lote no coincide con el de
-- migración. Con tráfico nuevo, coordinar el revert del commit de app + cuerpos
-- previos en la misma ventana (plan §7). Las columnas alerta_stock,
-- alerta_stock_items y egreso_lote_id se conservan (evidencia).

BEGIN;

DO $review_gate$
BEGIN
  RAISE EXCEPTION 'REVIEW_ONLY: 17_egreso_inventario_rollback_review.sql requiere aprobacion explicita de rollback';
END;
$review_gate$;

DO $rollback_guard$
DECLARE
  v_aprobar OID := to_regprocedure('public.aprobar_despacho_inventario_atomico(uuid,uuid,text,text,boolean)');
  v_entrega OID := to_regprocedure('public.confirmar_entrega_inventario_atomica(uuid,uuid,text,text,numeric,boolean)');
  v_revertir_entrega OID := to_regprocedure('public.revertir_entrega_inventario_atomica(uuid,text,uuid,text,text)');
  v_revertir_despacho OID := to_regprocedure('public.revertir_despacho_inventario_atomica(uuid,text,uuid,text,text)');
BEGIN
  IF v_aprobar IS NOT NULL
     AND obj_description(v_aprobar, 'pg_proc') IS DISTINCT FROM
       'Main egreso-inventario release 17: egreso + kardex al aprobar (pendiente→despachada); nunca bloquea por stock; alertas nivel BAJO/NEGATIVO.' THEN
    RAISE EXCEPTION 'ROLLBACK_17_OWNER_MISMATCH: aprobar_despacho_inventario_atomico';
  END IF;
  IF v_entrega IS NOT NULL
     AND obj_description(v_entrega, 'pg_proc') IS DISTINCT FROM
       'Main egreso-inventario release 17: la entrega ya no descuenta inventario (egreso al aprobar); solo valida y fija estado entregada. Excepcion: la entrega directa desde pendiente egresa aqui.' THEN
    RAISE EXCEPTION 'ROLLBACK_17_OWNER_MISMATCH: confirmar_entrega_inventario_atomica';
  END IF;
  IF v_revertir_entrega IS NOT NULL
     AND obj_description(v_revertir_entrega, 'pg_proc') IS DISTINCT FROM
       'Main egreso-inventario release 17: revertir entrega a despachada no reingresa (egreso al aprobar); a pendiente/anulada reingresa neto de devoluciones.' THEN
    RAISE EXCEPTION 'ROLLBACK_17_OWNER_MISMATCH: revertir_entrega_inventario_atomica';
  END IF;
  IF v_revertir_despacho IS NOT NULL
     AND obj_description(v_revertir_despacho, 'pg_proc') IS DISTINCT FROM
       'Main egreso-inventario release 17: devolver a pendiente o anular desde despachada reingresa stock + kardex ingreso en la misma transacción.' THEN
    RAISE EXCEPTION 'ROLLBACK_17_OWNER_MISMATCH: revertir_despacho_inventario_atomica';
  END IF;
END;
$rollback_guard$;

-- ═══ Reingreso espejo del backfill (solo lotes de migración) ═══
DO $reingreso_espejo$
DECLARE
  v_despacho    RECORD;
  v_producto    RECORD;
  v_item        RECORD;
  v_lote_id     uuid;
  v_lote_migra  uuid;
  v_nuevo_stock NUMERIC(12,2);
  v_movimientos integer := 0;
BEGIN
  FOR v_despacho IN
    SELECT id, cuenta_id, numero, estado, egreso_lote_id
    FROM public.notas_despacho
    WHERE egreso_lote_id IS NOT NULL
      AND estado IN ('despachada', 'entregada')
    FOR UPDATE
  LOOP
    v_lote_migra := md5('migra-egreso-17-' || v_despacho.id)::uuid;
    IF v_despacho.egreso_lote_id IS DISTINCT FROM v_lote_migra THEN
      CONTINUE; -- egreso con tráfico nuevo: fuera del alcance de este rollback
    END IF;

    v_lote_id := gen_random_uuid();

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
        'ROLLBACK release 17 — reversión de MIGRACIÓN #' || v_despacho.numero,
        'venta',
        v_producto.id,
        COALESCE(v_item.nombre_snap, v_producto.nombre),
        v_item.cantidad,
        COALESCE(v_producto.stock_actual, 0),
        v_nuevo_stock,
        NULL,
        'ROLLBACK release 17',
        NULL,
        v_producto.cuenta_id
      );

      v_movimientos := v_movimientos + 1;
    END LOOP;

    UPDATE public.notas_despacho
    SET egreso_lote_id = NULL,
        alerta_stock = FALSE,
        alerta_stock_items = NULL
    WHERE id = v_despacho.id;

    RAISE NOTICE 'ROLLBACK_17 despacho #% (id %): reingreso espejo aplicado', v_despacho.numero, v_despacho.id;
  END LOOP;    RAISE NOTICE 'ROLLBACK_17 resumen: % movimientos de reingreso espejo', v_movimientos;
END;
$reingreso_espejo$;

-- ═══ Limpieza de sellos legado (solo sello; sin movimientos que invertir) ═══
-- Las entregadas históricas fueron selladas por el backfill con
-- md5('migra-egreso-17-legado-'||id) SIN mover stock (su egreso ocurrió al
-- entregar, modelo antiguo). El rollback solo limpia el sello (cutover §5.2);
-- la guarda NOT EXISTS evita tocar un lote que tenga kardex real.
DO $sello_legado$
DECLARE
  v_limpiados integer := 0;
BEGIN
  UPDATE public.notas_despacho nd
  SET egreso_lote_id = NULL
  WHERE nd.estado = 'entregada'
    AND nd.egreso_lote_id = md5('migra-egreso-17-legado-' || nd.id)::uuid
    AND NOT EXISTS (
      SELECT 1 FROM public.inventario_movimientos m WHERE m.lote_id = nd.egreso_lote_id
    );
  GET DIAGNOSTICS v_limpiados = ROW_COUNT;
  RAISE NOTICE 'ROLLBACK_17 sellos legado limpiados: %', v_limpiados;
END;
$sello_legado$;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- PASO SIGUIENTE (fuera de esta transacción):
-- restaurar los cuerpos previos de funciones desde
--   supabase/release/main/17_backup_cuerpos/*.live.sql
-- (ver README de ese directorio). Eso revierte la semántica de las RPCs al
-- modelo previo (descuento al entregar). Coordinar con el revert del commit de
-- app si hubo tráfico nuevo (plan §7).
