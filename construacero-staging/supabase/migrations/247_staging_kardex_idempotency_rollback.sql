-- 247_staging_kardex_idempotency_rollback.sql
--
-- Staging-only hardening after the read-only Kardex audit:
--   * every new movement receives a structured operation origin;
--   * operational RPCs become replay-safe through one idempotency registry;
--   * historical reconciliation can be reverted by batch without touching
--     production or rewriting business movements.
--
-- Do not apply this migration to the principal project without a separate
-- promotion review and a backup of the target database.

BEGIN;

-- The first provenance migration already created this trigger. Replacing it
-- here makes the guarantee explicit for every older atomic RPC too: lote_id is
-- the immutable operation id when the caller does not have a domain UUID.
CREATE OR REPLACE FUNCTION public.enriquecer_proveniencia_kardex_staging()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_numero TEXT;
BEGIN
  IF NEW.origen_tipo IS NULL THEN
    NEW.origen_tipo := CASE COALESCE(NEW.motivo_tipo::TEXT, 'otro')
      WHEN 'venta' THEN 'despacho'
      WHEN 'devolucion' THEN 'devolucion'
      WHEN 'ajuste_inventario' THEN 'ajuste_inventario'
      WHEN 'compra_proveedor' THEN 'compra'
      WHEN 'transferencia' THEN 'transferencia'
      ELSE 'otro'
    END;
  END IF;

  IF NEW.origen_id IS NULL THEN
    NEW.origen_id := NEW.lote_id;
  END IF;

  IF NEW.origen_referencia IS NULL THEN
    v_numero := substring(COALESCE(NEW.motivo, '') FROM 'Despacho[[:space:]]+#([0-9]+)');
    IF v_numero IS NOT NULL THEN
      NEW.origen_referencia := 'despacho_numero:' || v_numero;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enriquecer_proveniencia_kardex_staging
  ON public.inventario_movimientos;
CREATE TRIGGER trg_enriquecer_proveniencia_kardex_staging
  BEFORE INSERT ON public.inventario_movimientos
  FOR EACH ROW
  EXECUTE FUNCTION public.enriquecer_proveniencia_kardex_staging();

ALTER TABLE public.kardex_reconciliaciones_staging
  ADD COLUMN IF NOT EXISTS estado TEXT NOT NULL DEFAULT 'aplicado',
  ADD COLUMN IF NOT EXISTS revertido_en TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revertido_por UUID;

ALTER TABLE public.kardex_reconciliaciones_staging
  DROP CONSTRAINT IF EXISTS kardex_reconciliaciones_staging_estado_check;
ALTER TABLE public.kardex_reconciliaciones_staging
  ADD CONSTRAINT kardex_reconciliaciones_staging_estado_check
  CHECK (estado IN ('aplicado', 'revertido'));

-- Reserve/fetch an operation under the same row lock used by the wrappers.
-- A NULL result means the caller owns a new operation; a non-NULL result is a
-- completed replay. Concurrent retries wait for the first transaction.
CREATE OR REPLACE FUNCTION public.staging_reservar_operacion(
  p_cuenta_id       UUID,
  p_idempotency_key UUID,
  p_operacion_tipo  TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_resultado JSONB;
  v_tipo      TEXT;
BEGIN
  IF p_idempotency_key IS NULL THEN
    RETURN jsonb_build_object('existente', FALSE);
  END IF;

  SELECT resultado, operacion_tipo
  INTO v_resultado, v_tipo
  FROM public.inventario_operaciones_staging
  WHERE cuenta_id = p_cuenta_id
    AND idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_tipo <> p_operacion_tipo THEN
      RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUTILIZADA';
    END IF;
    RETURN jsonb_build_object('existente', TRUE, 'resultado', v_resultado);
  END IF;

  INSERT INTO public.inventario_operaciones_staging
    (idempotency_key, cuenta_id, operacion_tipo)
  VALUES
    (p_idempotency_key, p_cuenta_id, p_operacion_tipo);

  RETURN jsonb_build_object('existente', FALSE);
END;
$$;

CREATE OR REPLACE FUNCTION public.staging_guardar_operacion(
  p_cuenta_id       UUID,
  p_idempotency_key UUID,
  p_resultado       JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_idempotency_key IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.inventario_operaciones_staging
  SET resultado = p_resultado,
      actualizado_en = now()
  WHERE cuenta_id = p_cuenta_id
    AND idempotency_key = p_idempotency_key;
END;
$$;

CREATE OR REPLACE FUNCTION public.staging_etiquetar_lote(
  p_cuenta_id       UUID,
  p_lote_id         UUID,
  p_idempotency_key UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_lote_id IS NULL OR p_idempotency_key IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.inventario_movimientos
  SET idempotency_key = p_idempotency_key
  WHERE cuenta_id = p_cuenta_id
    AND lote_id = p_lote_id
    AND idempotency_key IS NULL;
END;
$$;

-- ── Manual movement ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.aplicar_movimiento_inventario_atomico_staging(
  p_cuenta_id       UUID,
  p_tipo            tipo_movimiento,
  p_motivo          TEXT,
  p_motivo_tipo     motivo_movimiento DEFAULT 'otro',
  p_items           JSONB DEFAULT '[]'::JSONB,
  p_usuario_id      UUID DEFAULT NULL,
  p_usuario_nombre  TEXT DEFAULT NULL,
  p_usuario_color   TEXT DEFAULT NULL,
  p_idempotency_key UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res    JSONB;
  v_result JSONB;
BEGIN
  v_res := public.staging_reservar_operacion(p_cuenta_id, p_idempotency_key, 'movimiento_inventario');
  IF (v_res->>'existente') = 'true' THEN
    IF jsonb_typeof(v_res->'resultado') = 'object' THEN
      RETURN (v_res->'resultado') || jsonb_build_object('idempotent', TRUE);
    END IF;
    RAISE EXCEPTION 'OPERACION_IDEMPOTENTE_INCOMPLETA';
  END IF;

  v_result := public.aplicar_movimiento_inventario_atomico(
    p_cuenta_id, p_tipo, p_motivo, p_motivo_tipo, p_items,
    p_usuario_id, p_usuario_nombre, p_usuario_color
  ) || jsonb_build_object(
    'idempotency_key', p_idempotency_key,
    'idempotent', FALSE
  );
  PERFORM public.staging_etiquetar_lote(p_cuenta_id, NULLIF(v_result->>'lote_id', '')::UUID, p_idempotency_key);
  PERFORM public.staging_guardar_operacion(p_cuenta_id, p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- ── Product transformation ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.transformar_inventario_atomico_staging(
  p_cuenta_id             UUID,
  p_origen_producto_id    UUID,
  p_origen_cantidad       NUMERIC,
  p_destino_producto_id   UUID,
  p_destino_cantidad      NUMERIC,
  p_motivo                TEXT,
  p_usuario_id            UUID DEFAULT NULL,
  p_usuario_nombre        TEXT DEFAULT NULL,
  p_usuario_color         TEXT DEFAULT NULL,
  p_idempotency_key       UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res    JSONB;
  v_result JSONB;
BEGIN
  v_res := public.staging_reservar_operacion(p_cuenta_id, p_idempotency_key, 'transformacion_inventario');
  IF (v_res->>'existente') = 'true' THEN
    IF jsonb_typeof(v_res->'resultado') = 'object' THEN
      RETURN (v_res->'resultado') || jsonb_build_object('idempotent', TRUE);
    END IF;
    RAISE EXCEPTION 'OPERACION_IDEMPOTENTE_INCOMPLETA';
  END IF;

  v_result := public.transformar_inventario_atomico(
    p_cuenta_id, p_origen_producto_id, p_origen_cantidad,
    p_destino_producto_id, p_destino_cantidad, p_motivo,
    p_usuario_id, p_usuario_nombre, p_usuario_color
  ) || jsonb_build_object(
    'idempotency_key', p_idempotency_key,
    'idempotent', FALSE
  );
  PERFORM public.staging_etiquetar_lote(p_cuenta_id, NULLIF(v_result->>'lote_id', '')::UUID, p_idempotency_key);
  PERFORM public.staging_guardar_operacion(p_cuenta_id, p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- ── Physical loan return ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.devolver_prestamo_inventario_atomico_staging(
  p_cuenta_id       UUID,
  p_prestamo_id     UUID,
  p_cantidad        NUMERIC,
  p_usuario_id      UUID,
  p_usuario_nombre  TEXT,
  p_usuario_color   TEXT DEFAULT NULL,
  p_idempotency_key UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res    JSONB;
  v_result JSONB;
BEGIN
  v_res := public.staging_reservar_operacion(p_cuenta_id, p_idempotency_key, 'devolucion_prestamo');
  IF (v_res->>'existente') = 'true' THEN
    IF jsonb_typeof(v_res->'resultado') = 'object' THEN
      RETURN (v_res->'resultado') || jsonb_build_object('idempotent', TRUE);
    END IF;
    RAISE EXCEPTION 'OPERACION_IDEMPOTENTE_INCOMPLETA';
  END IF;

  v_result := public.devolver_prestamo_inventario_atomico(
    p_cuenta_id, p_prestamo_id, p_cantidad,
    p_usuario_id, p_usuario_nombre, p_usuario_color
  ) || jsonb_build_object(
    'idempotency_key', p_idempotency_key,
    'idempotent', FALSE
  );
  PERFORM public.staging_etiquetar_lote(p_cuenta_id, NULLIF(v_result->>'lote_id', '')::UUID, p_idempotency_key);
  PERFORM public.staging_guardar_operacion(p_cuenta_id, p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- ── Partial dispatch return + finance ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.registrar_devolucion_parcial_atomica_staging(
  p_despacho_id             UUID,
  p_devoluciones            JSONB,
  p_intercambios             JSONB DEFAULT '[]'::JSONB,
  p_motivo                  TEXT DEFAULT NULL,
  p_usuario_id              UUID DEFAULT NULL,
  p_usuario_nombre          TEXT DEFAULT NULL,
  p_usuario_color           TEXT DEFAULT NULL,
  p_cotizacion_reemplazo_id UUID DEFAULT NULL,
  p_total_devuelto_usd      NUMERIC DEFAULT 0,
  p_total_intercambio_usd   NUMERIC DEFAULT 0,
  p_idempotency_key         UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cuenta_id UUID;
  v_res       JSONB;
  v_result    JSONB;
BEGIN
  SELECT cuenta_id INTO v_cuenta_id
  FROM public.notas_despacho
  WHERE id = p_despacho_id;
  IF v_cuenta_id IS NULL THEN
    RAISE EXCEPTION 'DESPACHO_NO_ENCONTRADO';
  END IF;

  v_res := public.staging_reservar_operacion(v_cuenta_id, p_idempotency_key, 'devolucion_parcial_despacho');
  IF (v_res->>'existente') = 'true' THEN
    IF jsonb_typeof(v_res->'resultado') = 'object' THEN
      RETURN (v_res->'resultado') || jsonb_build_object('idempotent', TRUE);
    END IF;
    RAISE EXCEPTION 'OPERACION_IDEMPOTENTE_INCOMPLETA';
  END IF;

  v_result := public.registrar_devolucion_parcial_atomica(
    p_despacho_id, p_devoluciones, p_intercambios, p_motivo,
    p_usuario_id, p_usuario_nombre, p_usuario_color,
    p_cotizacion_reemplazo_id, p_total_devuelto_usd,
    p_total_intercambio_usd
  ) || jsonb_build_object(
    'idempotency_key', p_idempotency_key,
    'idempotent', FALSE,
    'cotizacion_reemplazo_id', p_cotizacion_reemplazo_id,
    'total_devuelto_usd', p_total_devuelto_usd,
    'total_intercambio_usd', p_total_intercambio_usd
  );
  PERFORM public.staging_etiquetar_lote(v_cuenta_id, NULLIF(v_result->>'lote_id', '')::UUID, p_idempotency_key);
  PERFORM public.staging_guardar_operacion(v_cuenta_id, p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- ── Delivery confirmation ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.confirmar_entrega_inventario_atomica_staging(
  p_despacho_id       UUID,
  p_usuario_id        UUID,
  p_usuario_nombre    TEXT,
  p_usuario_color     TEXT DEFAULT NULL,
  p_tasa_snapshot     NUMERIC DEFAULT NULL,
  p_permitir_negativo BOOLEAN DEFAULT NULL,
  p_idempotency_key   UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cuenta_id UUID;
  v_res       JSONB;
  v_result    JSONB;
BEGIN
  SELECT cuenta_id INTO v_cuenta_id FROM public.notas_despacho WHERE id = p_despacho_id;
  IF v_cuenta_id IS NULL THEN RAISE EXCEPTION 'DESPACHO_NO_ENCONTRADO'; END IF;

  v_res := public.staging_reservar_operacion(v_cuenta_id, p_idempotency_key, 'confirmar_entrega');
  IF (v_res->>'existente') = 'true' THEN
    IF jsonb_typeof(v_res->'resultado') = 'object' THEN
      RETURN (v_res->'resultado') || jsonb_build_object('idempotent', TRUE);
    END IF;
    RAISE EXCEPTION 'OPERACION_IDEMPOTENTE_INCOMPLETA';
  END IF;

  v_result := public.confirmar_entrega_inventario_atomica(
    p_despacho_id, p_usuario_id, p_usuario_nombre,
    p_usuario_color, p_tasa_snapshot, p_permitir_negativo
  ) || jsonb_build_object(
    'idempotency_key', p_idempotency_key,
    'idempotent', FALSE
  );
  PERFORM public.staging_etiquetar_lote(v_cuenta_id, NULLIF(v_result->>'lote_id', '')::UUID, p_idempotency_key);
  PERFORM public.staging_guardar_operacion(v_cuenta_id, p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- ── Delivery reversal including finance ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.revertir_entrega_finanzas_atomica_staging(
  p_despacho_id       UUID,
  p_nuevo_estado      TEXT,
  p_usuario_id        UUID,
  p_usuario_nombre    TEXT,
  p_usuario_color     TEXT DEFAULT NULL,
  p_idempotency_key   UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cuenta_id UUID;
  v_res       JSONB;
  v_result    JSONB;
BEGIN
  SELECT cuenta_id INTO v_cuenta_id FROM public.notas_despacho WHERE id = p_despacho_id;
  IF v_cuenta_id IS NULL THEN RAISE EXCEPTION 'DESPACHO_NO_ENCONTRADO'; END IF;

  v_res := public.staging_reservar_operacion(v_cuenta_id, p_idempotency_key, 'revertir_entrega_finanzas');
  IF (v_res->>'existente') = 'true' THEN
    IF jsonb_typeof(v_res->'resultado') = 'object' THEN
      RETURN (v_res->'resultado') || jsonb_build_object('idempotent', TRUE);
    END IF;
    RAISE EXCEPTION 'OPERACION_IDEMPOTENTE_INCOMPLETA';
  END IF;

  v_result := public.revertir_entrega_finanzas_atomica(
    p_despacho_id, p_nuevo_estado, p_usuario_id,
    p_usuario_nombre, p_usuario_color
  ) || jsonb_build_object(
    'idempotency_key', p_idempotency_key,
    'idempotent', FALSE
  );
  PERFORM public.staging_etiquetar_lote(v_cuenta_id, NULLIF(v_result->>'lote_id', '')::UUID, p_idempotency_key);
  PERFORM public.staging_guardar_operacion(v_cuenta_id, p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- Reconciliation rollback is deliberately explicit and limited to synthetic
-- rows created by this feature. It does not alter products or business rows.
CREATE OR REPLACE FUNCTION public.revertir_reconciliacion_kardex_staging(
  p_cuenta_id      UUID,
  p_batch_key      UUID,
  p_usuario_id     UUID DEFAULT NULL,
  p_usuario_nombre TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row       RECORD;
  v_actor_id  UUID;
  v_eliminados INTEGER := 0;
  v_total      INTEGER := 0;
BEGIN
  IF p_cuenta_id IS NULL OR p_batch_key IS NULL THEN
    RAISE EXCEPTION 'PARAMETROS_ROLLBACK_RECONCILIACION_INVALIDOS';
  END IF;

  SELECT u.id INTO v_actor_id
  FROM public.usuarios u
  WHERE u.id = p_usuario_id
    AND u.activo = TRUE
    AND u.cuenta_id = p_cuenta_id
  LIMIT 1;
  IF v_actor_id IS NULL THEN
    SELECT u.id INTO v_actor_id
    FROM public.usuarios u
    WHERE u.activo = TRUE
      AND u.cuenta_id = p_cuenta_id
      AND u.rol IN ('supervisor', 'administracion', 'jefe', 'desarrollador')
    ORDER BY u.nombre, u.id
    LIMIT 1;
  END IF;
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'USUARIO_ROLLBACK_NO_ENCONTRADO'; END IF;

  FOR v_row IN
    SELECT id, movimiento_correctivo_id
    FROM public.kardex_reconciliaciones_staging
    WHERE cuenta_id = p_cuenta_id
      AND batch_key = p_batch_key
      AND estado = 'aplicado'
    FOR UPDATE
  LOOP
    v_total := v_total + 1;
    DELETE FROM public.inventario_movimientos
    WHERE id = v_row.movimiento_correctivo_id
      AND cuenta_id = p_cuenta_id
      AND origen_tipo = 'reconciliacion_kardex'
      AND idempotency_key = p_batch_key;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'CORRECCION_RECONCILIACION_NO_ENCONTRADA: %', v_row.movimiento_correctivo_id;
    END IF;
    v_eliminados := v_eliminados + 1;

    UPDATE public.kardex_reconciliaciones_staging
    SET estado = 'revertido',
        revertido_en = now(),
        revertido_por = v_actor_id
    WHERE id = v_row.id;
  END LOOP;

  IF v_total = 0 THEN
    RETURN jsonb_build_object('ok', TRUE, 'batch_key', p_batch_key, 'revertidos', 0);
  END IF;

  UPDATE public.inventario_operaciones_staging
  SET resultado = jsonb_build_object(
        'ok', TRUE,
        'batch_key', p_batch_key,
        'revertidos', v_eliminados,
        'estado', 'revertido'
      ),
      actualizado_en = now()
  WHERE cuenta_id = p_cuenta_id
    AND idempotency_key = p_batch_key;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'batch_key', p_batch_key,
    'revertidos', v_eliminados,
    'estado', 'revertido',
    'usuario_id', v_actor_id,
    'usuario_nombre', COALESCE(NULLIF(trim(p_usuario_nombre), ''), 'Rollback staging')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.staging_reservar_operacion(UUID, UUID, TEXT) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.staging_guardar_operacion(UUID, UUID, JSONB) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.staging_etiquetar_lote(UUID, UUID, UUID) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.aplicar_movimiento_inventario_atomico_staging(UUID, tipo_movimiento, TEXT, motivo_movimiento, JSONB, UUID, TEXT, TEXT, UUID) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.transformar_inventario_atomico_staging(UUID, UUID, NUMERIC, UUID, NUMERIC, TEXT, UUID, TEXT, TEXT, UUID) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.devolver_prestamo_inventario_atomico_staging(UUID, UUID, NUMERIC, UUID, TEXT, TEXT, UUID) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.registrar_devolucion_parcial_atomica_staging(UUID, JSONB, JSONB, TEXT, UUID, TEXT, TEXT, UUID, NUMERIC, NUMERIC, UUID) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.confirmar_entrega_inventario_atomica_staging(UUID, UUID, TEXT, TEXT, NUMERIC, BOOLEAN, UUID) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.revertir_entrega_finanzas_atomica_staging(UUID, TEXT, UUID, TEXT, TEXT, UUID) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.revertir_reconciliacion_kardex_staging(UUID, UUID, UUID, TEXT) FROM PUBLIC, authenticated;

GRANT EXECUTE ON FUNCTION public.aplicar_movimiento_inventario_atomico_staging(UUID, tipo_movimiento, TEXT, motivo_movimiento, JSONB, UUID, TEXT, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.transformar_inventario_atomico_staging(UUID, UUID, NUMERIC, UUID, NUMERIC, TEXT, UUID, TEXT, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.devolver_prestamo_inventario_atomico_staging(UUID, UUID, NUMERIC, UUID, TEXT, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.registrar_devolucion_parcial_atomica_staging(UUID, JSONB, JSONB, TEXT, UUID, TEXT, TEXT, UUID, NUMERIC, NUMERIC, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirmar_entrega_inventario_atomica_staging(UUID, UUID, TEXT, TEXT, NUMERIC, BOOLEAN, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.revertir_entrega_finanzas_atomica_staging(UUID, TEXT, UUID, TEXT, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.revertir_reconciliacion_kardex_staging(UUID, UUID, UUID, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
