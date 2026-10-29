-- 283_flota_postflight_readonly.sql — POST-FLIGHT del plan de flota (PRODUCCIÓN).
-- SOLO LECTURA. Ejecutar justo después del apply.
--
-- Esperado:
--   * tabla_vehiculos_existe = true, rls_vehiculos = true
--   * columnas_nuevas = 4, funciones_283 = 4, trigger_despacho = 1
--   * funciones_abiertas_a_navegador = 0   (solo service_role ejecuta; raíl R2)
--   * escritura_directa_navegador = 0      (sin políticas INSERT/UPDATE/DELETE)
--   * worker_puede_leer_y_escribir = true, navegador_puede_leer = true, navegador_puede_escribir_debe_ser_false = false
--   * La huella del bloque 4 IGUAL a la del preflight (no se tocó dinero ni documentos).

-- 1. Estructura
SELECT
  to_regclass('public.vehiculos') IS NOT NULL AS tabla_vehiculos_existe,
  (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.vehiculos')) AS rls_vehiculos,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public'
      AND ((table_name = 'transportistas' AND column_name = 'vehiculo_habitual_id')
        OR (table_name = 'cotizaciones'   AND column_name = 'vehiculo_id')
        OR (table_name = 'notas_despacho' AND column_name IN ('vehiculo_id', 'vehiculo_origen')))) AS columnas_nuevas,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN (
      'fn_autocompletar_vehiculo_despacho', 'eliminar_o_desactivar_vehiculo_atomico',
      'eliminar_o_desactivar_transportista_atomico', 'obtener_reporte_flota_y_choferes')) AS funciones_283,
  (SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_autocompletar_vehiculo_despacho' AND NOT tgisinternal) AS trigger_despacho;

-- 2. Permisos (raíl R2)
SELECT
  (SELECT count(*) FROM (VALUES
      ('public.eliminar_o_desactivar_vehiculo_atomico(uuid,uuid)'),
      ('public.eliminar_o_desactivar_transportista_atomico(uuid,uuid)'),
      ('public.obtener_reporte_flota_y_choferes(uuid,timestamptz,timestamptz)')) f(sig)
    WHERE has_function_privilege('authenticated', f.sig, 'EXECUTE')
       OR has_function_privilege('anon', f.sig, 'EXECUTE')) AS funciones_abiertas_a_navegador,
  (SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'vehiculos' AND cmd IN ('INSERT', 'UPDATE', 'DELETE')) AS escritura_directa_navegador,
  -- Esperado: true, true, false (sin esto /api/vehiculos/* falla con "permission denied")
  (has_table_privilege('service_role', 'public.vehiculos', 'SELECT') AND has_table_privilege('service_role', 'public.vehiculos', 'INSERT')
   AND has_table_privilege('service_role', 'public.vehiculos', 'UPDATE') AND has_table_privilege('service_role', 'public.vehiculos', 'DELETE')) AS worker_puede_leer_y_escribir,
  has_table_privilege('authenticated', 'public.vehiculos', 'SELECT') AS navegador_puede_leer,
  has_table_privilege('authenticated', 'public.vehiculos', 'INSERT') AS navegador_puede_escribir_debe_ser_false;

-- 3. Resultado de la carga histórica
SELECT
  (SELECT count(*) FROM public.vehiculos) AS vehiculos_creados,
  (SELECT count(*) FROM public.transportistas WHERE es_local AND vehiculo_habitual_id IS NOT NULL) AS choferes_con_camion_fijo,
  (SELECT count(*) FROM public.transportistas WHERE es_local AND vehiculo_habitual_id IS NULL) AS choferes_locales_sin_camion,
  (SELECT count(*) FROM public.notas_despacho WHERE vehiculo_origen = 'backfill') AS viajes_estimados,
  (SELECT count(*) FROM public.notas_despacho nd JOIN public.transportistas t ON t.id = nd.transportista_id
    WHERE nd.vehiculo_id IS NOT NULL AND t.es_local = false) AS externos_con_camion_propio_debe_ser_0;

-- 4. Huella de datos (debe ser IDÉNTICA a la del preflight)
SELECT
  (SELECT count(*) FROM public.cotizaciones) AS cotizaciones,
  (SELECT count(*) FROM public.notas_despacho) AS notas_despacho,
  (SELECT count(*) FROM public.pagos_transportistas) AS pagos_transportistas,
  (SELECT count(*) FROM public.transportistas) AS transportistas,
  (SELECT md5(coalesce(string_agg(id::text || '|' || coalesce(total_usd::text, '') || '|' || coalesce(flete_usd::text, '')
     || '|' || coalesce(flete_neto_transportista_usd::text, '') || '|' || flete_pagado::text, ',' ORDER BY id), ''))
     FROM public.notas_despacho) AS notas_financiero_md5;
