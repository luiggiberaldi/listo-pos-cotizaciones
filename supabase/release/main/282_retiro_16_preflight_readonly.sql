-- 282_retiro_16_preflight_readonly.sql — PRE-FLIGHT del retiro de la variante
-- de 16 parámetros de actualizar_producto_con_kardex (PRODUCCIÓN).
-- SOLO LECTURA: no escribe nada. Ejecutar antes del apply.
--
-- Esperado (2026-10-26, valores de la captura en backup_pre_282/):
--   * variante_16_presente = true          (aún existe; el apply la retira)
--   * tenant_safe_presente = true          (la ruta viva de edición; NO se toca)
--   * referencias_desde_otros_cuerpos = 0  (nadie la invoca; verificación 25/10)
--   * tenant_safe_def_md5 = 5a4cc39385af368790ed114e8143f292
--   * productos = 468 · precios_md5 = 49051913f9cf9533dbd8bc72b89ee2d9

SELECT
  to_regprocedure('public.actualizar_producto_con_kardex(uuid,text,text,text,text,text,numeric,numeric,numeric,numeric,text,numeric,numeric,numeric,numeric,numeric)') IS NOT NULL AS variante_16_presente,
  to_regprocedure('public.actualizar_producto_con_kardex_tenant_safe(uuid,uuid,uuid,text,text,text,text,text,text,text,numeric,numeric,numeric,numeric,text,numeric,numeric,numeric,numeric,numeric,uuid)') IS NOT NULL AS tenant_safe_presente,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosrc LIKE '%actualizar_producto_con_kardex(%') AS referencias_desde_otros_cuerpos,
  md5(pg_get_functiondef(to_regprocedure('public.actualizar_producto_con_kardex_tenant_safe(uuid,uuid,uuid,text,text,text,text,text,text,text,numeric,numeric,numeric,numeric,text,numeric,numeric,numeric,numeric,numeric,uuid)'))) AS tenant_safe_def_md5;

SELECT count(*) AS productos,
       md5(coalesce(string_agg(p.precio_usd::text || '|' || coalesce(p.precio_2::text, 'NULL')
         || '|' || coalesce(p.precio_3::text, 'NULL'), ',' ORDER BY p.id), '')) AS precios_md5
FROM public.productos p;
