-- 17b_egreso_inventario_backfill_envuelo.sql
-- Release 17 — Cuadre MÍNIMO: solo los despachos "en vuelo"
-- (VARIANTE de 17_egreso_inventario_backfill.sql — usar ESTE archivo en la ventana)
--
-- Diferencia con el backfill original (decisión del plan §2b, 2026-10-20):
--   * Solo procesa despachos en estado 'despachada' (aprobados con el modelo viejo
--     que todavía no descontaron: los "en vuelo"). Les aplica su egreso retroactivo.
--   * Las entregadas legadas (~1.790 al 2026-10-20; crece cada día) NO se tocan
--     NI SE SELLAN: quedan totalmente intactas. Su egreso ya ocurrió cuando se
--     entregaron bajo el modelo viejo. Lo único que se pierde es una etiqueta de
--     trazabilidad.
--   * Cuadra los "en vuelo" que haya EN EL MOMENTO de ejecutar (el filtro es
--     dinámico: el 2026-10-20 por la tarde eran 6, no 4 — entran nuevos cada día).
--
-- Cuándo ejecutar: UNA sola vez, inmediatamente después de
-- `17_egreso_inventario_aprobacion_apply.sql` (y opcionalmente el fix 259), en la
-- ventana de silencio, ANTES del deploy del Worker + frontend.
--
-- Qué hace (por cada despacho 'despachada' con egreso_lote_id IS NULL):
--   −stock + kardex 'egreso' con motivo
--   'MIGRACIÓN — egreso por cambio de modelo #N', lote_id determinista
--   md5('migra-egreso-17-' || id)::uuid, y sellos alerta_stock/egreso_lote_id.
--
-- Idempotencia: solo procesa despachos con egreso_lote_id IS NULL (invariante
-- release 17: NOT NULL ⇔ egreso vigente) y, además, omite cada línea cuyo
-- movimiento de migración ya exista (guarda por producto × lote). Tras la
-- primera ejecución exitosa no queda NADA por procesar: re-ejecutar solo
-- imprime resumen en cero.
--
-- ─── GUARDA POR NETO HISTÓRICO (cómo decide cada despacho) ─────────────────
-- Cada candidato se clasifica por su historial en el kardex (todos los
-- movimientos cuyo motivo menciona su número, '#N' — los números de despacho
-- son únicos, verificado en producción el 2026-10-20):
--     neto = Σ(egresos) − Σ(ingresos) de ese historial
--   * neto = 0 → nunca quedó un descuento vigente: SE CUADRA (egreso normal).
--   * neto > 0 → ya dejó unidades fuera del inventario (p. ej. una entrega
--     legada que después se revirtió a 'despachada' tras el deploy):
--     SE SALTA con aviso. Aplicar otro egreso descontaría dos veces.
--   * neto < 0 → historial incoherente (más ingresos que egresos): el script
--     SE NIEGA a ejecutar y lista el número para revisión manual.
-- Ejemplo real verificado en producción el 2026-10-20: el despacho #2144 fue
-- entregado el 3/ago (7 egresos "Entrega confirmada"), revertido a pendiente
-- el 4/ago (7 ingresos "Reversión de despacho") y re-aprobado después → neto
-- cero → la guarda lo CUADRA correctamente (que es lo que debe ocurrir).
--
-- Evidencia: cada movimiento queda en inventario_movimientos con el lote
-- determinista del despacho; los SELECTs finales listan lo aplicado y las
-- entregadas legadas dejadas intactas (conteo esperado, no es un fallo).
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠️  AJUSTE OBLIGATORIO antes de ejecutar: confirme el usuario operador
--     (se usa como autor del kardex de migración) — decisión B del plan.
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
  v_movimientos integer := 0;
  v_saltados    integer := 0;
  v_neto        NUMERIC(12,2);
BEGIN
  IF v_usuario_id IS NULL OR v_usuario_nombre IS NULL OR char_length(trim(v_usuario_nombre)) = 0 THEN
    RAISE EXCEPTION 'BACKFILL_17B: configure v_usuario_id y v_usuario_nombre antes de ejecutar';
  END IF;

  FOR v_despacho IN
    SELECT id, cuenta_id, numero, estado
    FROM public.notas_despacho
    WHERE egreso_lote_id IS NULL
      AND estado = 'despachada'          -- SOLO "en vuelo"; entregadas legadas intactas
    ORDER BY numero
  LOOP
    -- ── Guarda por neto histórico: ¿quedó un descuento vigente sin hacer? ──
    SELECT COALESCE(SUM(
      CASE m.tipo WHEN 'egreso' THEN m.cantidad ELSE -m.cantidad END
    ), 0)
    INTO v_neto
    FROM public.inventario_movimientos m
    WHERE m.motivo ~ ('#' || v_despacho.numero || '\M');

    IF v_neto > 0 THEN
      -- Ya egresó y no se devolvió completo: otro egreso sería doble descuento.
      v_saltados := v_saltados + 1;
      RAISE WARNING 'BACKFILL_17B: despacho #% SALTADO — su historial ya deja % unidades egresadas (evita doble descuento; revisar si se desea trazabilidad)',
        v_despacho.numero, v_neto;
      CONTINUE;
    ELSIF v_neto < 0 THEN
      RAISE EXCEPTION 'BACKFILL_17B_HISTORIAL_INCOHERENTE: despacho #% tiene neto histórico % (más ingresos que egresos). Revisar a mano antes de cuadrar.',
        v_despacho.numero, v_neto;
    END IF;

    -- neto = 0: aplicar el egreso que el modelo viejo nunca hizo.
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
    RAISE NOTICE 'BACKFILL_17B despacho #% (id %): egreso aplicado, lote %',
      v_despacho.numero, v_despacho.id, v_lote_id;
  END LOOP;

  RAISE NOTICE 'BACKFILL_17B resumen: % despachos "en vuelo" egresados (% movimientos), % saltados por ya egresados. Entregadas legadas: intactas, sin tocar.',
    v_egresados, v_movimientos, v_saltados;
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
  AND nd.estado = 'despachada'
GROUP BY nd.id, nd.numero, nd.estado, nd.egreso_lote_id, nd.alerta_stock
ORDER BY nd.numero;

-- Entregadas legadas dejadas INTACTAS a propósito (decisión §2b del plan).
-- Que aparezcan aquí con egreso_lote_id NULL es ESPERADO en esta variante:
-- su egreso ya ocurrió al entregarse bajo el modelo viejo. No es un fallo.
SELECT
  COUNT(*) AS entregadas_legadas_intactas,
  COALESCE(SUM(ndi.cantidad), 0) AS unidades_totales
FROM public.notas_despacho nd
LEFT JOIN public.notas_despacho_items ndi ON ndi.despacho_id = nd.id
WHERE nd.egreso_lote_id IS NULL
  AND nd.estado = 'entregada';

-- Tras la ejecución no debe quedar ningún "en vuelo" sin marca, EXCEPTO los
-- saltados por la guarda (neto > 0). Cada fila que aparezca aquí con su neto
-- es un despacho que ya tenía su descuento vigente y se dejó fuera a propósito.
SELECT
  nd.numero,
  COALESCE(SUM(
    CASE m.tipo WHEN 'egreso' THEN m.cantidad ELSE -m.cantidad END
  ), 0) AS neto_historico,
  'SALTADO POR GUARDA (revisar solo si se desea trazabilidad)' AS estado_cuadre
FROM public.notas_despacho nd
LEFT JOIN public.inventario_movimientos m ON m.motivo ~ ('#' || nd.numero || '\M')
WHERE nd.egreso_lote_id IS NULL
  AND nd.estado = 'despachada'
GROUP BY nd.numero
ORDER BY nd.numero;

NOTIFY pgrst, 'reload schema';
COMMIT;
