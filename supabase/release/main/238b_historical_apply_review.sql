-- 238b_historical_apply_review.sql
-- REVIEW ONLY - proyecto principal.
--
-- Este archivo no convierte historicos al instalarse. Define los contratos para
-- que un runner controlado pueda registrar el dry-run, aprobar un batch y
-- aplicar unicamente sus filas aprobadas.
--
-- Orden autorizado, despues de backup y staging:
--   1. Instalar/revisar 238b_comisiones_guardrails_review.sql.
--   2. Instalar/revisar este archivo.
--   3. Ejecutar dry-run READ ONLY y guardar evidencia fuera de la BD.
--   4. Registrar snapshot en un batch UUID nuevo.
--   5. Aprobar solo el lote de alta confianza.
--   6. Aplicar dentro de una transaccion con apply_key.
--   7. Re-auditar montos y dejar rollback ensayado.
--
-- No se debe usar como migration automatica ni combinar con db push.

BEGIN;

DO $$
BEGIN
  RAISE EXCEPTION 'REVIEW_ONLY: 238b_historical_apply_review.sql no debe ejecutarse todavia';
END
$$;

DO $$
BEGIN
  IF to_regclass('public.comision_238b_batches') IS NULL
     OR to_regclass('public.comision_238b_batch_rows') IS NULL
     OR to_regprocedure('public.comision_238b_pago_split(numeric,text,text)') IS NULL THEN
    RAISE EXCEPTION 'PRECONDICION_FALTANTE: instalar/revisar guardrails 238b primero';
  END IF;
END
$$;

ALTER TABLE public.comision_238b_batches
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by UUID,
  ADD COLUMN IF NOT EXISTS apply_key UUID,
  ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS applied_by UUID;

-- ---------------------------------------------------------------------------
-- 1. Registrar snapshot y propuesta del dry-run
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.registrar_propuestas_comisiones_238b(
  p_cuenta_id       UUID,
  p_batch_key       UUID,
  p_usuario_id      UUID,
  p_usuario_nombre  TEXT,
  p_baseline        JSONB,
  p_propuestas      JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row RECORD;
  v_count INTEGER := 0;
  v_manual INTEGER := 0;
  v_commission RECORD;
BEGIN
  IF p_cuenta_id IS NULL OR p_batch_key IS NULL OR p_usuario_id IS NULL
     OR NULLIF(btrim(p_usuario_nombre), '') IS NULL
     OR p_baseline IS NULL OR jsonb_typeof(p_baseline) <> 'object'
     OR p_propuestas IS NULL OR jsonb_typeof(p_propuestas) <> 'array'
     OR jsonb_array_length(p_propuestas) = 0 THEN
    RAISE EXCEPTION 'PARAMETROS_SNAPSHOT_COMISIONES_INVALIDOS';
  END IF;

  PERFORM public.comision_238b_assert_operator(p_cuenta_id, p_usuario_id);
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'comision-238b-register:' || p_batch_key::TEXT, 0
  ));

  IF EXISTS (SELECT 1 FROM public.comision_238b_batches WHERE batch_key = p_batch_key) THEN
    RAISE EXCEPTION 'BATCH_KEY_YA_EXISTE';
  END IF;

  INSERT INTO public.comision_238b_batches (
    batch_key, cuenta_id, tipo, estado, snapshot_at,
    created_by, created_by_name, baseline, proposal_count, notes
  ) VALUES (
    p_batch_key, p_cuenta_id, 'historical_commission_reconciliation', 'dry_run',
    now(), p_usuario_id, p_usuario_nombre, p_baseline,
    jsonb_array_length(p_propuestas),
    'Snapshot registrado desde dry-run 238b; no es una aprobacion.'
  );

  FOR v_row IN
    SELECT *
    FROM jsonb_to_recordset(p_propuestas) AS r(
      comision_id UUID,
      despacho_id UUID,
      estado_anterior TEXT,
      total_anterior NUMERIC,
      cabilla_anterior NUMERIC,
      otros_anterior NUMERIC,
      liberada_anterior NUMERIC,
      retenida_anterior NUMERIC,
      montopagado_anterior NUMERIC,
      cxc_excluida_anterior NUMERIC,
      pago_excluida_anterior NUMERIC,
      otras_exclusiones_anterior NUMERIC,
      fraccion_anterior NUMERIC,
      pagadaen_anterior TIMESTAMPTZ,
      pagadopor_anterior UUID,
      detalle_extras_anterior JSONB,
      calculo_version_anterior TEXT,
      politica_anterior TEXT,
      fuente_anterior TEXT,
      evidencia_anterior JSONB,
      estado_propuesto TEXT,
      proposed_cabilla NUMERIC,
      proposed_otros NUMERIC,
      total_propuesto NUMERIC,
      comision_cxc_excluida_propuesta NUMERIC,
      comision_pago_excluida_propuesta NUMERIC,
      comision_otras_exclusiones_propuesta NUMERIC,
      fraccion_no_cxc_propuesta NUMERIC,
      detalle_extras_propuesto JSONB,
      confidence TEXT,
      evidence JSONB
    )
  LOOP
    IF v_row.comision_id IS NULL OR v_row.despacho_id IS NULL
       OR v_row.estado_propuesto <> 'generada'
       OR v_row.proposed_cabilla IS NULL
       OR v_row.proposed_otros IS NULL
       OR v_row.total_propuesto IS NULL
       OR v_row.fraccion_no_cxc_propuesta IS NULL THEN
      RAISE EXCEPTION 'PROPUESTA_COMISION_INVALIDA: %', v_row.comision_id;
    END IF;

    SELECT * INTO v_commission
    FROM public.comisiones c
    WHERE c.id = v_row.comision_id
      AND c.despachoid = v_row.despacho_id
      AND c.cuentaid = p_cuenta_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'COMISION_SNAPSHOT_FUERA_DE_TENANT: %', v_row.comision_id;
    END IF;

    IF v_commission.estado IS DISTINCT FROM v_row.estado_anterior
       OR v_commission.totalcomision IS DISTINCT FROM v_row.total_anterior
       OR v_commission.comisioncabilla IS DISTINCT FROM v_row.cabilla_anterior
       OR v_commission.comisionotros IS DISTINCT FROM v_row.otros_anterior
       OR v_commission.comision_liberada IS DISTINCT FROM v_row.liberada_anterior
       OR v_commission.comision_retenida IS DISTINCT FROM v_row.retenida_anterior
       OR v_commission.montopagado IS DISTINCT FROM v_row.montopagado_anterior
       OR v_commission.pagadaen IS DISTINCT FROM v_row.pagadaen_anterior
       OR v_commission.pagadopor IS DISTINCT FROM v_row.pagadopor_anterior
       OR v_commission.comision_cxc_excluida IS DISTINCT FROM v_row.cxc_excluida_anterior
       OR v_commission.comision_pago_excluida IS DISTINCT FROM v_row.pago_excluida_anterior
       OR v_commission.comision_otras_exclusiones IS DISTINCT FROM v_row.otras_exclusiones_anterior
       OR v_commission.fraccion_no_cxc IS DISTINCT FROM v_row.fraccion_anterior
       OR v_commission.detalle_extras IS DISTINCT FROM v_row.detalle_extras_anterior
       OR v_commission.calculo_version IS DISTINCT FROM v_row.calculo_version_anterior
       OR v_commission.politica_comision IS DISTINCT FROM v_row.politica_anterior
       OR v_commission.fuente_calculo IS DISTINCT FROM v_row.fuente_anterior
       OR v_commission.calculo_evidencia IS DISTINCT FROM v_row.evidencia_anterior THEN
      RAISE EXCEPTION 'COMISION_PROPUESTA_OBSOLETA: %', v_row.comision_id;
    END IF;

    INSERT INTO public.comision_238b_batch_rows (
      batch_key, comision_id, despacho_id, estado,
      old_state, old_totalcomision, old_comisioncabilla, old_comisionotros,
      old_comision_liberada, old_comision_retenida, old_montopagado,
      old_pagadaen, old_pagadopor, old_comision_cxc_excluida,
      old_comision_pago_excluida, old_comision_otras_exclusiones,
      old_fraccion_no_cxc, old_detalle_extras, old_calculo_version,
      old_politica_comision, old_fuente_calculo, old_calculo_evidencia,
      proposed_state, proposed_totalcomision, proposed_comisioncabilla,
      proposed_comisionotros, proposed_comision_liberada,
      proposed_comision_retenida, proposed_montopagado,
      proposed_pagadaen, proposed_pagadopor,
      proposed_comision_cxc_excluida, proposed_comision_pago_excluida,
      proposed_comision_otras_exclusiones, proposed_fraccion_no_cxc,
      proposed_detalle_extras, proposed_calculo_version,
      proposed_politica_comision, proposed_fuente_calculo,
      proposed_evidencia
    ) VALUES (
      p_batch_key, v_commission.id, v_commission.despachoid,
      CASE WHEN v_row.confidence LIKE 'high_confidence%' THEN 'proposed' ELSE 'manual_review' END,
      v_commission.estado, v_commission.totalcomision, v_commission.comisioncabilla,
      v_commission.comisionotros, v_commission.comision_liberada,
      v_commission.comision_retenida, v_commission.montopagado,
      v_commission.pagadaen, v_commission.pagadopor,
      v_commission.comision_cxc_excluida, v_commission.comision_pago_excluida,
      v_commission.comision_otras_exclusiones,
      v_commission.fraccion_no_cxc, v_commission.detalle_extras, v_commission.calculo_version,
      v_commission.politica_comision, v_commission.fuente_calculo, v_commission.calculo_evidencia,
      'generada', round(v_row.total_propuesto, 2), round(v_row.proposed_cabilla, 2),
      round(v_row.proposed_otros, 2), round(v_row.total_propuesto, 2), 0,
      0, NULL, NULL,
      round(COALESCE(v_row.comision_cxc_excluida_propuesta, 0), 2),
      round(COALESCE(v_row.comision_pago_excluida_propuesta, 0), 2),
      round(COALESCE(v_row.comision_otras_exclusiones_propuesta, 0), 2),
      round(v_row.fraccion_no_cxc_propuesta, 8),
      COALESCE(v_row.detalle_extras_propuesto, '[]'::jsonb), '238b',
      'fecha_despacho_no_cxc', 'historical_reconciliation_238b',
      COALESCE(v_row.evidence, '{}'::jsonb) || jsonb_build_object(
        'confidence', v_row.confidence,
        'snapshot_captured_at', now(),
        'source_batch_key', p_batch_key
      )
    );

    IF v_row.confidence NOT LIKE 'high_confidence%' THEN
      v_manual := v_manual + 1;
    END IF;
    v_count := v_count + 1;
  END LOOP;

  UPDATE public.comision_238b_batches
  SET proposal_count = v_count,
      notes = notes || format(' Filas manual_review: %s.', v_manual)
  WHERE batch_key = p_batch_key;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'batch_key', p_batch_key,
    'snapshot_rows', v_count,
    'manual_review_rows', v_manual,
    'business_rows_mutated', FALSE,
    'next_state', 'dry_run'
  );
END
$$;

-- ---------------------------------------------------------------------------
-- 2. Aprobar unicamente un lote completo de alta confianza
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.aprobar_reconciliacion_comisiones_238b(
  p_batch_key      UUID,
  p_usuario_id     UUID,
  p_usuario_nombre TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch RECORD;
  v_total INTEGER;
  v_manual INTEGER;
BEGIN
  IF p_batch_key IS NULL OR p_usuario_id IS NULL
     OR NULLIF(btrim(p_usuario_nombre), '') IS NULL THEN
    RAISE EXCEPTION 'PARAMETROS_APROBACION_COMISIONES_INVALIDOS';
  END IF;

  SELECT * INTO v_batch
  FROM public.comision_238b_batches
  WHERE batch_key = p_batch_key
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BATCH_COMISIONES_NO_ENCONTRADO'; END IF;
  PERFORM public.comision_238b_assert_operator(v_batch.cuenta_id, p_usuario_id);
  IF v_batch.estado <> 'dry_run' THEN
    RAISE EXCEPTION 'BATCH_COMISIONES_NO_ESTA_EN_DRY_RUN';
  END IF;

  SELECT count(*)::INTEGER,
         count(*) FILTER (WHERE estado = 'manual_review')::INTEGER
  INTO v_total, v_manual
  FROM public.comision_238b_batch_rows
  WHERE batch_key = p_batch_key;

  IF v_total = 0 THEN RAISE EXCEPTION 'BATCH_COMISIONES_SIN_PROPUESTAS'; END IF;
  IF v_manual > 0 THEN
    RAISE EXCEPTION 'BATCH_COMISIONES_REQUIERE_REVISION_MANUAL: %', v_manual;
  END IF;

  UPDATE public.comision_238b_batch_rows
  SET estado = 'approved'
  WHERE batch_key = p_batch_key AND estado = 'proposed';

  UPDATE public.comision_238b_batches
  SET estado = 'approved', approved_at = now(), approved_by = p_usuario_id,
      notes = notes || ' Aprobado explicitamente por ' || p_usuario_nombre || '.'
  WHERE batch_key = p_batch_key;

  RETURN jsonb_build_object('ok', TRUE, 'batch_key', p_batch_key,
    'approved_rows', v_total, 'manual_review_rows', 0,
    'business_rows_mutated', FALSE);
END
$$;

-- ---------------------------------------------------------------------------
-- 3. Apply atomico por batch, con verificacion de snapshot y apply_key
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.aplicar_reconciliacion_comisiones_238b(
  p_batch_key      UUID,
  p_apply_key      UUID,
  p_usuario_id     UUID,
  p_usuario_nombre TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch RECORD;
  v_row RECORD;
  v_current RECORD;
  v_count INTEGER := 0;
  v_total INTEGER := 0;
BEGIN
  IF p_batch_key IS NULL OR p_apply_key IS NULL OR p_usuario_id IS NULL
     OR NULLIF(btrim(p_usuario_nombre), '') IS NULL THEN
    RAISE EXCEPTION 'PARAMETROS_APPLY_COMISIONES_INVALIDOS';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'comision-238b:' || p_batch_key::TEXT, 0
  ));

  SELECT * INTO v_batch
  FROM public.comision_238b_batches
  WHERE batch_key = p_batch_key
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BATCH_COMISIONES_NO_ENCONTRADO'; END IF;
  PERFORM public.comision_238b_assert_operator(v_batch.cuenta_id, p_usuario_id);

  IF v_batch.estado = 'applied' THEN
    IF v_batch.apply_key = p_apply_key THEN
      RETURN jsonb_build_object('ok', TRUE, 'idempotent', TRUE,
        'batch_key', p_batch_key, 'apply_key', p_apply_key,
        'applied_count', v_batch.applied_count);
    END IF;
    RAISE EXCEPTION 'APPLY_KEY_REUTILIZADA_CON_OTRO_VALOR';
  END IF;
  IF v_batch.estado <> 'approved' THEN
    RAISE EXCEPTION 'BATCH_COMISIONES_NO_APROBADO';
  END IF;

  SELECT count(*)::INTEGER INTO v_total
  FROM public.comision_238b_batch_rows
  WHERE batch_key = p_batch_key AND estado = 'approved';
  IF v_total = 0 THEN RAISE EXCEPTION 'BATCH_COMISIONES_SIN_FILAS_APROBADAS'; END IF;

  UPDATE public.comision_238b_batches
  SET estado = 'applying', apply_key = p_apply_key
  WHERE batch_key = p_batch_key;

  FOR v_row IN
    SELECT *
    FROM public.comision_238b_batch_rows
    WHERE batch_key = p_batch_key AND estado = 'approved'
    ORDER BY id
    FOR UPDATE
  LOOP
    SELECT * INTO v_current
    FROM public.comisiones
    WHERE id = v_row.comision_id
      AND despachoid = v_row.despacho_id
      AND cuentaid = v_batch.cuenta_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'COMISION_APPLY_NO_ENCONTRADA: %', v_row.comision_id;
    END IF;

    IF v_current.estado IS DISTINCT FROM v_row.old_state
       OR v_current.totalcomision IS DISTINCT FROM v_row.old_totalcomision
       OR v_current.comisioncabilla IS DISTINCT FROM v_row.old_comisioncabilla
       OR v_current.comisionotros IS DISTINCT FROM v_row.old_comisionotros
       OR v_current.comision_liberada IS DISTINCT FROM v_row.old_comision_liberada
       OR v_current.comision_retenida IS DISTINCT FROM v_row.old_comision_retenida
       OR v_current.montopagado IS DISTINCT FROM v_row.old_montopagado
       OR v_current.pagadaen IS DISTINCT FROM v_row.old_pagadaen
       OR v_current.pagadopor IS DISTINCT FROM v_row.old_pagadopor
       OR v_current.comision_cxc_excluida IS DISTINCT FROM v_row.old_comision_cxc_excluida
       OR v_current.comision_pago_excluida IS DISTINCT FROM v_row.old_comision_pago_excluida
       OR v_current.comision_otras_exclusiones IS DISTINCT FROM v_row.old_comision_otras_exclusiones
       OR v_current.fraccion_no_cxc IS DISTINCT FROM v_row.old_fraccion_no_cxc
       OR v_current.detalle_extras IS DISTINCT FROM v_row.old_detalle_extras
       OR v_current.calculo_version IS DISTINCT FROM v_row.old_calculo_version
       OR v_current.politica_comision IS DISTINCT FROM v_row.old_politica_comision
       OR v_current.fuente_calculo IS DISTINCT FROM v_row.old_fuente_calculo
       OR v_current.calculo_evidencia IS DISTINCT FROM v_row.old_calculo_evidencia THEN
      RAISE EXCEPTION 'COMISION_APPLY_BLOQUEADO_POR_CAMBIO_POSTERIOR: %', v_row.comision_id;
    END IF;

    UPDATE public.comisiones
    SET estado = 'generada',
        totalcomision = v_row.proposed_totalcomision,
        comisioncabilla = v_row.proposed_comisioncabilla,
        comisionotros = v_row.proposed_comisionotros,
        comision_liberada = v_row.proposed_comision_liberada,
        comision_retenida = v_row.proposed_comision_retenida,
        montopagado = v_row.proposed_montopagado,
        pagadaen = v_row.proposed_pagadaen,
        pagadopor = v_row.proposed_pagadopor,
        comision_cxc_excluida = v_row.proposed_comision_cxc_excluida,
        comision_pago_excluida = v_row.proposed_comision_pago_excluida,
        comision_otras_exclusiones = v_row.proposed_comision_otras_exclusiones,
        fraccion_no_cxc = v_row.proposed_fraccion_no_cxc,
        detalle_extras = v_row.proposed_detalle_extras,
        calculo_version = v_row.proposed_calculo_version,
        politica_comision = v_row.proposed_politica_comision,
        fuente_calculo = v_row.proposed_fuente_calculo,
        calculo_evidencia = v_row.proposed_evidencia,
        actualizadoen = now()
    WHERE id = v_row.comision_id;

    UPDATE public.comision_238b_batch_rows
    SET estado = 'applied', applied_at = now(), applied_by = p_usuario_id
    WHERE id = v_row.id;
    v_count := v_count + 1;
  END LOOP;

  UPDATE public.comision_238b_batches
  SET estado = 'applied', applied_count = v_count,
      applied_at = now(), applied_by = p_usuario_id,
      notes = notes || ' Aplicado con apply_key ' || p_apply_key::TEXT || '.'
  WHERE batch_key = p_batch_key;

  RETURN jsonb_build_object('ok', TRUE, 'batch_key', p_batch_key,
    'apply_key', p_apply_key, 'applied_count', v_count,
    'snapshot_verified', TRUE, 'rollback_ready', TRUE);
END
$$;

REVOKE ALL ON FUNCTION public.registrar_propuestas_comisiones_238b(UUID, UUID, UUID, TEXT, JSONB, JSONB)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aprobar_reconciliacion_comisiones_238b(UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aplicar_reconciliacion_comisiones_238b(UUID, UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.registrar_propuestas_comisiones_238b(UUID, UUID, UUID, TEXT, JSONB, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.aprobar_reconciliacion_comisiones_238b(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.aplicar_reconciliacion_comisiones_238b(UUID, UUID, UUID, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
