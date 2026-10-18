-- 14_cod_rollback_review.sql
-- REVIEW ONLY. Run only after a separately approved rollback decision.
-- Deliberately retains cod_conciliacion_idempotencia: it is financial replay
-- history. No ledger entries, JSON evidence or audit rows are removed here.

BEGIN;

DO $review_gate$
BEGIN
  RAISE EXCEPTION 'REVIEW_ONLY: 14_cod_rollback_review.sql requiere aprobacion explicita de rollback';
END;
$review_gate$;

DO $rollback_guard$
DECLARE
  v_summary OID := to_regprocedure('public.resumen_financiero_despacho(uuid,uuid)');
  v_reconcile OID := to_regprocedure('public.registrar_pago_externo_cobro_idempotente(uuid,uuid,uuid,uuid,text,jsonb,text,text)');
BEGIN
  IF v_summary IS NOT NULL
     AND obj_description(v_summary, 'pg_proc') IS DISTINCT FROM
       'Main COD release 14: read-only tenant-scoped summary derived from CxC ledger.' THEN
    RAISE EXCEPTION 'ROLLBACK_14_COD_SUMMARY_OWNER_MISMATCH';
  END IF;
  IF v_reconcile IS NOT NULL
     AND obj_description(v_reconcile, 'pg_proc') IS DISTINCT FROM
       'Main COD release 14: atomic idempotent COD payment; independently preserves payment JSON and per-Bs-payment rate snapshots.' THEN
    RAISE EXCEPTION 'ROLLBACK_14_COD_RECONCILE_OWNER_MISMATCH';
  END IF;
END;
$rollback_guard$;

DROP FUNCTION IF EXISTS public.registrar_pago_externo_cobro_idempotente(UUID,UUID,UUID,UUID,TEXT,JSONB,TEXT,TEXT);
DROP FUNCTION IF EXISTS public.resumen_financiero_despacho(UUID,UUID);

NOTIFY pgrst, 'reload schema';
COMMIT;
