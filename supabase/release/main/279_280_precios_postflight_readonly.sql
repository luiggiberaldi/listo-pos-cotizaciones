-- 279_280_precios_postflight_readonly.sql
-- SOLO LECTURA. Postflight del release de precios 279/280 (producción). No muta nada.
-- Confirma tras el apply: marcadores vivos («ARREGLO 279» y «280: contrato de precios»),
-- semántica vieja AUSENTE (el ingreso de lote no pisa precios; envío directo de precios
-- en la edición), firmas intactas (7 y 21 args, SECURITY DEFINER), permisos solo
-- service_role y huella de datos sin cambios.
-- Salida: una fila con jsonb `precios_279_280_postflight`.
-- `productos`/`precios_md5` deben coincidir EXACTAMENTE con los del preflight.

WITH f AS (
  SELECT
    to_regprocedure('public.ingresar_lote_inventario_atomico(uuid,text,jsonb,uuid,text,text,uuid)') AS lote_oid,
    to_regprocedure('public.actualizar_producto_con_kardex_tenant_safe(uuid,uuid,uuid,text,text,text,text,text,text,text,numeric,numeric,numeric,numeric,text,numeric,numeric,numeric,numeric,numeric,uuid)') AS upd_oid
), defs AS (
  SELECT
    pg_get_functiondef(f.lote_oid) AS lote_def,
    pg_get_functiondef(f.upd_oid)  AS upd_def,
    (SELECT p.pronargs     FROM pg_proc p WHERE p.oid = f.lote_oid) AS lote_args,
    (SELECT p.pronargs     FROM pg_proc p WHERE p.oid = f.upd_oid)  AS upd_args,
    (SELECT p.prosecdef    FROM pg_proc p WHERE p.oid = f.lote_oid) AS lote_definer,
    (SELECT p.prosecdef    FROM pg_proc p WHERE p.oid = f.upd_oid)  AS upd_definer,
    (SELECT p.provolatile  FROM pg_proc p WHERE p.oid = f.lote_oid) AS lote_vol,
    (SELECT p.provolatile  FROM pg_proc p WHERE p.oid = f.upd_oid)  AS upd_vol
  FROM f
), grants AS (
  SELECT
    count(*) FILTER (WHERE grantee IN ('anon', 'authenticated', 'PUBLIC')) AS permisos_publicos,
    count(*) FILTER (WHERE grantee = 'service_role' AND privilege_type = 'EXECUTE') AS permisos_service
  FROM information_schema.routine_privileges
  WHERE routine_schema = 'public'
    AND routine_name IN ('ingresar_lote_inventario_atomico', 'actualizar_producto_con_kardex_tenant_safe')
), data AS (
  SELECT count(*) AS productos,
         md5(string_agg(id::text || ':' || coalesce(precio_usd::text, 'x') || ':' ||
                        coalesce(precio_2::text, 'x') || ':' || coalesce(precio_3::text, 'x'),
                        ',' ORDER BY id)) AS precios_md5
  FROM public.productos
)
SELECT jsonb_build_object(
  'firmas_ok', defs.lote_args = 7 AND defs.upd_args = 21,
  'security_definer_ok', defs.lote_definer AND defs.upd_definer AND defs.lote_vol = 'v' AND defs.upd_vol = 'v',
  'fix_279_aplicado', defs.lote_def LIKE '%ARREGLO 279%',
  'fix_280_aplicado', defs.upd_def LIKE '%280: contrato de precios%',
  'semantica_vieja_ausente',
    defs.lote_def NOT LIKE '%precio_usd = CASE WHEN COALESCE(v_item.precio_usd%'
    AND defs.upd_def NOT LIKE '%precio_2 = COALESCE(p_precio_2%',
  'envio_directo_280', defs.upd_def LIKE '%precio_2 = p_precio_2%',
  'grants_ok', grants.permisos_publicos = 0 AND grants.permisos_service = 2,
  'productos', data.productos,
  'precios_md5', data.precios_md5,
  'veredicto', CASE
    WHEN f.lote_oid IS NULL OR f.upd_oid IS NULL THEN 'REVISAR: faltan funciones'
    WHEN defs.lote_def LIKE '%ARREGLO 279%'
     AND defs.upd_def LIKE '%280: contrato de precios%'
     AND defs.lote_def NOT LIKE '%precio_usd = CASE WHEN COALESCE(v_item.precio_usd%'
     AND defs.upd_def NOT LIKE '%precio_2 = COALESCE(p_precio_2%'
     AND defs.upd_def LIKE '%precio_2 = p_precio_2%'
     AND defs.lote_args = 7 AND defs.upd_args = 21
     AND defs.lote_definer AND defs.upd_definer
     AND grants.permisos_publicos = 0 AND grants.permisos_service = 2
    THEN 'POSTFLIGHT_OK'
    ELSE 'REVISAR: el cuerpo vivo no cumple el contrato del release'
  END
) AS precios_279_280_postflight
FROM f CROSS JOIN defs CROSS JOIN grants CROSS JOIN data;
