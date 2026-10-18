-- 14_cod_postflight_readonly.sql
-- READ-ONLY post-apply verification. Run only after an independently approved
-- manual apply; a passing result is not by itself deployment approval.
-- rate_snapshot_contract_present checks the immutable per-payment Bs conversion.

SELECT jsonb_build_object(
  'summary_function_present', to_regprocedure('public.resumen_financiero_despacho(uuid,uuid)') IS NOT NULL,
  'reconcile_function_present', to_regprocedure('public.registrar_pago_externo_cobro_idempotente(uuid,uuid,uuid,uuid,text,jsonb,text,text)') IS NOT NULL,
  'replay_table_present', to_regclass('public.cod_conciliacion_idempotencia') IS NOT NULL,
  'service_role_can_read_summary', has_function_privilege(
    'service_role','public.resumen_financiero_despacho(uuid,uuid)','EXECUTE'),
  'authenticated_cannot_read_summary', NOT has_function_privilege(
    'authenticated','public.resumen_financiero_despacho(uuid,uuid)','EXECUTE'),
  'anon_cannot_read_summary', NOT has_function_privilege(
    'anon','public.resumen_financiero_despacho(uuid,uuid)','EXECUTE'),
  'service_role_can_reconcile', has_function_privilege(
    'service_role','public.registrar_pago_externo_cobro_idempotente(uuid,uuid,uuid,uuid,text,jsonb,text,text)','EXECUTE'),
  'authenticated_cannot_reconcile', NOT has_function_privilege(
    'authenticated','public.registrar_pago_externo_cobro_idempotente(uuid,uuid,uuid,uuid,text,jsonb,text,text)','EXECUTE'),
  'anon_cannot_reconcile', NOT has_function_privilege(
    'anon','public.registrar_pago_externo_cobro_idempotente(uuid,uuid,uuid,uuid,text,jsonb,text,text)','EXECUTE'),
  'summary_is_stable_invoker', EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid='public.resumen_financiero_despacho(uuid,uuid)'::regprocedure
      AND p.provolatile='s' AND NOT p.prosecdef),
  'reconcile_is_volatile_definer', EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid='public.registrar_pago_externo_cobro_idempotente(uuid,uuid,uuid,uuid,text,jsonb,text,text)'::regprocedure
      AND p.provolatile='v' AND p.prosecdef),
  'both_columns_updated_independently',
    pg_get_functiondef('public.registrar_pago_externo_cobro_idempotente(uuid,uuid,uuid,uuid,text,jsonb,text,text)'::regprocedure)
      LIKE '%forma_pago=v_formas_pago_nuevas%'
    AND pg_get_functiondef('public.registrar_pago_externo_cobro_idempotente(uuid,uuid,uuid,uuid,text,jsonb,text,text)'::regprocedure)
      LIKE '%forma_pago_cliente=v_formas_cliente_nuevas%',
  'cod_completion_requires_zero_debt',
    pg_get_functiondef('public.registrar_pago_externo_cobro_idempotente(uuid,uuid,uuid,uuid,text,jsonb,text,text)'::regprocedure)
      LIKE '%(v_deuda_cod-v_total_pago)<=0%',
  'cod_allows_maximum_one_cent_overpayment',
    pg_get_functiondef('public.registrar_pago_externo_cobro_idempotente(uuid,uuid,uuid,uuid,text,jsonb,text,text)'::regprocedure)
      LIKE '%v_total_pago>v_deuda_cod+0.01%',
  'cod_records_overpayment_explicitly',
    pg_get_functiondef('public.registrar_pago_externo_cobro_idempotente(uuid,uuid,uuid,uuid,text,jsonb,text,text)'::regprocedure)
      LIKE '%excedente_usd%',
  'rate_snapshot_contract_present',
    pg_get_functiondef('public.registrar_pago_externo_cobro_idempotente(uuid,uuid,uuid,uuid,text,jsonb,text,text)'::regprocedure)
      LIKE '%tasa_snapshot%'
    AND pg_get_functiondef('public.registrar_pago_externo_cobro_idempotente(uuid,uuid,uuid,uuid,text,jsonb,text,text)'::regprocedure)
      LIKE '%equivalente_usd%'
    AND pg_get_functiondef('public.registrar_pago_externo_cobro_idempotente(uuid,uuid,uuid,uuid,text,jsonb,text,text)'::regprocedure)
      LIKE '%tasa_confirmada_en%'
    AND pg_get_functiondef('public.registrar_pago_externo_cobro_idempotente(uuid,uuid,uuid,uuid,text,jsonb,text,text)'::regprocedure)
      LIKE '%v_pagos_snapshot%',
  'review_release_comment', obj_description(
    'public.registrar_pago_externo_cobro_idempotente(uuid,uuid,uuid,uuid,text,jsonb,text,text)'::regprocedure, 'pg_proc'),
  'result', 'READ_ONLY_ONLY'
) AS cod_main_postflight;
