-- 19_cod_postflight_readonly.sql
-- SOLO LECTURA. Postflight del release 19 (COD mixto). No muta nada.
-- Confirma: contrato release 19 (COMMENTs), guardas nuevas, atribucion por
-- porciones en ambas funciones, permisos solo service_role, politica de un
-- centavo intacta, completado solo con deuda cero, y etiqueta metodo_pago='cod'
-- en los abonos del flujo atomico (la atribucion depende de esa etiqueta).
-- Salida: una fila con jsonb `cod_mixto_postflight`.

WITH f AS (
  SELECT
    to_regprocedure('public.resumen_financiero_despacho(uuid,uuid)') AS summary_oid,
    to_regprocedure('public.registrar_pago_externo_cobro_idempotente(uuid,uuid,uuid,uuid,text,jsonb,text,text)') AS reconcile_oid
), defs AS (
  SELECT
    pg_get_functiondef(f.summary_oid) AS summary_def,
    pg_get_functiondef(f.reconcile_oid) AS reconcile_def,
    obj_description(f.summary_oid,'pg_proc') AS summary_comment,
    obj_description(f.reconcile_oid,'pg_proc') AS reconcile_comment,
    (SELECT p.provolatile FROM pg_proc p WHERE p.oid=f.summary_oid) AS summary_vol,
    (SELECT p.prosecdef FROM pg_proc p WHERE p.oid=f.summary_oid) AS summary_definer,
    (SELECT p.provolatile FROM pg_proc p WHERE p.oid=f.reconcile_oid) AS reconcile_vol,
    (SELECT p.prosecdef FROM pg_proc p WHERE p.oid=f.reconcile_oid) AS reconcile_definer
  FROM f
)
SELECT jsonb_build_object(
  'contracts_are_release19',
    defs.summary_comment LIKE 'Main COD release 19:%'
    AND defs.reconcile_comment LIKE 'Main COD release 19:%',
  'summary_stable_invoker', defs.summary_vol = 's' AND defs.summary_definer = false,
  'reconcile_volatile_definer', defs.reconcile_vol = 'v' AND defs.reconcile_definer = true,
  'new_guards_present',
    defs.reconcile_def LIKE '%COD_CONCILIACION_ATRIBUCION_AMBIGUA%'
    AND defs.reconcile_def LIKE '%COD_CONCILIACION_FLAG_SIN_SOPORTE%',
  'attribution_present_both',
    defs.summary_def LIKE '%desborde_sin_marca_usd%'
    AND defs.summary_def LIKE '%cargo_cxc_usd%'
    AND defs.summary_def LIKE '%pago_mixto%'
    AND defs.summary_def LIKE '%motivo_revision%'
    AND defs.reconcile_def LIKE '%v_spill_dinero%'
    AND defs.reconcile_def LIKE '%v_abono_comun_dinero%',
  'cod_payments_tagged', defs.reconcile_def LIKE '%''cod'',v_metodo%',
  'idempotency_intact',
    defs.reconcile_def LIKE '%COD_CONCILIACION_IDEMPOTENCIA_REUTILIZADA%'
    AND defs.reconcile_def LIKE '%cod_conciliacion_idempotencia%',
  'cod_completion_requires_zero_debt', defs.reconcile_def LIKE '%(v_deuda_cod-v_total_pago)<=0%',
  'cod_allows_maximum_one_cent_overpayment', defs.reconcile_def LIKE '%v_total_pago>v_deuda_cod+0.01%',
  'cod_records_overpayment_explicitly', defs.reconcile_def LIKE '%excedente_usd%',
  'grants_service_only',
    has_function_privilege('service_role','public.resumen_financiero_despacho(uuid,uuid)','EXECUTE')
    AND NOT has_function_privilege('authenticated','public.resumen_financiero_despacho(uuid,uuid)','EXECUTE')
    AND NOT has_function_privilege('anon','public.resumen_financiero_despacho(uuid,uuid)','EXECUTE')
    AND has_function_privilege('service_role','public.registrar_pago_externo_cobro_idempotente(uuid,uuid,uuid,uuid,text,jsonb,text,text)','EXECUTE')
    AND NOT has_function_privilege('authenticated','public.registrar_pago_externo_cobro_idempotente(uuid,uuid,uuid,uuid,text,jsonb,text,text)','EXECUTE')
    AND NOT has_function_privilege('anon','public.registrar_pago_externo_cobro_idempotente(uuid,uuid,uuid,uuid,text,jsonb,text,text)','EXECUTE')
) AS cod_mixto_postflight
FROM defs;
