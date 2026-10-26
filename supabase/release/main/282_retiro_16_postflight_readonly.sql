-- 282_retiro_16_postflight_readonly.sql — POST-FLIGHT del retiro de la variante
-- de 16 parámetros de actualizar_producto_con_kardex (PRODUCCIÓN).
-- SOLO LECTURA: no escribe nada. Ejecutar después del apply.
--
-- Esperado (2026-10-26, valores de la captura en backup_pre_282/):
--   * retirada = true                      (la variante de 16 args ya no existe)
--   * tenant_safe_presente = true          (la ruta viva de edición, intacta)
--   * tenant_safe_def_md5 = 5a4cc39385af368790ed114e8143f292  (idéntica al pre)
--   * referencias_huerfanas = 0
--   * productos = 468 · precios_md5 = 49051913f9cf9533dbd8bc72b89ee2d9
--     (idénticos al preflight: el apply solo tocó la función retirada)

SELECT
  to_regprocedure('public.actualizar_producto_con_kardex(uuid,text,text,text,text,text,numeric,numeric,numeric,numeric,text,numeric,numeric,numeric,numeric,numeric)') IS NULL AS retirada,
  to_regprocedure('public.actualizar_producto_con_kardex_tenant_safe(uuid,uuid,uuid,text,text,text,text,text,text,text,numeric,numeric,numeric,numeric,text,numeric,numeric,numeric,numeric,numeric,uuid)') IS NOT NULL AS tenant_safe_presente,
  md5(pg_get_functiondef(to_regprocedure('public.actualizar_producto_con_kardex_tenant_safe(uuid,uuid,uuid,text,text,text,text,text,text,text,numeric,numeric,numeric,numeric,text,numeric,numeric,numeric,numeric,numeric,uuid)'))) AS tenant_safe_def_md5,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosrc LIKE '%actualizar_producto_con_kardex(%') AS referencias_huerfanas;

SELECT count(*) AS productos,
       md5(coalesce(string_agg(p.precio_usd::text || '|' || coalesce(p.precio_2::text, 'NULL')
         || '|' || coalesce(p.precio_3::text, 'NULL'), ',' ORDER BY p.id), '')) AS precios_md5
FROM public.productos p;
