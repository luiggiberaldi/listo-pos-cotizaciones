-- ═══════════════════════════════════════════════════════════════════════════
-- POSTFLIGHT 09 (principal) — verificaciones read-only post-apply
-- ═══════════════════════════════════════════════════════════════════════════
-- 1) Tranca presente en el cuerpo vivo:
SELECT CASE WHEN pg_get_functiondef('public.calcularcomisiondespacho_238b(uuid)'::regprocedure)
  LIKE '%comision_238b_cod_pendiente%' THEN 'OK' ELSE 'FAIL' END AS tranca_presente;

-- 2) Split v3.1 intacto:
SELECT CASE WHEN pg_get_functiondef('public.calcularcomisiondespacho_238b(uuid)'::regprocedure)
  LIKE '%v_designado_id = v_dueno_id%' THEN 'OK' ELSE 'FAIL' END AS split_v31_intacto;

-- 3) Helper existe y responde:
SELECT public.comision_238b_cod_pendiente('[{"metodo":"Cobro a destino","monto":100}]'::text, NULL::text) AS cod_pend_true,
       public.comision_238b_cod_pendiente('[{"metodo":"Efectivo","monto":100}]'::text, NULL::text) AS cod_pend_false;

-- 4) Toggle por cuenta (debe ser OFF al aplicar):
SELECT count(*) AS total, count(*) FILTER (WHERE comision_cod_solo_pagado) AS on_count
FROM public.configuracion_negocio;

-- 5) Funciones de entrega intactas (hashes comparables contra postflight 08b):
SELECT md5(pg_get_functiondef('public.confirmar_entrega_finanzas_idempotente(uuid,uuid,uuid,uuid,text,text,numeric,boolean)'::regprocedure)::text) AS hash_entrega;
