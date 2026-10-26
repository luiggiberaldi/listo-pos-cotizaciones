-- 279_280_precios_preflight_readonly.sql
-- SOLO LECTURA. Preflight del release de precios 279/280 (producción). No muta nada.
-- Comprueba: funciones vivas con sus firmas (7 y 21 args), dependencias de idempotencia,
-- columnas kardex, estado de los marcadores del arreglo y huella de precios de productos.
-- Salida: una fila con jsonb `precios_279_280_preflight`.
--   veredicto YA_APLICADO      → los marcadores ya están vivos; NO re-aplicar.
--   veredicto LISTO_PARA_APLICAR → semántica vieja presente y sin marcadores; aplicar
--     supabase/release/main/279_280_precios_apply.sql (279 primero, 280 después).
--   veredicto REVISAR:* → estado intermedio o firmas cambiadas; no aplicar a ciegas.
-- `productos`/`precios_md5` deben coincidir con los del postflight: el apply solo
-- cambia funciones, jamás datos.

WITH f AS (
  SELECT
    to_regprocedure('public.ingresar_lote_inventario_atomico(uuid,text,jsonb,uuid,text,text,uuid)') AS lote_oid,
    to_regprocedure('public.actualizar_producto_con_kardex_tenant_safe(uuid,uuid,uuid,text,text,text,text,text,text,text,numeric,numeric,numeric,numeric,text,numeric,numeric,numeric,numeric,numeric,uuid)') AS upd_oid
), defs AS (
  SELECT
    CASE WHEN f.lote_oid IS NULL THEN NULL ELSE pg_get_functiondef(f.lote_oid) END AS lote_def,
    CASE WHEN f.upd_oid  IS NULL THEN NULL ELSE pg_get_functiondef(f.upd_oid)  END AS upd_def,
    (SELECT p.pronargs FROM pg_proc p WHERE p.oid = f.lote_oid) AS lote_args,
    (SELECT p.pronargs FROM pg_proc p WHERE p.oid = f.upd_oid)  AS upd_args
  FROM f
), deps AS (
  SELECT
    EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = 'reservar_operacion_inventario') AS reservar_ok,
    EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = 'guardar_operacion_inventario') AS guardar_ok
), kardex AS (
  SELECT count(*) AS columnas FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'inventario_movimientos'
    AND column_name IN ('origen_tipo', 'origen_id', 'origen_referencia', 'idempotency_key', 'motivo_tipo')
), data AS (
  SELECT count(*) AS productos,
         md5(string_agg(id::text || ':' || coalesce(precio_usd::text, 'x') || ':' ||
                        coalesce(precio_2::text, 'x') || ':' || coalesce(precio_3::text, 'x'),
                        ',' ORDER BY id)) AS precios_md5
  FROM public.productos
)
SELECT jsonb_build_object(
  'functions_present', f.lote_oid IS NOT NULL AND f.upd_oid IS NOT NULL,
  'firmas_ok', defs.lote_args = 7 AND defs.upd_args = 21,
  'fix_279_aplicado', defs.lote_def LIKE '%ARREGLO 279%',
  'fix_280_aplicado', defs.upd_def LIKE '%280: contrato de precios%',
  'semantica_vieja_presente',
    defs.lote_def LIKE '%precio_usd = CASE WHEN COALESCE(v_item.precio_usd%'
    OR defs.upd_def LIKE '%precio_2 = COALESCE(p_precio_2%',
  'dependencias_ok', deps.reservar_ok AND deps.guardar_ok AND kardex.columnas = 5,
  'productos', data.productos,
  'precios_md5', data.precios_md5,
  'veredicto', CASE
    WHEN f.lote_oid IS NULL OR f.upd_oid IS NULL THEN 'REVISAR: faltan funciones'
    WHEN defs.lote_args IS DISTINCT FROM 7 OR defs.upd_args IS DISTINCT FROM 21 THEN 'REVISAR: firmas cambiadas'
    WHEN NOT (deps.reservar_ok AND deps.guardar_ok AND kardex.columnas = 5) THEN 'REVISAR: faltan dependencias'
    WHEN defs.lote_def LIKE '%ARREGLO 279%' AND defs.upd_def LIKE '%280: contrato de precios%' THEN 'YA_APLICADO'
    WHEN defs.lote_def LIKE '%precio_usd = CASE WHEN COALESCE(v_item.precio_usd%'
      OR defs.upd_def LIKE '%precio_2 = COALESCE(p_precio_2%' THEN 'LISTO_PARA_APLICAR'
    ELSE 'REVISAR: estado intermedio'
  END
) AS precios_279_280_preflight
FROM f CROSS JOIN defs CROSS JOIN deps CROSS JOIN kardex CROSS JOIN data;
