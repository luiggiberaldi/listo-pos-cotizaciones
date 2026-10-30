-- 286_staging_flota_reporte_detallado_rollback.sql
-- Revierte la 286: borra obtener_detalle_viajes_flota y deja
-- obtener_reporte_flota_y_choferes exactamente como en la 283.
-- Ojo: la web de la rama con la 286 pide campos nuevos; volver antes la web.

BEGIN;

DROP FUNCTION IF EXISTS public.obtener_detalle_viajes_flota(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, BOOLEAN);

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
BEGIN
  -- 1. Productividad por vehículo propio
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  INTO v_por_vehiculo
  FROM (
    SELECT
      v.id AS vehiculo_id,
      v.codigo,
      v.nombre,
      v.placa,
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
      COUNT(nd.id) FILTER (WHERE nd.vehiculo_origen = 'backfill')::INT AS viajes_estimados,
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
    ORDER BY total_flete_usd DESC, v.codigo ASC
  ) t;

  -- 2. Productividad y liquidación por chofer local
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

  RETURN jsonb_build_object(
    'ok', true,
    'por_vehiculo', v_por_vehiculo,
    'por_chofer_local', v_por_chofer
  );
END;
$$;

REVOKE ALL ON FUNCTION public.obtener_reporte_flota_y_choferes(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.obtener_reporte_flota_y_choferes(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;

COMMIT;
