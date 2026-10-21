-- 19_cod_preflight_readonly.sql
-- SOLO LECTURA. Preflight del release 19 (COD mixto). No muta nada.
-- Verifica que las funciones vivas sean EXACTAMENTE el contrato release 14
-- (COMMENTs incluidos) y que los marcadores del release 19 aún no existan.
-- Salida: una fila con jsonb `cod_mixto_preflight`.

WITH f AS (
  SELECT
    to_regprocedure('public.resumen_financiero_despacho(uuid,uuid)') AS summary_oid,
    to_regprocedure('public.registrar_pago_externo_cobro_idempotente(uuid,uuid,uuid,uuid,text,jsonb,text,text)') AS reconcile_oid
), defs AS (
  SELECT
    CASE WHEN f.summary_oid IS NULL THEN NULL ELSE pg_get_functiondef(f.summary_oid) END AS summary_def,
    CASE WHEN f.reconcile_oid IS NULL THEN NULL ELSE pg_get_functiondef(f.reconcile_oid) END AS reconcile_def,
    CASE WHEN f.summary_oid IS NULL THEN NULL ELSE obj_description(f.summary_oid,'pg_proc') END AS summary_comment,
    CASE WHEN f.reconcile_oid IS NULL THEN NULL ELSE obj_description(f.reconcile_oid,'pg_proc') END AS reconcile_comment
  FROM f
)
SELECT jsonb_build_object(
  'functions_present', f.summary_oid IS NOT NULL AND f.reconcile_oid IS NOT NULL,
  'summary_contract_is_release14', defs.summary_comment = 'Main COD release 14: read-only tenant-scoped summary derived from CxC ledger.',
  'reconcile_contract_is_release14', defs.reconcile_comment = 'Main COD release 14: atomic idempotent COD payment; independently preserves payment JSON and per-Bs-payment rate snapshots.',
  'release19_markers_absent', defs.summary_def IS NOT NULL AND defs.reconcile_def IS NOT NULL
    AND defs.summary_def NOT LIKE '%ATRIBUCION_AMBIGUA%'
    AND defs.reconcile_def NOT LIKE '%ATRIBUCION_AMBIGUA%'
    AND defs.summary_def NOT LIKE '%desborde_sin_marca_usd%',
  'ledger_tables_present', to_regclass('public.cuentas_por_cobrar') IS NOT NULL
    AND to_regclass('public.notas_despacho') IS NOT NULL
    AND to_regclass('public.cod_conciliacion_idempotencia') IS NOT NULL,
  'recalc_stub_present', to_regprocedure('public.recalcularcomisiondespacho_238b(uuid)') IS NOT NULL
) AS cod_mixto_preflight
FROM defs CROSS JOIN f;
