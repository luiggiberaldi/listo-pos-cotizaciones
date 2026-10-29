-- 283_flota_preflight_readonly.sql — PRE-FLIGHT del plan de flota (PRODUCCIÓN).
-- SOLO LECTURA: no escribe nada. Ejecutar antes del apply y guardar el resultado
-- en docs/operaciones/ junto con el respaldo verificable.
-- Plan: docs/plans/2026-10-26-plan-flota-vehiculos-choferes.md (raíl R3).
--
-- Esperado antes de aplicar:
--   * tabla_vehiculos_existe = false            (la 283 aún no está)
--   * columnas_nuevas_existentes = 0
--   * set_updated_at_existe = true              (lo usa el trigger de vehiculos)
--   * columnas_requeridas_faltantes = 0         (las que leen el trigger y las RPC)
--   * Revisar a mano la lista de choferes locales: los que salen "sin_placa"
--     quedarán sin camión (no se inventa) y hay que crearles uno a mano.

-- 1. Estado de los objetos que crea la 283
SELECT
  to_regclass('public.vehiculos') IS NOT NULL AS tabla_vehiculos_existe,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public'
      AND ((table_name = 'transportistas' AND column_name = 'vehiculo_habitual_id')
        OR (table_name = 'cotizaciones'   AND column_name = 'vehiculo_id')
        OR (table_name = 'notas_despacho' AND column_name IN ('vehiculo_id', 'vehiculo_origen')))) AS columnas_nuevas_existentes,
  to_regprocedure('public.set_updated_at()') IS NOT NULL AS set_updated_at_existe,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN (
      'fn_autocompletar_vehiculo_despacho', 'eliminar_o_desactivar_vehiculo_atomico',
      'eliminar_o_desactivar_transportista_atomico', 'obtener_reporte_flota_y_choferes')) AS funciones_283_existentes;

-- 2. Columnas que la 283 necesita y que deben existir ya en producción
SELECT count(*) FILTER (WHERE c.column_name IS NULL) AS columnas_requeridas_faltantes,
       string_agg(r.tabla || '.' || r.columna, ', ') FILTER (WHERE c.column_name IS NULL) AS faltantes
FROM (VALUES
  ('transportistas', 'es_local'), ('transportistas', 'cuenta_id'), ('transportistas', 'placa_chuto'),
  ('transportistas', 'placa_batea'), ('transportistas', 'color_batea'), ('transportistas', 'vehiculo'),
  ('transportistas', 'activo'), ('transportistas', 'actualizado_en'), ('transportistas', 'telefono'),
  ('notas_despacho', 'transportista_id'), ('notas_despacho', 'cuenta_id'), ('notas_despacho', 'estado'),
  ('notas_despacho', 'creado_en'), ('notas_despacho', 'total_usd'), ('notas_despacho', 'flete_usd'),
  ('notas_despacho', 'corte_usd'), ('notas_despacho', 'flete_pagado'),
  ('notas_despacho', 'flete_neto_transportista_usd'), ('notas_despacho', 'flete_estado_destino_snapshot'),
  ('cotizaciones', 'transportista_id'), ('cotizaciones', 'cuenta_id'),
  ('pagos_transportistas', 'transportista_id'), ('pagos_transportistas', 'cuenta_id'), ('pagos_transportistas', 'revertido')
) AS r(tabla, columna)
LEFT JOIN information_schema.columns c
  ON c.table_schema = 'public' AND c.table_name = r.tabla AND c.column_name = r.columna;

-- 3. Qué hará la carga histórica (backfill) — por chofer local
SELECT
  t.id,
  t.nombre,
  t.cuenta_id IS NULL AS sin_cuenta,
  upper(COALESCE(NULLIF(btrim(COALESCE(t.placa_chuto, '')), ''), NULLIF(btrim(COALESCE(t.placa_batea, '')), ''))) AS placa_que_se_usara,
  COALESCE(NULLIF(btrim(COALESCE(t.placa_chuto, '')), ''), NULLIF(btrim(COALESCE(t.placa_batea, '')), '')) IS NULL AS sin_placa,
  (SELECT count(*) FROM public.notas_despacho nd WHERE nd.transportista_id = t.id AND nd.cuenta_id = t.cuenta_id) AS viajes_que_quedaran_estimados
FROM public.transportistas t
WHERE t.es_local = true
ORDER BY t.nombre;

-- 4. Placas repetidas entre choferes de la misma cuenta (compartirán un solo vehículo)
SELECT t.cuenta_id,
       upper(COALESCE(NULLIF(btrim(COALESCE(t.placa_chuto, '')), ''), NULLIF(btrim(COALESCE(t.placa_batea, '')), ''))) AS placa,
       count(*) AS choferes
FROM public.transportistas t
WHERE t.es_local = true AND t.cuenta_id IS NOT NULL
GROUP BY 1, 2
HAVING count(*) > 1 AND upper(COALESCE(NULLIF(btrim(COALESCE(t.placa_chuto, '')), ''), NULLIF(btrim(COALESCE(t.placa_batea, '')), ''))) IS NOT NULL;

-- 5. Huella de datos que la 283 NO debe cambiar (comparar con el postflight)
SELECT
  (SELECT count(*) FROM public.cotizaciones) AS cotizaciones,
  (SELECT count(*) FROM public.notas_despacho) AS notas_despacho,
  (SELECT count(*) FROM public.pagos_transportistas) AS pagos_transportistas,
  (SELECT count(*) FROM public.transportistas) AS transportistas,
  (SELECT md5(coalesce(string_agg(id::text || '|' || coalesce(total_usd::text, '') || '|' || coalesce(flete_usd::text, '')
     || '|' || coalesce(flete_neto_transportista_usd::text, '') || '|' || flete_pagado::text, ',' ORDER BY id), ''))
     FROM public.notas_despacho) AS notas_financiero_md5;
