-- 286_staging_flota_reporte_detallado.sql
-- Plan de flota — reporte detallado por camión (pedido del dueño 2026-10-29).
--
-- 1. obtener_reporte_flota_y_choferes: MISMA firma y mismas métricas congeladas
--    (raíl R7: viajes = despachada/entregada, fechas por creado_en, mercancía =
--    total − flete − corte, comisión = neto guardado). Se AGREGAN por camión:
--      comision_choferes_usd, empresa_usd (= fletes − comisión de choferes),
--      dias_trabajados (días distintos con viaje, hora de Caracas),
--      viajes_en_carabobo / viajes_fuera_carabobo, destinos_top (3 más frecuentes),
--      ultimo_viaje_en y ultimo_chofer_nombre.
--    Y a nivel general: viajes_sin_camion (choferes locales que salieron sin
--    camión registrado en el período).
-- 2. obtener_detalle_viajes_flota (NUEVA): lista viaje por viaje de un camión, de
--    todos, o solo de los viajes sin camión — para revisar cualquier número.
--
-- Solo lectura de datos; SECURITY DEFINER y ejecución reservada a service_role (R2).
-- Rollback: 286_staging_flota_reporte_detallado_rollback.sql (restaura la 283).

BEGIN;

CREATE OR REPLACE FUNCTION public.obtener_reporte_flota_y_choferes(
  p_cuenta_id UUID,
  p_fecha_inicio TIMESTAMPTZ,
  p_fecha_fin TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_por_vehiculo JSONB;
  v_por_chofer JSONB;
  v_sin_camion JSONB;
BEGIN
  -- 1. Productividad por vehículo propio
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  INTO v_por_vehiculo
  FROM (
    SELECT
      v.id AS vehiculo_id,
      v.codigo,
      v.nombre,
      v.modelo,
      v.placa,
      v.placa_batea,
      v.capacidad_kg,
      v.color_batea,
      v.activo,
      COUNT(nd.id)::INT AS total_viajes,
      ROUND(COALESCE(SUM(nd.flete_usd), 0), 2) AS total_flete_usd,
      ROUND(COALESCE(SUM(nd.total_usd - nd.flete_usd - nd.corte_usd), 0), 2) AS total_mercancia_usd,
      ROUND(
        CASE WHEN COUNT(nd.id) > 0
             THEN COALESCE(SUM(nd.flete_usd), 0) / COUNT(nd.id)
             ELSE 0
        END, 2
      ) AS promedio_flete_viaje_usd,
      ROUND(COALESCE(SUM(nd.flete_neto_transportista_usd), 0), 2) AS comision_choferes_usd,
      ROUND(COALESCE(SUM(nd.flete_usd), 0) - COALESCE(SUM(nd.flete_neto_transportista_usd), 0), 2) AS empresa_usd,
      COUNT(DISTINCT (nd.creado_en AT TIME ZONE 'America/Caracas')::date)::INT AS dias_trabajados,
      COUNT(nd.id) FILTER (
        WHERE lower(COALESCE(nd.flete_estado_destino_snapshot, nd.direccion_envio_estado, '')) = 'carabobo'
      )::INT AS viajes_en_carabobo,
      COUNT(nd.id) FILTER (
        WHERE COALESCE(nd.flete_estado_destino_snapshot, nd.direccion_envio_estado) IS NOT NULL
          AND lower(COALESCE(nd.flete_estado_destino_snapshot, nd.direccion_envio_estado)) <> 'carabobo'
      )::INT AS viajes_fuera_carabobo,
      COUNT(nd.id) FILTER (WHERE nd.vehiculo_origen = 'backfill')::INT AS viajes_estimados,
      MAX(nd.creado_en) AS ultimo_viaje_en,
      (
        SELECT tr.nombre
        FROM public.notas_despacho nd4
        LEFT JOIN public.transportistas tr ON tr.id = nd4.transportista_id
        WHERE nd4.cuenta_id = p_cuenta_id
          AND nd4.vehiculo_id = v.id
          AND nd4.estado IN ('despachada', 'entregada')
          AND nd4.creado_en >= p_fecha_inicio
          AND nd4.creado_en <= p_fecha_fin
        ORDER BY nd4.creado_en DESC
        LIMIT 1
      ) AS ultimo_chofer_nombre,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object('destino', d.destino, 'viajes', d.viajes))
        FROM (
          SELECT
            COALESCE(NULLIF(btrim(concat_ws(', ',
              NULLIF(btrim(nd5.direccion_envio_ciudad), ''),
              NULLIF(btrim(COALESCE(nd5.flete_estado_destino_snapshot, nd5.direccion_envio_estado)), '')
            )), ''), 'Sin destino') AS destino,
            COUNT(*)::INT AS viajes
          FROM public.notas_despacho nd5
          WHERE nd5.cuenta_id = p_cuenta_id
            AND nd5.vehiculo_id = v.id
            AND nd5.estado IN ('despachada', 'entregada')
            AND nd5.creado_en >= p_fecha_inicio
            AND nd5.creado_en <= p_fecha_fin
          GROUP BY 1
          ORDER BY viajes DESC, destino ASC
          LIMIT 3
        ) d
      ), '[]'::jsonb) AS destinos_top,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'transportista_id', sub.transportista_id,
          'chofer_nombre', sub.chofer_nombre,
          'viajes', sub.viajes,
          'flete_usd', sub.flete_usd
        ))
        FROM (
          SELECT
            nd2.transportista_id,
            COALESCE(tr.nombre, 'Sin chofer') AS chofer_nombre,
            COUNT(nd2.id)::INT AS viajes,
            ROUND(COALESCE(SUM(nd2.flete_usd), 0), 2) AS flete_usd
          FROM public.notas_despacho nd2
          LEFT JOIN public.transportistas tr ON tr.id = nd2.transportista_id
          WHERE nd2.cuenta_id = p_cuenta_id
            AND nd2.vehiculo_id = v.id
            AND nd2.estado IN ('despachada', 'entregada')
            AND nd2.creado_en >= p_fecha_inicio
            AND nd2.creado_en <= p_fecha_fin
          GROUP BY nd2.transportista_id, tr.nombre
          ORDER BY viajes DESC
        ) sub
      ), '[]'::jsonb) AS desglose_choferes
    FROM public.vehiculos v
    LEFT JOIN public.notas_despacho nd
      ON nd.vehiculo_id = v.id
     AND nd.cuenta_id = v.cuenta_id
     AND nd.estado IN ('despachada', 'entregada')
     AND nd.creado_en >= p_fecha_inicio
     AND nd.creado_en <= p_fecha_fin
    WHERE v.cuenta_id = p_cuenta_id
    GROUP BY v.id
    ORDER BY total_viajes DESC, total_flete_usd DESC, v.codigo ASC
  ) t;

  -- 2. Productividad y liquidación por chofer local (sin cambios respecto de la 283)
  SELECT COALESCE(jsonb_agg(row_to_json(c)), '[]'::jsonb)
  INTO v_por_chofer
  FROM (
    SELECT
      tr.id AS transportista_id,
      tr.nombre AS chofer_nombre,
      tr.telefono,
      tr.activo,
      vh.nombre AS vehiculo_habitual_nombre,
      vh.placa AS vehiculo_habitual_placa,
      COUNT(nd.id)::INT AS total_viajes,
      COUNT(nd.id) FILTER (
        WHERE lower(COALESCE(nd.flete_estado_destino_snapshot, '')) = 'carabobo'
      )::INT AS viajes_en_carabobo,
      COUNT(nd.id) FILTER (
        WHERE nd.flete_estado_destino_snapshot IS NOT NULL
          AND lower(nd.flete_estado_destino_snapshot) <> 'carabobo'
      )::INT AS viajes_fuera_carabobo,
      ROUND(COALESCE(SUM(nd.flete_usd), 0), 2) AS total_flete_usd,
      ROUND(COALESCE(SUM(nd.total_usd - nd.flete_usd - nd.corte_usd), 0), 2) AS total_mercancia_usd,
      ROUND(COALESCE(SUM(nd.flete_neto_transportista_usd), 0), 2) AS comision_generada_usd,
      ROUND(COALESCE(SUM(nd.flete_neto_transportista_usd) FILTER (WHERE nd.flete_pagado), 0), 2) AS comision_pagada_usd,
      ROUND(COALESCE(SUM(nd.flete_neto_transportista_usd) FILTER (WHERE NOT nd.flete_pagado), 0), 2) AS comision_pendiente_usd,
      COUNT(nd.id) FILTER (WHERE nd.vehiculo_origen = 'backfill')::INT AS viajes_estimados,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'vehiculo_id', sub2.vehiculo_id,
          'vehiculo_nombre', sub2.vehiculo_nombre,
          'placa', sub2.placa,
          'viajes', sub2.viajes,
          'flete_usd', sub2.flete_usd,
          'comision_usd', sub2.comision_usd
        ))
        FROM (
          SELECT
            nd3.vehiculo_id,
            COALESCE(v2.nombre, 'Vehículo no especificado') AS vehiculo_nombre,
            COALESCE(v2.placa, 'S/P') AS placa,
            COUNT(nd3.id)::INT AS viajes,
            ROUND(COALESCE(SUM(nd3.flete_usd), 0), 2) AS flete_usd,
            ROUND(COALESCE(SUM(nd3.flete_neto_transportista_usd), 0), 2) AS comision_usd
          FROM public.notas_despacho nd3
          LEFT JOIN public.vehiculos v2 ON v2.id = nd3.vehiculo_id
          WHERE nd3.cuenta_id = p_cuenta_id
            AND nd3.transportista_id = tr.id
            AND nd3.estado IN ('despachada', 'entregada')
            AND nd3.creado_en >= p_fecha_inicio
            AND nd3.creado_en <= p_fecha_fin
          GROUP BY nd3.vehiculo_id, v2.nombre, v2.placa
          ORDER BY viajes DESC
        ) sub2
      ), '[]'::jsonb) AS desglose_vehiculos
    FROM public.transportistas tr
    LEFT JOIN public.vehiculos vh ON vh.id = tr.vehiculo_habitual_id
    LEFT JOIN public.notas_despacho nd
      ON nd.transportista_id = tr.id
     AND nd.cuenta_id = tr.cuenta_id
     AND nd.estado IN ('despachada', 'entregada')
     AND nd.creado_en >= p_fecha_inicio
     AND nd.creado_en <= p_fecha_fin
    WHERE tr.cuenta_id = p_cuenta_id
      AND tr.es_local = true
    GROUP BY tr.id, vh.nombre, vh.placa
    ORDER BY total_flete_usd DESC, tr.nombre ASC
  ) c;

  -- 3. Viajes de choferes locales sin camión registrado
  SELECT jsonb_build_object(
    'viajes', COUNT(nd.id)::INT,
    'flete_usd', ROUND(COALESCE(SUM(nd.flete_usd), 0), 2)
  )
  INTO v_sin_camion
  FROM public.notas_despacho nd
  JOIN public.transportistas tr ON tr.id = nd.transportista_id AND tr.es_local = true
  WHERE nd.cuenta_id = p_cuenta_id
    AND nd.vehiculo_id IS NULL
    AND nd.estado IN ('despachada', 'entregada')
    AND nd.creado_en >= p_fecha_inicio
    AND nd.creado_en <= p_fecha_fin;

  RETURN jsonb_build_object(
    'ok', true,
    'por_vehiculo', v_por_vehiculo,
    'por_chofer_local', v_por_chofer,
    'viajes_sin_camion', v_sin_camion
  );
END;
$$;

REVOKE ALL ON FUNCTION public.obtener_reporte_flota_y_choferes(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.obtener_reporte_flota_y_choferes(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;

-- ============================================================================
-- Detalle viaje por viaje (máx. 1000 filas, más recientes primero)
--   p_vehiculo_id NULL + p_solo_sin_camion false → todos los viajes con camión
--   p_vehiculo_id X                               → solo ese camión
--   p_solo_sin_camion true                        → choferes locales sin camión
-- ============================================================================
CREATE OR REPLACE FUNCTION public.obtener_detalle_viajes_flota(
  p_cuenta_id UUID,
  p_fecha_inicio TIMESTAMPTZ,
  p_fecha_fin TIMESTAMPTZ,
  p_vehiculo_id UUID DEFAULT NULL,
  p_solo_sin_camion BOOLEAN DEFAULT false
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_viajes JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb)
  INTO v_viajes
  FROM (
    SELECT
      nd.id AS despacho_id,
      nd.numero,
      nd.creado_en AS fecha,
      nd.estado,
      cl.nombre AS cliente_nombre,
      NULLIF(btrim(COALESCE(nd.direccion_envio_ciudad, '')), '') AS ciudad,
      COALESCE(nd.flete_estado_destino_snapshot, nd.direccion_envio_estado) AS estado_destino,
      tr.nombre AS chofer_nombre,
      v.codigo AS vehiculo_codigo,
      v.nombre AS vehiculo_nombre,
      v.placa AS vehiculo_placa,
      nd.vehiculo_origen,
      ROUND(COALESCE(nd.flete_usd, 0), 2) AS flete_usd,
      ROUND(COALESCE(nd.flete_neto_transportista_usd, 0), 2) AS chofer_usd,
      ROUND(COALESCE(nd.flete_usd, 0) - COALESCE(nd.flete_neto_transportista_usd, 0), 2) AS empresa_usd,
      ROUND(COALESCE(nd.total_usd - nd.flete_usd - nd.corte_usd, 0), 2) AS mercancia_usd
    FROM public.notas_despacho nd
    JOIN public.transportistas tr ON tr.id = nd.transportista_id AND tr.cuenta_id = nd.cuenta_id
    LEFT JOIN public.vehiculos v ON v.id = nd.vehiculo_id
    LEFT JOIN public.clientes cl ON cl.id = nd.cliente_id
    WHERE nd.cuenta_id = p_cuenta_id
      AND nd.estado IN ('despachada', 'entregada')
      AND nd.creado_en >= p_fecha_inicio
      AND nd.creado_en <= p_fecha_fin
      AND (
        (p_solo_sin_camion AND tr.es_local = true AND nd.vehiculo_id IS NULL)
        OR (NOT p_solo_sin_camion AND p_vehiculo_id IS NOT NULL AND nd.vehiculo_id = p_vehiculo_id)
        OR (NOT p_solo_sin_camion AND p_vehiculo_id IS NULL AND nd.vehiculo_id IS NOT NULL)
      )
    ORDER BY nd.creado_en DESC
    LIMIT 1000
  ) x;

  RETURN jsonb_build_object('ok', true, 'viajes', v_viajes);
END;
$$;

REVOKE ALL ON FUNCTION public.obtener_detalle_viajes_flota(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.obtener_detalle_viajes_flota(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, BOOLEAN) TO service_role;

COMMIT;
