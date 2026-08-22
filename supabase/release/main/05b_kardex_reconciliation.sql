-- 05b_kardex_reconciliation.sql
-- REVIEW ONLY — proyecto principal.
--
-- Tramo de reconciliación histórica del Kardex, separado de los guardrails
-- preventivos (05a). Instala SOLO:
--   - public.reconciliar_kardex(UUID, UUID, JSONB, UUID, TEXT, TEXT)
--   - public.revertir_reconciliacion_kardex(UUID, UUID, UUID, UUID, TEXT, TEXT)
--   - grants de ejecución (solo service_role)
--
-- Dependencias (ya instaladas en el principal por 01–04 + 05a):
--   - 01: tabla kardex_reconciliaciones, inventario_operaciones,
--         columnas provenance, reservar/guardar_operacion_inventario.
--   - 02: reservar/guardar_operacion_inventario (idempotencia).
--
-- No aplica: solo queda preparado para revisión humana y aprobación explícita.

BEGIN;

-- SAFETY GATE: elimina este bloque únicamente después de aprobar backup,
-- historial, revisión humana de propuestas y rollback ensayado.
DO $$
BEGIN
  RAISE EXCEPTION 'REVIEW_ONLY: 05b_kardex_reconciliation.sql no debe ejecutarse todavía';
END
$$;

DO $$
BEGIN
  IF to_regclass('public.productos') IS NULL
     OR to_regclass('public.inventario_movimientos') IS NULL
     OR to_regclass('public.inventario_operaciones') IS NULL
     OR to_regclass('public.kardex_reconciliaciones') IS NULL THEN
    RAISE EXCEPTION 'PRECONDICION_FALTANTE: ejecutar 01 antes de 05b';
  END IF;
  IF to_regprocedure('public.reservar_operacion_inventario(uuid, uuid, text)') IS NULL
     OR to_regprocedure('public.guardar_operacion_inventario(uuid, uuid, jsonb)') IS NULL THEN
    RAISE EXCEPTION 'PRECONDICION_FALTANTE: ejecutar 01/02 antes de 05b';
  END IF;
END
$$;


-- ---------------------------------------------------------------------------
-- Reconciliación histórica por propuestas read-only previamente aprobadas
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reconciliar_kardex(
  p_cuenta_id       UUID,
  p_batch_key       UUID,
  p_propuestas      JSONB,
  p_usuario_id      UUID,
  p_usuario_nombre  TEXT,
  p_usuario_color   TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item           RECORD;
  v_producto       RECORD;
  v_actual         RECORD;
  v_anterior       RECORD;
  v_actor          RECORD;
  v_guard          JSONB;
  v_resultado      JSONB;
  v_lote_id        UUID := gen_random_uuid();
  v_corr_id        UUID;
  v_delta          NUMERIC(12,4);
  v_stock_anterior NUMERIC(12,4);
  v_stock_nuevo    NUMERIC(12,4);
  v_insert_time    TIMESTAMPTZ;
  v_ancla_key      TEXT;
  v_aplicados      INTEGER := 0;
BEGIN
  IF p_cuenta_id IS NULL OR p_batch_key IS NULL OR p_usuario_id IS NULL
     OR p_propuestas IS NULL OR jsonb_typeof(p_propuestas) <> 'array'
     OR jsonb_array_length(p_propuestas) = 0 THEN
    RAISE EXCEPTION 'PARAMETROS_RECONCILIACION_INVALIDOS';
  END IF;

  v_guard := public.reservar_operacion_inventario(
    p_cuenta_id, p_batch_key, 'kardex_reconciliation'
  );
  IF COALESCE((v_guard->>'existente')::BOOLEAN, FALSE) THEN
    IF v_guard->'resultado' IS NULL OR v_guard->'resultado' = 'null'::JSONB THEN
      RAISE EXCEPTION 'OPERACION_IDEMPOTENTE_SIN_RESULTADO';
    END IF;
    RETURN (v_guard->'resultado') || jsonb_build_object('idempotent', TRUE);
  END IF;

  SELECT u.id, u.nombre, u.color, u.rol INTO v_actor
  FROM public.usuarios u
  WHERE u.id = p_usuario_id AND u.cuenta_id = p_cuenta_id
    AND u.activo = TRUE AND u.rol IN ('administracion', 'desarrollador')
  LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'USUARIO_RECONCILIACION_NO_AUTORIZADO'; END IF;

  DROP TABLE IF EXISTS pg_temp.tmp_reconciliacion_principal;
  CREATE TEMP TABLE tmp_reconciliacion_principal (
    clase TEXT,
    producto_id UUID,
    movimiento_id UUID,
    movimiento_numero INTEGER,
    movimiento_anterior_id UUID,
    stock_anterior_esperado NUMERIC(12,4),
    stock_actual_movimiento NUMERIC(12,4),
    stock_actual_catalogo NUMERIC(12,4),
    delta NUMERIC(12,4),
    reason TEXT
  ) ON COMMIT DROP;

  INSERT INTO tmp_reconciliacion_principal
  SELECT r.clase, r.producto_id, r.movimiento_id, r.movimiento_numero,
         r.movimiento_anterior_id, r.stock_anterior_esperado,
         r.stock_actual_movimiento, r.stock_actual_catalogo, r.delta,
         COALESCE(r.reason, '')
  FROM jsonb_to_recordset(p_propuestas) AS r(
    clase TEXT, producto_id UUID, movimiento_id UUID,
    movimiento_numero INTEGER, movimiento_anterior_id UUID,
    stock_anterior_esperado NUMERIC, stock_actual_movimiento NUMERIC,
    stock_actual_catalogo NUMERIC, delta NUMERIC, reason TEXT
  );

  FOR v_item IN
    SELECT * FROM tmp_reconciliacion_principal
    ORDER BY producto_id, movimiento_numero NULLS LAST, clase
  LOOP
    IF v_item.clase NOT IN ('continuity_gap', 'stock_actual_vs_kardex')
       OR v_item.producto_id IS NULL THEN
      RAISE EXCEPTION 'PROPUESTA_RECONCILIACION_INVALIDA';
    END IF;

    v_ancla_key := CASE WHEN v_item.clase = 'continuity_gap'
      THEN v_item.movimiento_id::TEXT
      ELSE v_item.producto_id::TEXT || ':stock_actual' END;

    IF EXISTS (
      SELECT 1 FROM public.kardex_reconciliaciones
      WHERE batch_key = p_batch_key AND ancla_key = v_ancla_key
    ) THEN CONTINUE; END IF;

    SELECT * INTO v_producto
    FROM public.productos
    WHERE id = v_item.producto_id AND cuenta_id = p_cuenta_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCTO_RECONCILIACION_NO_ENCONTRADO'; END IF;

    IF v_item.clase = 'continuity_gap' THEN
      SELECT * INTO v_actual
      FROM public.inventario_movimientos
      WHERE id = v_item.movimiento_id AND producto_id = v_item.producto_id
        AND cuenta_id = p_cuenta_id
      FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'MOVIMIENTO_ANCLA_NO_ENCONTRADO'; END IF;

      SELECT * INTO v_anterior
      FROM public.inventario_movimientos
      WHERE id = v_item.movimiento_anterior_id
        AND producto_id = v_item.producto_id AND cuenta_id = p_cuenta_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'MOVIMIENTO_ANTERIOR_NO_ENCONTRADO'; END IF;

      v_delta := ROUND((v_actual.stock_anterior - v_anterior.stock_nuevo)::NUMERIC, 4);
      IF abs(v_delta - COALESCE(v_item.delta, v_delta)) > 0.01
         OR abs(v_actual.stock_anterior - COALESCE(v_item.stock_actual_movimiento, v_actual.stock_anterior)) > 0.01
         OR abs(v_anterior.stock_nuevo - COALESCE(v_item.stock_anterior_esperado, v_anterior.stock_nuevo)) > 0.01 THEN
        RAISE EXCEPTION 'PROPUESTA_RECONCILIACION_DESACTUALIZADA: %', v_item.movimiento_id;
      END IF;

      v_stock_anterior := v_anterior.stock_nuevo;
      v_stock_nuevo := v_actual.stock_anterior;
      v_insert_time := v_actual.creado_en - interval '1 microsecond';
    ELSE
      SELECT * INTO v_actual
      FROM public.inventario_movimientos
      WHERE id = v_item.movimiento_id AND producto_id = v_item.producto_id
        AND cuenta_id = p_cuenta_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'ULTIMO_MOVIMIENTO_NO_ENCONTRADO'; END IF;

      IF abs(COALESCE(v_item.stock_anterior_esperado, v_actual.stock_nuevo) - v_actual.stock_nuevo) > 0.01
         OR abs(COALESCE(v_item.stock_actual_catalogo, v_producto.stock_actual) - v_producto.stock_actual) > 0.01
         OR abs(v_actual.stock_nuevo + COALESCE(v_item.delta, 0) - v_producto.stock_actual) > 0.01 THEN
        RAISE EXCEPTION 'PROPUESTA_STOCK_CATALOGO_DESACTUALIZADA: %', v_item.producto_id;
      END IF;

      v_stock_anterior := v_actual.stock_nuevo;
      v_stock_nuevo := v_producto.stock_actual;
      v_delta := v_stock_nuevo - v_stock_anterior;
      v_insert_time := GREATEST(now(), v_actual.creado_en + interval '1 microsecond');
    END IF;

    IF abs(v_delta) <= 0.01 THEN CONTINUE; END IF;

    INSERT INTO public.inventario_movimientos (
      lote_id, tipo, motivo, motivo_tipo, producto_id, producto_nombre,
      cantidad, stock_anterior, stock_nuevo, usuario_id, usuario_nombre,
      usuario_color, cuenta_id, origen_tipo, origen_id, origen_referencia,
      idempotency_key, creado_en
    ) VALUES (
      v_lote_id,
      CASE WHEN v_delta > 0 THEN 'ingreso'::tipo_movimiento ELSE 'egreso'::tipo_movimiento END,
      left('Reconciliación Kardex [' || v_item.clase || '] ancla '
        || COALESCE(v_item.movimiento_numero::TEXT, v_item.movimiento_id::TEXT)
        || ': ' || COALESCE(NULLIF(btrim(v_item.reason), ''), 'brecha de continuidad'), 500),
      'ajuste_inventario', v_producto.id, v_producto.nombre, abs(v_delta),
      v_stock_anterior, v_stock_nuevo, v_actor.id,
      COALESCE(NULLIF(btrim(p_usuario_nombre), ''), v_actor.nombre),
      COALESCE(p_usuario_color, v_actor.color), p_cuenta_id,
      'reconciliacion_kardex', COALESCE(v_item.movimiento_id, v_item.producto_id),
      v_ancla_key, p_batch_key, v_insert_time
    ) RETURNING id INTO v_corr_id;

    INSERT INTO public.kardex_reconciliaciones (
      batch_key, ancla_key, cuenta_id, producto_id,
      movimiento_ancla_id, movimiento_correctivo_id, clase, delta,
      stock_anterior, stock_nuevo,
      stock_catalogo_snapshot, producto_actualizado_en_snapshot,
      motivo, aplicado_por
    ) VALUES (
      p_batch_key, v_ancla_key, p_cuenta_id, v_producto.id,
      v_item.movimiento_id, v_corr_id, v_item.clase, v_delta,
      v_stock_anterior, v_stock_nuevo,
      ROUND(COALESCE(v_producto.stock_actual, 0)::NUMERIC, 4),
      v_producto.actualizado_en,
      left('Reconciliación Kardex [' || v_item.clase || '] ' || v_ancla_key, 500),
      v_actor.id
    );
    v_aplicados := v_aplicados + 1;
  END LOOP;

  v_resultado := jsonb_build_object(
    'ok', TRUE, 'transaccion_atomica', TRUE,
    'batch_key', p_batch_key, 'lote_id', v_lote_id,
    'aplicados', v_aplicados
  );
  PERFORM public.guardar_operacion_inventario(p_cuenta_id, p_batch_key, v_resultado);
  RETURN v_resultado;
END
$$;

-- Rollback por batch: crea movimientos inversos y marca la reconciliación como
-- revertida. Nunca elimina la propuesta, el movimiento original ni la evidencia.
--
-- Guardas obligatorias:
-- 1) el batch debe existir y no puede estar parcialmente revertido;
-- 2) el producto debe conservar exactamente el snapshot de catálogo tomado al aplicar;
-- 3) no puede haber movimientos posteriores al momento de aplicación, salvo las
--    correcciones del propio batch;
-- 4) el rollback NO modifica productos.stock_actual. La reconciliación histórica
--    corrige la secuencia del Kardex, no reescribe el saldo operativo vigente;
-- 5) una clave de rollback repetida devuelve el resultado original.
CREATE OR REPLACE FUNCTION public.revertir_reconciliacion_kardex(
  p_cuenta_id       UUID,
  p_batch_key       UUID,
  p_rollback_key    UUID,
  p_usuario_id      UUID,
  p_usuario_nombre  TEXT,
  p_usuario_color   TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row                  RECORD;
  v_corr                 RECORD;
  v_producto             RECORD;
  v_actor                RECORD;
  v_guard                JSONB;
  v_lote_id              UUID := gen_random_uuid();
  v_batch_total          INTEGER := 0;
  v_batch_aplicados      INTEGER := 0;
  v_batch_revertidos     INTEGER := 0;
  v_post_batch_movs      INTEGER := 0;
  v_revertidos           INTEGER := 0;
  v_resultado            JSONB;
BEGIN
  IF p_cuenta_id IS NULL OR p_batch_key IS NULL OR p_rollback_key IS NULL
     OR p_usuario_id IS NULL OR p_usuario_nombre IS NULL
     OR btrim(p_usuario_nombre) = '' THEN
    RAISE EXCEPTION 'PARAMETROS_ROLLBACK_RECONCILIACION_INVALIDOS';
  END IF;

  v_guard := public.reservar_operacion_inventario(
    p_cuenta_id, p_rollback_key, 'kardex_reconciliation_rollback'
  );
  IF COALESCE((v_guard->>'existente')::BOOLEAN, FALSE) THEN
    IF v_guard->'resultado' IS NULL OR v_guard->'resultado' = 'null'::JSONB THEN
      RAISE EXCEPTION 'OPERACION_IDEMPOTENTE_SIN_RESULTADO';
    END IF;
    RETURN (v_guard->'resultado') || jsonb_build_object('idempotent', TRUE);
  END IF;

  SELECT u.id, u.nombre, u.color, u.rol INTO v_actor
  FROM public.usuarios u
  WHERE u.id = p_usuario_id AND u.cuenta_id = p_cuenta_id
    AND u.activo = TRUE AND u.rol IN ('administracion', 'desarrollador')
  LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'USUARIO_ROLLBACK_NO_AUTORIZADO'; END IF;

  SELECT count(*)::INTEGER,
         count(*) FILTER (WHERE estado = 'aplicado')::INTEGER,
         count(*) FILTER (WHERE estado = 'revertido')::INTEGER
  INTO v_batch_total, v_batch_aplicados, v_batch_revertidos
  FROM public.kardex_reconciliaciones
  WHERE cuenta_id = p_cuenta_id AND batch_key = p_batch_key;

  IF v_batch_total = 0 THEN
    RAISE EXCEPTION 'BATCH_RECONCILIACION_NO_ENCONTRADO';
  END IF;
  IF v_batch_revertidos > 0 AND v_batch_aplicados > 0 THEN
    RAISE EXCEPTION 'BATCH_RECONCILIACION_PARCIALMENTE_REVERTIDO';
  END IF;
  IF v_batch_revertidos = v_batch_total THEN
    RAISE EXCEPTION 'BATCH_RECONCILIACION_YA_REVERTIDO';
  END IF;

  FOR v_row IN
    SELECT * FROM public.kardex_reconciliaciones
    WHERE cuenta_id = p_cuenta_id AND batch_key = p_batch_key
      AND estado = 'aplicado'
    ORDER BY producto_id, aplicado_en, id
    FOR UPDATE
  LOOP
    SELECT * INTO v_corr
    FROM public.inventario_movimientos
    WHERE id = v_row.movimiento_correctivo_id
      AND cuenta_id = p_cuenta_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'MOVIMIENTO_CORRECTIVO_NO_ENCONTRADO: %', v_row.id;
    END IF;

    SELECT * INTO v_producto
    FROM public.productos
    WHERE id = v_row.producto_id AND cuenta_id = p_cuenta_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'PRODUCTO_ROLLBACK_NO_ENCONTRADO: %', v_row.producto_id;
    END IF;

    IF v_row.stock_catalogo_snapshot IS NULL
       OR v_row.producto_actualizado_en_snapshot IS NULL
       OR abs(COALESCE(v_producto.stock_actual, 0)
              - v_row.stock_catalogo_snapshot) > 0.01
       OR v_producto.actualizado_en IS DISTINCT FROM v_row.producto_actualizado_en_snapshot THEN
      RAISE EXCEPTION 'ROLLBACK_BLOQUEADO_PRODUCTO_CAMBIO: %', v_row.producto_id;
    END IF;

    SELECT count(*)::INTEGER INTO v_post_batch_movs
    FROM public.inventario_movimientos m
    WHERE m.cuenta_id = p_cuenta_id
      AND m.producto_id = v_row.producto_id
      AND m.creado_en >= v_row.aplicado_en
      AND NOT EXISTS (
        SELECT 1
        FROM public.kardex_reconciliaciones kr
        WHERE kr.cuenta_id = p_cuenta_id
          AND kr.batch_key = p_batch_key
          AND kr.movimiento_correctivo_id = m.id
      );

    IF v_post_batch_movs > 0 THEN
      RAISE EXCEPTION 'ROLLBACK_BLOQUEADO_MOVIMIENTOS_POSTERIORES: %', v_row.producto_id;
    END IF;

    -- La compensación inversa revierte la secuencia histórica usando los
    -- snapshots del movimiento correctivo. No altera el saldo operativo actual.
    INSERT INTO public.inventario_movimientos (
      lote_id, tipo, motivo, motivo_tipo, producto_id, producto_nombre,
      cantidad, stock_anterior, stock_nuevo, usuario_id, usuario_nombre,
      usuario_color, cuenta_id, origen_tipo, origen_id, origen_referencia,
      idempotency_key
    ) VALUES (
      v_lote_id,
      CASE WHEN v_row.delta > 0 THEN 'egreso'::tipo_movimiento ELSE 'ingreso'::tipo_movimiento END,
      left('Rollback reconciliación Kardex batch ' || p_batch_key::TEXT, 500),
      'ajuste_inventario', v_producto.id, v_producto.nombre, abs(v_row.delta),
      v_corr.stock_nuevo, v_corr.stock_anterior, v_actor.id, p_usuario_nombre,
      COALESCE(p_usuario_color, v_actor.color), p_cuenta_id,
      'reconciliacion_rollback', v_corr.id,
      'batch:' || p_batch_key::TEXT, p_rollback_key
    );

    UPDATE public.kardex_reconciliaciones
    SET estado = 'revertido', revertido_en = now(), revertido_por = v_actor.id
    WHERE id = v_row.id;
    v_revertidos := v_revertidos + 1;
  END LOOP;

  v_resultado := jsonb_build_object(
    'ok', TRUE, 'batch_key', p_batch_key,
    'rollback_key', p_rollback_key, 'lote_id', v_lote_id,
    'revertidos', v_revertidos,
    'producto_stock_modificado', FALSE,
    'guardas', jsonb_build_array(
      'batch_completo', 'snapshot_producto',
      'sin_movimientos_posteriores', 'sin_mutacion_catalogo'
    )
  );
  PERFORM public.guardar_operacion_inventario(p_cuenta_id, p_rollback_key, v_resultado);
  RETURN v_resultado;
END
$$;

REVOKE ALL ON FUNCTION public.reconciliar_kardex(UUID, UUID, JSONB, UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revertir_reconciliacion_kardex(UUID, UUID, UUID, UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.reconciliar_kardex(UUID, UUID, JSONB, UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.revertir_reconciliacion_kardex(UUID, UUID, UUID, UUID, TEXT, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;

