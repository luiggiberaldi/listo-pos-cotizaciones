-- Release 10 — POSTFLIGHT (read-only)
-- 1) El calculador vivo debe ser el delegador (cuerpo corto, apunta a 238b)
SELECT 'delegador_vivo' AS check_name,
       (pg_get_functiondef('public.calcularcomisiondespacho(uuid)'::regprocedure) LIKE '%calcularcomisiondespacho_238b%') AS ok,
       length(pg_get_functiondef('public.calcularcomisiondespacho(uuid)'::regprocedure)) AS body_len
UNION ALL
-- 2) El legacy no debe quedar vivo (sin INSERT a comision_liberaciones)
SELECT 'legacy_fuera',
       (pg_get_functiondef('public.calcularcomisiondespacho(uuid)'::regprocedure) NOT LIKE '%comision_liberaciones%'),
       NULL
UNION ALL
-- 3) La 238b conserva tranca COD y split
SELECT '238b_intacta',
       (pg_get_functiondef('public.calcularcomisiondespacho_238b(uuid)'::regprocedure) LIKE '%comision_238b_cod_pendiente%'
        AND pg_get_functiondef('public.calcularcomisiondespacho_238b(uuid)'::regprocedure) LIKE '%comision_designacion_diaria%'),
       NULL
UNION ALL
-- 4) La RPC de entrega intacta (sin cambio de estructura)
SELECT 'entrega_intacta',
       (pg_get_functiondef('public.confirmar_entrega_finanzas_idempotente(uuid,uuid,uuid,uuid,text,text,numeric,boolean)'::regprocedure) LIKE '%calcularcomisiondespacho(%'),
       NULL;
