-- 238a_contract_neutral_rollback_review.sql
-- REVIEW ONLY - rollback protegido del contrato estructural 238a.
--
-- Este archivo no debe ejecutarse directamente. Su runner autorizado debe
-- retirar REVIEW_ONLY solo en memoria, dentro de una transaccion controlada.
-- El rollback es conservador: si encuentra cualquier uso posterior, aborta y
-- no elimina columnas, tablas ni indices.
--
-- No toca filas de public.comisiones ni modifica estados o montos.

BEGIN;

DO $$
BEGIN
  RAISE EXCEPTION 'REVIEW_ONLY: 238a_contract_neutral_rollback_review.sql no debe ejecutarse directamente';
END
$$;

DO $$
DECLARE
  v_marker RECORD;
  v_batch_count BIGINT;
  v_row_count BIGINT;
  v_evidence_count BIGINT;
  v_column TEXT;
BEGIN
  SELECT * INTO v_marker
  FROM public.comision_238a_installation_marker
  WHERE contract_key = '238a'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROLLBACK_238A_SIN_MARCADOR';
  END IF;

  IF v_marker.status = 'rolled_back' THEN
    RAISE NOTICE 'ROLLBACK_238A_IDEMPOTENTE: ya estaba revertido';
    RETURN;
  END IF;

  SELECT count(*) INTO v_batch_count
  FROM public.comision_238b_batches;
  SELECT count(*) INTO v_row_count
  FROM public.comision_238b_batch_rows;

  IF v_batch_count > 0 OR v_row_count > 0 THEN
    RAISE EXCEPTION 'ROLLBACK_238A_BLOQUEADO_POR_USO: batches %, rows %',
      v_batch_count, v_row_count;
  END IF;

  FOREACH v_column IN ARRAY COALESCE(v_marker.created_columns, ARRAY[]::TEXT[]) LOOP
    EXECUTE format(
      'SELECT count(*) FROM public.comisiones WHERE %I IS NOT NULL',
      v_column
    ) INTO v_evidence_count;
    IF v_evidence_count > 0 THEN
      RAISE EXCEPTION 'ROLLBACK_238A_BLOQUEADO_POR_EVIDENCIA: columna %, filas %',
        v_column, v_evidence_count;
    END IF;
  END LOOP;

  FOREACH v_column IN ARRAY v_marker.created_indexes LOOP
    IF EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public' AND indexname = v_column
    ) THEN
      EXECUTE format('DROP INDEX public.%I', v_column);
    END IF;
  END LOOP;

  FOREACH v_column IN ARRAY v_marker.created_columns LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'comisiones'
        AND column_name = v_column
    ) THEN
      EXECUTE format('ALTER TABLE public.comisiones DROP COLUMN %I', v_column);
    END IF;
  END LOOP;

  IF 'comision_238b_batch_rows' = ANY(v_marker.created_tables)
     AND to_regclass('public.comision_238b_batch_rows') IS NOT NULL THEN
    DROP TABLE public.comision_238b_batch_rows;
  END IF;
  IF 'comision_238b_batches' = ANY(v_marker.created_tables)
     AND to_regclass('public.comision_238b_batches') IS NOT NULL THEN
    DROP TABLE public.comision_238b_batches;
  END IF;

  UPDATE public.comision_238a_installation_marker
  SET status = 'rolled_back', rolled_back_at = now(),
      notes = COALESCE(notes, '') || ' Rollback estructural completado sin filas historicas.'
  WHERE contract_key = '238a';
END
$$;

COMMIT;
